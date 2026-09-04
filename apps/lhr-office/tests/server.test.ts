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
const getLatestPendingCycleIdMock = vi.fn();
const getPendingCandidatesMock = vi.fn();
vi.mock('@lhr/db', () => ({
  getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args),
  getLatestPendingCycleId: (...args: unknown[]) => getLatestPendingCycleIdMock(...args),
  getPendingCandidates: (...args: unknown[]) => getPendingCandidatesMock(...args),
}));

vi.mock('lhr-authoring-mcp-server/dist-lib/affiliateCandidateOps.js', () => ({
  approveAffiliateCandidate: vi.fn(),
  denyAffiliateCandidate: vi.fn(),
}));

const { createApp } = await import('../src/server');

const fakeDb = {} as Queryable;
const originalEnv = { ...process.env };

const noCandidates = {
  getPending: vi.fn().mockResolvedValue(null),
  approve: vi.fn(),
  reroll: vi.fn(),
};

const noAffiliateCandidates = {
  getPending: vi.fn().mockResolvedValue([]),
  approve: vi.fn(),
  deny: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  process.env.STATUS_AUTH_USER = 'test-user';
  process.env.STATUS_AUTH_PASSWORD = 'test-password';
  noCandidates.getPending.mockResolvedValue(null);
  noAffiliateCandidates.getPending.mockResolvedValue([]);
  getLatestPendingCycleIdMock.mockResolvedValue(null);
  getPendingCandidatesMock.mockResolvedValue([]);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('cron endpoint auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/cron/orchestrator');
    expect(res.status).toBe(401);
    expect(runDueJobMock).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
    expect(runDueJobMock).not.toHaveBeenCalled();
  });

  it('runs the due-job check on GET with the correct secret (Vercel Cron issues GET)', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'nothing-due' });
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'nothing-due' });
    expect(runDueJobMock).toHaveBeenCalledWith(fakeDb, []);
  });

  it('also accepts POST with the correct secret (for manual testing)', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'nothing-due' });
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
  });

  it('returns 200 (not 500) with a failure outcome when a job throws', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
  });

  it('returns 200 (not a hang or 500) when runDueJob itself rejects', async () => {
    runDueJobMock.mockRejectedValue(new Error('db down'));
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'error', error: 'db down' });
  });
});

describe('status endpoints auth', () => {
  it('GET /status rejects a request with no Authorization header', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
  });

  it('GET /status rejects a request with the wrong credentials', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'wrong-password');
    expect(res.status).toBe(401);
  });

  it('GET /status rejects a request with the wrong username', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('wrong-user', 'test-password');
    expect(res.status).toBe(401);
  });

  it('GET /status is unauthorized when STATUS_AUTH_USER/PASSWORD are unset, even with a header', async () => {
    delete process.env.STATUS_AUTH_USER;
    delete process.env.STATUS_AUTH_PASSWORD;
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(401);
  });

  it('POST /status/run/:jobName rejects a request with no Authorization header, and does not invoke the job', async () => {
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/run/recipe-variant-generator');
    expect(res.status).toBe(401);
    expect(runJobNowMock).not.toHaveBeenCalled();
  });

  it('POST /status/run/:jobName rejects wrong credentials, and does not invoke the job', async () => {
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }], noCandidates, noAffiliateCandidates);
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
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(200);
    expect(res.text).toContain('recipe-variant-generator');
    expect(res.text).toContain('generated 1 variant');
  });

  it('renders a placeholder when no jobs are registered', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.text).toContain('No jobs registered yet');
  });

  it('returns 500 (not a hang) when getRunHistory rejects', async () => {
    getRunHistoryMock.mockRejectedValue(new Error('db down'));
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('db down');
  });

  it('renders the pending recipe candidate with approve/reroll actions, before any diet variants are generated', async () => {
    const candidates = {
      getPending: vi.fn().mockResolvedValue({
        id: 'cand1',
        record: {
          status: 'pending',
          source: { idMeal: '52772', title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' },
        },
      }),
      approve: vi.fn(),
      reroll: vi.fn(),
    };
    const app = createApp(fakeDb, [], candidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Teriyaki Chicken Casserole');
    expect(res.text).toContain('/status/candidate/cand1/approve');
    expect(res.text).toContain('/status/candidate/cand1/reroll');
  });

  it('renders no pending-candidate section when nothing is awaiting approval', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.text).not.toContain('/status/candidate/');
  });
});

describe('POST /status/candidate/:id/approve', () => {
  it('rejects a request with no Authorization header, and does not approve', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/candidate/cand1/approve');
    expect(res.status).toBe(401);
    expect(noCandidates.approve).not.toHaveBeenCalled();
  });

  it('approves the candidate and redirects back to /status', async () => {
    const candidates = {
      getPending: vi.fn(),
      approve: vi.fn().mockResolvedValue({ draftId: 'draft1', title: 'Teriyaki Chicken Casserole', sourceMealDbId: '52772' }),
      reroll: vi.fn(),
    };
    const app = createApp(fakeDb, [], candidates, noAffiliateCandidates);
    const res = await request(app).post('/status/candidate/cand1/approve').auth('test-user', 'test-password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(candidates.approve).toHaveBeenCalledWith('cand1');
  });

  it('returns 500 (not a hang) when approve rejects', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn().mockRejectedValue(new Error('boom')), reroll: vi.fn() };
    const app = createApp(fakeDb, [], candidates, noAffiliateCandidates);
    const res = await request(app).post('/status/candidate/cand1/approve').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('boom');
  });
});

