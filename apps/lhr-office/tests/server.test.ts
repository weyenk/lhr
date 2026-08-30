import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const runDueJobMock = vi.fn();
const runJobNowMock = vi.fn();
vi.mock('../src/orchestrate', () => ({
  runDueJob: (...args: unknown[]) => runDueJobMock(...args),
  runJobNow: (...args: unknown[]) => runJobNowMock(...args),
}));

const getRunHistoryMock = vi.fn();
vi.mock('@lhr/db', () => ({
  getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args),
}));

const { createApp } = await import('../src/server');

const fakeDb = {} as Queryable;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  process.env.STATUS_AUTH_USER = 'test-user';
  process.env.STATUS_AUTH_PASSWORD = 'test-password';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('cron endpoint auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator');
    expect(res.status).toBe(401);
    expect(runDueJobMock).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
    expect(runDueJobMock).not.toHaveBeenCalled();
  });

  it('runs the due-job check on GET with the correct secret (Vercel Cron issues GET)', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'nothing-due' });
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'nothing-due' });
    expect(runDueJobMock).toHaveBeenCalledWith(fakeDb, []);
  });

  it('also accepts POST with the correct secret (for manual testing)', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'nothing-due' });
    const app = createApp(fakeDb, []);
    const res = await request(app).post('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
  });

  it('returns 200 (not 500) with a failure outcome when a job throws', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
  });

  it('returns 200 (not a hang or 500) when runDueJob itself rejects', async () => {
    runDueJobMock.mockRejectedValue(new Error('db down'));
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'error', error: 'db down' });
  });
});

describe('status endpoints auth', () => {
  it('GET /status rejects a request with no Authorization header', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/status');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
  });

  it('GET /status rejects a request with the wrong credentials', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/status').auth('test-user', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('GET /status rejects a request with the wrong username', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/status').auth('wrong-user', 'test-password');
    expect(res.status).toBe(401);
  });

  it('GET /status is unauthorized when STATUS_AUTH_USER/PASSWORD are unset, even with a header', async () => {
    delete process.env.STATUS_AUTH_USER;
    delete process.env.STATUS_AUTH_PASSWORD;
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(401);
  });

  it('POST /status/run/:jobName rejects a request with no Authorization header, and does not invoke the job', async () => {
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).post('/status/run/recipe-variant-generator');
    expect(res.status).toBe(401);
    expect(runJobNowMock).not.toHaveBeenCalled();
  });

  it('POST /status/run/:jobName rejects wrong credentials, and does not invoke the job', async () => {
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).post('/status/run/recipe-variant-generator').auth('test-user', 'wrong-password');
    expect(res.status).toBe(401);
    expect(runJobNowMock).not.toHaveBeenCalled();
  });
});

describe('GET /status', () => {
  it("renders each registered job's name and latest run", async () => {
    getRunHistoryMock.mockResolvedValue([
      {
        id: 1,
        jobName: 'recipe-variant-generator',
        status: 'success',
        summary: 'generated 1 variant',
        errorMessage: null,
        startedAt: new Date('2026-08-20T00:00:00Z'),
        finishedAt: new Date('2026-08-20T00:05:00Z'),
      },
    ]);
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(200);
    expect(res.text).toContain('recipe-variant-generator');
    expect(res.text).toContain('generated 1 variant');
  });

  it('renders a placeholder when no jobs are registered', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.text).toContain('No jobs registered yet');
  });

  it('returns 500 (not a hang) when getRunHistory rejects', async () => {
    getRunHistoryMock.mockRejectedValue(new Error('db down'));
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('db down');
  });
});

describe('POST /status/run/:jobName', () => {
  it('runs the named job and redirects back to /status', async () => {
    runJobNowMock.mockResolvedValue({ outcome: 'ran', job: 'recipe-variant-generator', status: 'success', summary: 'ok' });
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).post('/status/run/recipe-variant-generator').auth('test-user', 'test-password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(runJobNowMock).toHaveBeenCalledWith(fakeDb, expect.any(Array), 'recipe-variant-generator');
  });

  it('returns 404 for an unknown job name', async () => {
    runJobNowMock.mockResolvedValue(null);
    const app = createApp(fakeDb, []);
    const res = await request(app).post('/status/run/nope').auth('test-user', 'test-password');
    expect(res.status).toBe(404);
  });

  it('returns 500 (not a hang) when runJobNow rejects', async () => {
    runJobNowMock.mockRejectedValue(new Error('boom'));
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).post('/status/run/recipe-variant-generator').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('boom');
  });
});
