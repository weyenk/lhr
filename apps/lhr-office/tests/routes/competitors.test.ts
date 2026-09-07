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

vi.mock('@lhr/db', () => ({
  listCompetitorsByStatus: (...args: unknown[]) => listCompetitorsByStatusMock(...args),
  setCompetitorStatus: (...args: unknown[]) => setCompetitorStatusMock(...args),
  listRecentCompetitorReports: (...args: unknown[]) => listRecentCompetitorReportsMock(...args),
  listKeywords: (...args: unknown[]) => listKeywordsMock(...args),
  addKeyword: (...args: unknown[]) => addKeywordMock(...args),
  removeKeyword: (...args: unknown[]) => removeKeywordMock(...args),
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
});

describe('GET /api/competitors', () => {
  it('returns tracked and candidate competitors with the latest report per tracked competitor', async () => {
    listCompetitorsByStatusMock.mockImplementation(async (_db, status) =>
      status === 'tracked' ? [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }] : [{ id: 2, domain: 'other.com', name: null, status: 'candidate' }],
    );
    listRecentCompetitorReportsMock.mockResolvedValue([{ id: 10, competitorId: 1, cycleId: 'c1', summary: 'what changed' }]);
    const res = await request(buildApp()).get('/api/competitors');
    expect(res.status).toBe(200);
    expect(res.body.tracked).toEqual([{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }]);
    expect(res.body.candidates).toEqual([{ id: 2, domain: 'other.com', name: null, status: 'candidate' }]);
    expect(res.body.latestReportsByCompetitorId).toEqual({ '1': { id: 10, competitorId: 1, cycleId: 'c1', summary: 'what changed' } });
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
