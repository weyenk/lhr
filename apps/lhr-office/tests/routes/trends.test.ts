import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const listRecentReportsMock = vi.fn();
const getAllTopicsMock = vi.fn();
const setTopicStatusMock = vi.fn();
const addCuratedTopicMock = vi.fn();

vi.mock('@lhr/db', () => ({
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  listRecentReports: (...args: unknown[]) => listRecentReportsMock(...args),
  getAllTopics: (...args: unknown[]) => getAllTopicsMock(...args),
  setTopicStatus: (...args: unknown[]) => setTopicStatusMock(...args),
  addCuratedTopic: (...args: unknown[]) => addCuratedTopicMock(...args),
}));

const { createTrendsRouter } = await import('../../src/routes/trends');

const fakeDb = {} as Queryable;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trends', createTrendsRouter(fakeDb));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  listRecentReportsMock.mockResolvedValue([]);
  getAllTopicsMock.mockResolvedValue([]);
});

describe('GET /api/trends', () => {
  it('returns reports across all categories and all topics', async () => {
    listRecentReportsMock.mockImplementation(async (_db, category) =>
      category === 'cooking' ? [{ id: 1, category: 'cooking', cycleId: 'c1', summary: 'summary' }] : [],
    );
    getAllTopicsMock.mockResolvedValue([{ id: 1, category: 'cooking', topic: 'sourdough', status: 'curated' }]);
    const res = await request(buildApp()).get('/api/trends');
    expect(res.status).toBe(200);
    expect(res.body.reports).toEqual([{ id: 1, category: 'cooking', cycleId: 'c1', summary: 'summary' }]);
    expect(res.body.topics).toEqual([{ id: 1, category: 'cooking', topic: 'sourdough', status: 'curated' }]);
  });

  it('returns 500 (not a hang) when a lookup rejects', async () => {
    getAllTopicsMock.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).get('/api/trends');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});

describe('POST /api/trends/topics', () => {
  it('adds a curated topic and returns it', async () => {
    addCuratedTopicMock.mockResolvedValue({ id: 5, category: 'cooking', topic: 'miso', status: 'curated' });
    const res = await request(buildApp()).post('/api/trends/topics').send({ category: 'cooking', topic: 'miso' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5, category: 'cooking', topic: 'miso', status: 'curated' });
    expect(addCuratedTopicMock).toHaveBeenCalledWith(fakeDb, 'cooking', 'miso');
  });
});

describe('POST /api/trends/topics/:id/promote', () => {
  it('promotes the topic', async () => {
    const res = await request(buildApp()).post('/api/trends/topics/5/promote');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setTopicStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'curated');
  });
});

describe('POST /api/trends/topics/:id/demote', () => {
  it('demotes the topic', async () => {
    const res = await request(buildApp()).post('/api/trends/topics/5/demote');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setTopicStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'candidate');
  });
});