describe('POST /status/candidate/:id/reroll', () => {
  it('rejects a request with no Authorization header, and does not reroll', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/candidate/cand1/reroll');
    expect(res.status).toBe(401);
    expect(noCandidates.reroll).not.toHaveBeenCalled();
  });

  it('rerolls the candidate and redirects back to /status', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn(), reroll: vi.fn().mockResolvedValue(null) };
    const app = createApp(fakeDb, [], candidates, noAffiliateCandidates);
    const res = await request(app).post('/status/candidate/cand1/reroll').auth('test-user', 'test-password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(candidates.reroll).toHaveBeenCalledWith('cand1');
  });

  it('returns 500 (not a hang) when reroll rejects', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn(), reroll: vi.fn().mockRejectedValue(new Error('boom')) };
    const app = createApp(fakeDb, [], candidates, noAffiliateCandidates);
    const res = await request(app).post('/status/candidate/cand1/reroll').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('boom');
  });
});

describe('POST /status/run/:jobName', () => {
  it('runs the named job and redirects back to /status', async () => {
    runJobNowMock.mockResolvedValue({ outcome: 'ran', job: 'recipe-variant-generator', status: 'success', summary: 'ok' });
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/run/recipe-variant-generator').auth('test-user', 'test-password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(runJobNowMock).toHaveBeenCalledWith(fakeDb, expect.any(Array), 'recipe-variant-generator');
  });

  it('returns 404 for an unknown job name', async () => {
    runJobNowMock.mockResolvedValue(null);
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/run/nope').auth('test-user', 'test-password');
    expect(res.status).toBe(404);
  });

  it('returns 500 (not a hang) when runJobNow rejects', async () => {
    runJobNowMock.mockRejectedValue(new Error('boom'));
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/run/recipe-variant-generator').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('boom');
  });
});

const affiliateCandidate = {
  id: 7,
  cycleId: '2026-W35',
  asin: 'B0EXAMPLE1',
  title: 'Ceramic Mixing Bowl Set',
  category: 'Kitchen',
  priceCents: 2999,
  imageUrl: 'https://example.com/bowl.jpg',
  productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03,
  commissionRateIsFallback: false,
  estimatedMonthlySales: 450,
  bsr: 1200,
  bsrCategory: 'Kitchen',
  rating: 4.6,
  reviewCount: 812,
  score: 0.71,
  isWildcard: false,
  status: 'pending' as const,
  decidedAt: null,
  createdAt: new Date('2026-08-24T00:00:00Z'),
};

describe('GET /status affiliate candidates', () => {
  it('renders each pending affiliate candidate with approve/deny actions', async () => {
    const affiliates = {
      getPending: vi.fn().mockResolvedValue([affiliateCandidate]),
      approve: vi.fn(),
      deny: vi.fn(),
    };
    const app = createApp(fakeDb, [], noCandidates, affiliates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ceramic Mixing Bowl Set');
    expect(res.text).toContain('/status/affiliate-candidates/7/approve');
    expect(res.text).toContain('/status/affiliate-candidates/7/deny');
  });

  it('renders no affiliate-candidate section when none are pending', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.text).not.toContain('/status/affiliate-candidates/');
  });

  it('returns 500 (not a hang) when the affiliate getPending rejects', async () => {
    const affiliates = { getPending: vi.fn().mockRejectedValue(new Error('db down')), approve: vi.fn(), deny: vi.fn() };
    const app = createApp(fakeDb, [], noCandidates, affiliates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('db down');
  });
});

describe('POST /status/affiliate-candidates/:id/approve', () => {
  it('rejects a request with no Authorization header, and does not approve', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/affiliate-candidates/7/approve');
    expect(res.status).toBe(401);
    expect(noAffiliateCandidates.approve).not.toHaveBeenCalled();
  });

  it('approves the candidate by numeric id and redirects back to /status', async () => {
    const affiliates = {
      getPending: vi.fn(),
      approve: vi
        .fn()
        .mockResolvedValue({ asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set', path: 'src/content/affiliate-links/x.json' }),
      deny: vi.fn(),
    };
    const app = createApp(fakeDb, [], noCandidates, affiliates);
    const res = await request(app).post('/status/affiliate-candidates/7/approve').auth('test-user', 'test-password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(affiliates.approve).toHaveBeenCalledWith(7);
  });

  it('returns 500 (not a hang) when approve rejects', async () => {
    const affiliates = { getPending: vi.fn(), approve: vi.fn().mockRejectedValue(new Error('boom')), deny: vi.fn() };
    const app = createApp(fakeDb, [], noCandidates, affiliates);
    const res = await request(app).post('/status/affiliate-candidates/7/approve').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('boom');
  });
});

describe('POST /status/affiliate-candidates/:id/deny', () => {
  it('rejects a request with no Authorization header, and does not deny', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/affiliate-candidates/7/deny');
    expect(res.status).toBe(401);
    expect(noAffiliateCandidates.deny).not.toHaveBeenCalled();
  });

  it('denies the candidate by numeric id and redirects back to /status', async () => {
    const affiliates = {
      getPending: vi.fn(),
      approve: vi.fn(),
      deny: vi.fn().mockResolvedValue({ asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set' }),
    };
    const app = createApp(fakeDb, [], noCandidates, affiliates);
    const res = await request(app).post('/status/affiliate-candidates/7/deny').auth('test-user', 'test-password');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(affiliates.deny).toHaveBeenCalledWith(7);
  });

  it('returns 500 (not a hang) when deny rejects', async () => {
    const affiliates = { getPending: vi.fn(), approve: vi.fn(), deny: vi.fn().mockRejectedValue(new Error('boom')) };
    const app = createApp(fakeDb, [], noCandidates, affiliates);
    const res = await request(app).post('/status/affiliate-candidates/7/deny').auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).toContain('boom');
  });
});
