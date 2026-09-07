import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const getRunHistoryMock = vi.fn();
vi.mock('@lhr/db', () => ({ getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args) }));

const runJobNowMock = vi.fn();
vi.mock('../../src/orchestrate.js', () => ({ runJobNow: (...args: unknown[]) => runJobNowMock(...args) }));

const { createJobsRouter } = await import('../../src/routes/jobs');

const fakeDb = {} as Queryable;

function buildApp(registry = [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter(fakeDb, registry));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/jobs', () => {
  it("returns each registered job's name, cadence, and history", async () => {
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
    const res = await request(buildApp()).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        name: 'recipe-variant-generator',
        cadenceDays: 7,
        history: [
          {
            id: 1,
            jobName: 'recipe-variant-generator',
            status: 'success',
            summary: 'generated 1 variant',
            errorMessage: null,
            startedAt: '2026-08-20T00:00:00.000Z',
            finishedAt: '2026-08-20T00:05:00.000Z',
          },
        ],
      },
    ]);
  });

  it('returns an empty array when no jobs are registered', async () => {
    const res = await request(buildApp([])).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 (not a hang) when getRunHistory rejects', async () => {
    getRunHistoryMock.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).get('/api/jobs');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});

describe('POST /api/jobs/:jobName/run', () => {
  it('runs the named job and returns its outcome', async () => {
    runJobNowMock.mockResolvedValue({ outcome: 'ran', jobName: 'recipe-variant-generator' });
    const res = await request(buildApp()).post('/api/jobs/recipe-variant-generator/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'ran', jobName: 'recipe-variant-generator' });
  });

  it('returns 404 for an unknown job name', async () => {
    runJobNowMock.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/jobs/unknown-job/run');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown job' });
  });

  it('returns 500 (not a hang) when runJobNow rejects', async () => {
    runJobNowMock.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post('/api/jobs/recipe-variant-generator/run');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
