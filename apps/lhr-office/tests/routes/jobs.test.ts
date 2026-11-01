import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const getRunHistoryMock = vi.fn();
const upsertJobTuningMock = vi.fn();
vi.mock('@lhr/db', () => ({
  getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args),
  upsertJobTuning: (...args: unknown[]) => upsertJobTuningMock(...args),
}));

const runJobNowMock = vi.fn();
vi.mock('../../src/orchestrate.js', () => ({ runJobNow: (...args: unknown[]) => runJobNowMock(...args) }));

const effectiveCadenceMock = vi.fn();
const resolveProseCatalogMock = vi.fn();
vi.mock('../../src/resolveJobTuning.js', () => ({
  effectiveCadence: (...args: unknown[]) => effectiveCadenceMock(...args),
  resolveProseCatalog: (...args: unknown[]) => resolveProseCatalogMock(...args),
}));

vi.mock('../../src/jobProseCatalog.js', () => ({
  JOB_PROSE_CATALOG: {
    'recipe-variant-generator': [
      { id: 'narrative', title: 'Narrative persona', source: 'inline', editable: true, defaultText: 'default narrative' },
    ],
    'trends-watcher': [
      { id: 'suggest', title: 'Suggest persona', source: 'inline', editable: true, defaultText: 'default suggest' },
      { id: 'strategist', title: 'strategist persona', source: 'repo', editable: false, defaultText: '(repo)' },
    ],
  },
}));

const { createJobsRouter } = await import('../../src/routes/jobs');

const fakeDb = {} as Queryable;

function buildApp(registry = [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter(fakeDb, registry));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  effectiveCadenceMock.mockResolvedValue(new Map([['recipe-variant-generator', 7]]));
  resolveProseCatalogMock.mockResolvedValue([
    { id: 'narrative', title: 'Narrative persona', source: 'inline', editable: true, text: 'default narrative' },
  ]);
});

describe('GET /api/jobs', () => {
  it("returns each registered job's name, default + effective cadence, prose catalog, and history", async () => {
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
        defaultCadenceDays: 7,
        cadenceDays: 7,
        prose: [{ id: 'narrative', title: 'Narrative persona', source: 'inline', editable: true, text: 'default narrative' }],
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

  it('reflects a DB cadence override in cadenceDays while defaultCadenceDays stays the registry value', async () => {
    getRunHistoryMock.mockResolvedValue([]);
    effectiveCadenceMock.mockResolvedValue(new Map([['recipe-variant-generator', 14]]));

    const res = await request(buildApp()).get('/api/jobs');

    expect(res.body[0].defaultCadenceDays).toBe(7);
    expect(res.body[0].cadenceDays).toBe(14);
  });

  it('returns an empty array when no jobs are registered', async () => {
    getRunHistoryMock.mockResolvedValue([]);
    effectiveCadenceMock.mockResolvedValue(new Map());
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

describe('PATCH /api/jobs/:jobName/tuning', () => {
  it('saves a cadence override and returns the saved tuning', async () => {
    upsertJobTuningMock.mockResolvedValue({
      jobName: 'recipe-variant-generator',
      cadenceDays: 14,
      proseOverrides: {},
      updatedAt: new Date('2026-10-30T00:00:00Z'),
    });

    const res = await request(buildApp()).patch('/api/jobs/recipe-variant-generator/tuning').send({ cadenceDays: 14 });

    expect(res.status).toBe(200);
    expect(upsertJobTuningMock).toHaveBeenCalledWith(fakeDb, 'recipe-variant-generator', { cadenceDays: 14, prose: {} });
    expect(res.body).toEqual({ jobName: 'recipe-variant-generator', cadenceDays: 14, proseOverrides: {} });
  });

  it('saves only editable prose keys, silently dropping unknown/read-only ids', async () => {
    const registry = [{ name: 'trends-watcher', cadenceDays: 7, run: vi.fn() }];
    upsertJobTuningMock.mockResolvedValue({
      jobName: 'trends-watcher',
      cadenceDays: null,
      proseOverrides: { suggest: 'New suggest text' },
      updatedAt: new Date(),
    });

    const res = await request(buildApp(registry))
      .patch('/api/jobs/trends-watcher/tuning')
      .send({ prose: { suggest: 'New suggest text', strategist: 'should be dropped (read-only)', bogus: 'should be dropped (unknown)' } });

    expect(res.status).toBe(200);
    expect(upsertJobTuningMock).toHaveBeenCalledWith(fakeDb, 'trends-watcher', {
      cadenceDays: undefined,
      prose: { suggest: 'New suggest text' },
    });
  });

  it('returns 404 for an unknown job name without touching the DB', async () => {
    const res = await request(buildApp()).patch('/api/jobs/unknown-job/tuning').send({ cadenceDays: 5 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown job' });
    expect(upsertJobTuningMock).not.toHaveBeenCalled();
  });

  it('rejects a non-positive cadenceDays with 400', async () => {
    const res = await request(buildApp()).patch('/api/jobs/recipe-variant-generator/tuning').send({ cadenceDays: 0 });
    expect(res.status).toBe(400);
    expect(upsertJobTuningMock).not.toHaveBeenCalled();
  });

  it('returns 500 (not a hang) when upsertJobTuning rejects', async () => {
    upsertJobTuningMock.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).patch('/api/jobs/recipe-variant-generator/tuning').send({ cadenceDays: 10 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});
