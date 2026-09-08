import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Queryable } from '@lhr/db';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';

const runDueJobMock = vi.fn();
const runJobNowMock = vi.fn();
vi.mock('../src/orchestrate', () => ({
  runDueJob: (...args: unknown[]) => runDueJobMock(...args),
  runJobNow: (...args: unknown[]) => runJobNowMock(...args),
}));

const getRunHistoryMock = vi.fn();
const getLatestPendingCycleIdMock = vi.fn();
const getPendingCandidatesMock = vi.fn();
const setTopicStatusMock = vi.fn();
const addCuratedTopicMock = vi.fn();
const getAllTopicsMock = vi.fn();
const listRecentReportsMock = vi.fn();
const listCompetitorsByStatusMock = vi.fn();
const setCompetitorStatusMock = vi.fn();
const listRecentCompetitorReportsMock = vi.fn();
const listKeywordsMock = vi.fn();
const addKeywordMock = vi.fn();
const removeKeywordMock = vi.fn();
vi.mock('@lhr/db', () => ({
  getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args),
  getLatestPendingCycleId: (...args: unknown[]) => getLatestPendingCycleIdMock(...args),
  getPendingCandidates: (...args: unknown[]) => getPendingCandidatesMock(...args),
  setTopicStatus: (...args: unknown[]) => setTopicStatusMock(...args),
  addCuratedTopic: (...args: unknown[]) => addCuratedTopicMock(...args),
  getAllTopics: (...args: unknown[]) => getAllTopicsMock(...args),
  listRecentReports: (...args: unknown[]) => listRecentReportsMock(...args),
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  listCompetitorsByStatus: (...args: unknown[]) => listCompetitorsByStatusMock(...args),
  setCompetitorStatus: (...args: unknown[]) => setCompetitorStatusMock(...args),
  listRecentCompetitorReports: (...args: unknown[]) => listRecentCompetitorReportsMock(...args),
  listKeywords: (...args: unknown[]) => listKeywordsMock(...args),
  addKeyword: (...args: unknown[]) => addKeywordMock(...args),
  removeKeyword: (...args: unknown[]) => removeKeywordMock(...args),
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

// Supabase signs real session tokens with ES256 (asymmetric JWT signing keys), verified via the
// project's JWKS endpoint rather than a shared secret — see src/authMiddleware.ts.
const JWKS_KID = 'test-kid';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const publicJwk = { ...(await exportJWK(publicKey)), kid: JWKS_KID, alg: 'ES256', use: 'sig' };

function validToken() {
  return new SignJWT({ sub: 'user-1', role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: JWKS_KID })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  noCandidates.getPending.mockResolvedValue(null);
  noAffiliateCandidates.getPending.mockResolvedValue([]);
  getLatestPendingCycleIdMock.mockResolvedValue(null);
  getPendingCandidatesMock.mockResolvedValue([]);
  getAllTopicsMock.mockResolvedValue([]);
  listRecentReportsMock.mockResolvedValue([]);
  listCompetitorsByStatusMock.mockResolvedValue([]);
  listRecentCompetitorReportsMock.mockResolvedValue([]);
  listKeywordsMock.mockResolvedValue([]);
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

describe('/api/* auth', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url) === 'https://test.supabase.co/auth/v1/.well-known/jwks.json') {
          return new Response(JSON.stringify({ keys: [publicJwk] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch to ${String(url)}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects GET /api/jobs with no Authorization header', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
  });

  it('allows GET /api/jobs with a valid bearer token', async () => {
    getRunHistoryMock.mockResolvedValue([]);
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/jobs').set('Authorization', `Bearer ${await validToken()}`);
    expect(res.status).toBe(200);
  });

  it('rejects GET /api/candidates/recipe, /api/trends, and /api/competitors with no token', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    for (const path of ['/api/candidates/recipe', '/api/trends', '/api/competitors']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });
});

describe('static SPA serving', () => {
  // Client assets are inlined into the server bundle at build time (see
  // scripts/bundle.mjs and clientAssets.generated.ts) rather than read from disk —
  // Vercel's file-tracing did not reliably package a runtime-read client/dist
  // directory into the deployed function (a real production incident: every page
  // load 404'd because /var/task/client/dist was missing despite the build
  // producing it). createApp's 5th parameter injects a fake asset map for tests.
  const html = Buffer.from('<!doctype html><title>lhr office</title>').toString('base64');
  const js = Buffer.from('console.log("hi")').toString('base64');
  const fakeAssets = {
    '/index.html': { contentType: 'text/html; charset=utf-8', base64: html },
    '/assets/index-abc123.js': { contentType: 'text/javascript; charset=utf-8', base64: js },
  };

  it('serves index.html for a non-API GET route (SPA fallback)', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, fakeAssets);
    const res = await request(app).get('/agents-jobs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('lhr office');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('serves an exact asset match with its own content type and a long-lived cache header', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, fakeAssets);
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log');
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('does not shadow a real 404 from an /api/* route', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, fakeAssets);
    const res = await request(app).get('/api/does-not-exist').set('Authorization', `Bearer ${await validToken()}`);
    expect(res.status).toBe(404);
  });

  it('responds (does not hang) when index.html is missing from the asset map', async () => {
    // Regression test: a prior version passed a callback to res.sendFile that only
    // logged the error and never sent a response, which left the request hanging
    // until the platform's function timeout (the same production incident
    // referenced above). The in-memory lookup here can't hang the way a disk read
    // could, but this still guards the "no fallback available" path.
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, {});
    const res = await request(app).get('/agents-jobs');
    expect(res.status).toBe(404);
  });
});
