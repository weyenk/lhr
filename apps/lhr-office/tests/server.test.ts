import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Queryable } from '@lhr/db';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';

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

function validToken() {
  return jwt.sign({ sub: 'user-1' }, 'test-jwt-secret', { algorithm: 'HS256' });
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
    process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
  });

  it('rejects GET /api/jobs with no Authorization header', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
  });

  it('allows GET /api/jobs with a valid bearer token', async () => {
    getRunHistoryMock.mockResolvedValue([]);
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/jobs').set('Authorization', `Bearer ${validToken()}`);
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
  it('serves the built index.html for a non-API GET route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lhr-office-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>lhr office</title>');
    try {
      const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, dir);
      const res = await request(app).get('/agents-jobs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('lhr office');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not shadow a real 404 from an /api/* route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lhr-office-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    try {
      const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, dir);
      const res = await request(app).get('/api/does-not-exist').set('Authorization', `Bearer ${validToken()}`);
      expect(res.status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
