import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const listCompetitorsByStatusMock = vi.fn();
const setCompetitorStatusMock = vi.fn();
const listRecentCompetitorReportsMock = vi.fn();
const listKeywordsMock = vi.fn();
const addKeywordMock = vi.fn();
const removeKeywordMock = vi.fn();
const listDiscoveryQueriesMock = vi.fn();
const addDiscoveryQueryMock = vi.fn();
const removeDiscoveryQueryMock = vi.fn();
const upsertTrackedCompetitorMock = vi.fn();

vi.mock('@lhr/db', () => ({
  listCompetitorsByStatus: (...args: unknown[]) => listCompetitorsByStatusMock(...args),
  setCompetitorStatus: (...args: unknown[]) => setCompetitorStatusMock(...args),
  listRecentCompetitorReports: (...args: unknown[]) => listRecentCompetitorReportsMock(...args),
  listKeywords: (...args: unknown[]) => listKeywordsMock(...args),
  addKeyword: (...args: unknown[]) => addKeywordMock(...args),
  removeKeyword: (...args: unknown[]) => removeKeywordMock(...args),
  listDiscoveryQueries: (...args: unknown[]) => listDiscoveryQueriesMock(...args),
  addDiscoveryQuery: (...args: unknown[]) => addDiscoveryQueryMock(...args),
  removeDiscoveryQuery: (...args: unknown[]) => removeDiscoveryQueryMock(...args),
  upsertTrackedCompetitor: (...args: unknown[]) => upsertTrackedCompetitorMock(...args),
}));

const { createCompetitorsRouter } = await import('../../src/routes/competitors');

const fakeDb = {} as Queryable;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/competitors', createCompetitorsRouter(fakeDb));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  listCompetitorsByStatusMock.mockResolvedValue([]);
  listRecentCompetitorReportsMock.mockResolvedValue([]);
  listKeywordsMock.mockResolvedValue([]);
  listDiscoveryQueriesMock.mockResolvedValue([]);
});

describe('GET /api/competitors', () => {
  it('returns tracked and candidate competitors with the latest report per tracked competitor', async () => {
    listCompetitorsByStatusMock.mockImplementation(async (_db, status) =>
      status === 'tracked' ? [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }] : [{ id: 2, domain: 'other.com', name: null, status: 'candidate' }],
    );
    const fullReport = {
      id: 10,
      competitorId: 1,
      cycleId: 'c1',
      generatedAt: new Date('2026-10-31T12:00:00Z'),
      newContent: [{ title: 'Post', url: 'https://example.com/post', publishedAt: null }],
      seoPositions: [{ keyword: 'gluten free recipes', position: 4 }],
      monetizationSnapshot: 'Sells cookbooks.',
      designSnapshot: 'Hero + grid.',
      summary: 'what changed',
      overlapScores: { market: 72, content: 68, product: 55, threat: 78 },
      decisionBrief: 'Closest mainstream neighbor.',
      suggestedActions: ['Double down on gluten-free POV'],
    };
    listRecentCompetitorReportsMock.mockResolvedValue([fullReport]);
    const res = await request(buildApp()).get('/api/competitors');
    expect(res.status).toBe(200);
    expect(res.body.tracked).toEqual([{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }]);
    expect(res.body.candidates).toEqual([{ id: 2, domain: 'other.com', name: null, status: 'candidate' }]);
    expect(res.body.latestReportsByCompetitorId['1']).toMatchObject({
      id: 10,
      competitorId: 1,
      cycleId: 'c1',
      summary: 'what changed',
      monetizationSnapshot: 'Sells cookbooks.',
      designSnapshot: 'Hero + grid.',
      overlapScores: { market: 72, content: 68, product: 55, threat: 78 },
      decisionBrief: 'Closest mainstream neighbor.',
      suggestedActions: ['Double down on gluten-free POV'],
      newContent: [{ title: 'Post', url: 'https://example.com/post', publishedAt: null }],
      seoPositions: [{ keyword: 'gluten free recipes', position: 4 }],
    });
  });

  it('omits a competitor from latestReportsByCompetitorId when it has no reports yet', async () => {
    listCompetitorsByStatusMock.mockImplementation(async (_db, status) =>
      status === 'tracked' ? [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }] : [],
    );
    listRecentCompetitorReportsMock.mockResolvedValue([]);
    const res = await request(buildApp()).get('/api/competitors');
    expect(res.body.latestReportsByCompetitorId).toEqual({});
  });
});

