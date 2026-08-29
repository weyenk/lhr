import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const runDueJobMock = vi.fn();
vi.mock('../src/orchestrate', () => ({
  runDueJob: (...args: unknown[]) => runDueJobMock(...args),
}));

const { createApp } = await import('../src/server');

const fakeDb = {} as Queryable;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
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