describe('POST /api/competitors', () => {
  it('upserts a tracked competitor from a domain', async () => {
    upsertTrackedCompetitorMock.mockResolvedValue({
      id: 3,
      domain: 'all-clad.com',
      name: null,
      status: 'tracked',
    });
    const res = await request(buildApp()).post('/api/competitors').send({ domain: 'https://www.all-clad.com/' });
    expect(res.status).toBe(201);
    expect(res.body.domain).toBe('all-clad.com');
    expect(upsertTrackedCompetitorMock).toHaveBeenCalledWith(fakeDb, 'https://www.all-clad.com/', null);
  });

  it('returns 400 when the domain is invalid', async () => {
    upsertTrackedCompetitorMock.mockRejectedValue(new Error('Enter a valid domain (e.g. example.com)'));
    const res = await request(buildApp()).post('/api/competitors').send({ domain: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid domain/i);
  });
});

describe('POST /api/competitors/:id/approve', () => {
  it('tracks the competitor', async () => {
    const res = await request(buildApp()).post('/api/competitors/1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setCompetitorStatusMock).toHaveBeenCalledWith(fakeDb, 1, 'tracked');
  });
});

describe('POST /api/competitors/:id/reject', () => {
  it('rejects the competitor', async () => {
    const res = await request(buildApp()).post('/api/competitors/1/reject');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setCompetitorStatusMock).toHaveBeenCalledWith(fakeDb, 1, 'rejected');
  });
});

describe('GET /api/competitors/keywords', () => {
  it('returns tracked keywords', async () => {
    listKeywordsMock.mockResolvedValue([{ id: 1, keyword: 'gluten free recipes' }]);
    const res = await request(buildApp()).get('/api/competitors/keywords');
    expect(res.body).toEqual([{ id: 1, keyword: 'gluten free recipes' }]);
  });
});

describe('POST /api/competitors/keywords', () => {
  it('adds a keyword and returns it', async () => {
    addKeywordMock.mockResolvedValue({ id: 2, keyword: 'kitchenware roundup' });
    const res = await request(buildApp()).post('/api/competitors/keywords').send({ keyword: 'kitchenware roundup' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, keyword: 'kitchenware roundup' });
    expect(addKeywordMock).toHaveBeenCalledWith(fakeDb, 'kitchenware roundup');
  });
});

describe('DELETE /api/competitors/keywords/:id', () => {
  it('removes the keyword', async () => {
    const res = await request(buildApp()).delete('/api/competitors/keywords/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeKeywordMock).toHaveBeenCalledWith(fakeDb, 2);
  });
});

describe('GET /api/competitors/discovery-queries', () => {
  it('returns discovery queries', async () => {
    listDiscoveryQueriesMock.mockResolvedValue([{ id: 1, query: 'gluten free recipe blog' }]);
    const res = await request(buildApp()).get('/api/competitors/discovery-queries');
    expect(res.body).toEqual([{ id: 1, query: 'gluten free recipe blog' }]);
  });
});

describe('POST /api/competitors/discovery-queries', () => {
  it('adds a discovery query', async () => {
    addDiscoveryQueryMock.mockResolvedValue({ id: 2, query: 'weeknight pasta blog' });
    const res = await request(buildApp()).post('/api/competitors/discovery-queries').send({ query: 'weeknight pasta blog' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 2, query: 'weeknight pasta blog' });
    expect(addDiscoveryQueryMock).toHaveBeenCalledWith(fakeDb, 'weeknight pasta blog');
  });
});

describe('DELETE /api/competitors/discovery-queries/:id', () => {
  it('removes a discovery query', async () => {
    const res = await request(buildApp()).delete('/api/competitors/discovery-queries/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeDiscoveryQueryMock).toHaveBeenCalledWith(fakeDb, 2);
  });
});
