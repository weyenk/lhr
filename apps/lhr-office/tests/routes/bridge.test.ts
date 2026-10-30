// tests/routes/bridge.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { HubClient } from '../../src/bridge/hubClient.js';

const enqueueStudio = vi.fn();
const getJob = vi.fn();
const listJobs = vi.fn();
const fakeClient = { enqueueStudio, getJob, listJobs } as unknown as HubClient;

const { createBridgeRouter } = await import('../../src/routes/bridge.js');

function buildApp(sub: string | null = 'user-sub-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (sub) req.authorSub = sub;
    next();
  });
  app.use('/api/bridge', createBridgeRouter(() => fakeClient));
  return app;
}

const job = {
  id: '22222222-2222-2222-2222-222222222222',
  tenant_id: 'lhr',
  kind: 'studio',
  status: 'queued',
  payload: { goal: 'ship it', repo_key: 'lhr' },
  result: null,
  error_message: null,
  created_by: 'user-sub-1',
  channel: 'web',
  channel_ref: null,
  worker_id: null,
  claimed_at: null,
  finished_at: null,
  created_at: '2026-10-30T00:00:00.000Z',
  updated_at: '2026-10-30T00:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

describe('POST /api/bridge/jobs', () => {
  it('enqueues studio with authorSub as created_by', async () => {
    enqueueStudio.mockResolvedValue(job);
    const res = await request(buildApp())
      .post('/api/bridge/jobs')
      .send({ goal: 'ship it', repo_key: 'lhr' });
    expect(res.status).toBe(201);
    expect(res.body.job.id).toBe(job.id);
    expect(enqueueStudio).toHaveBeenCalledWith('user-sub-1', {
      goal: 'ship it',
      repo_key: 'lhr',
    });
  });

  it('rejects empty goal with 400 and does not call hub', async () => {
    const res = await request(buildApp()).post('/api/bridge/jobs').send({ goal: '  ' });
    expect(res.status).toBe(400);
    expect(enqueueStudio).not.toHaveBeenCalled();
  });

  it('rejects unknown repo_key with 400', async () => {
    const res = await request(buildApp())
      .post('/api/bridge/jobs')
      .send({ goal: 'x', repo_key: '../etc' });
    expect(res.status).toBe(400);
    expect(enqueueStudio).not.toHaveBeenCalled();
  });

  it('returns 401 without authorSub and does not call hub', async () => {
    const res = await request(buildApp(null)).post('/api/bridge/jobs').send({ goal: 'x' });
    expect(res.status).toBe(401);
    expect(enqueueStudio).not.toHaveBeenCalled();
  });
});

describe('GET /api/bridge/jobs', () => {
  it('lists jobs for authorSub', async () => {
    listJobs.mockResolvedValue([job]);
    const res = await request(buildApp()).get('/api/bridge/jobs');
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(listJobs).toHaveBeenCalledWith('user-sub-1');
  });
});

describe('GET /api/bridge/jobs/:id', () => {
  it('returns one job', async () => {
    getJob.mockResolvedValue(job);
    const res = await request(buildApp()).get(`/api/bridge/jobs/${job.id}`);
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe(job.id);
    expect(getJob).toHaveBeenCalledWith('user-sub-1', job.id);
  });

  it('rejects invalid job id with 400 and does not call hub', async () => {
    const res = await request(buildApp()).get('/api/bridge/jobs/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid job id' });
    expect(getJob).not.toHaveBeenCalled();
  });

  it('maps hub 404 to 404', async () => {
    const { HubClientError } = await import('../../src/bridge/hubClient.js');
    getJob.mockRejectedValue(new HubClientError(404, 'not found'));
    const res = await request(buildApp()).get(`/api/bridge/jobs/${job.id}`);
    expect(res.status).toBe(404);
  });

  it('maps hub 401 to 502 without leaking the tenant key', async () => {
    const { HubClientError } = await import('../../src/bridge/hubClient.js');
    const tenantKey = 'secret-tenant-key-abc123';
    getJob.mockRejectedValue(new HubClientError(401, `unauthorized Bearer ${tenantKey}`));
    const res = await request(buildApp()).get(`/api/bridge/jobs/${job.id}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'job bus unavailable' });
    expect(JSON.stringify(res.body)).not.toContain(tenantKey);
  });

  it('maps other hub errors to 502', async () => {
    const { HubClientError } = await import('../../src/bridge/hubClient.js');
    listJobs.mockRejectedValue(new HubClientError(500, 'boom'));
    const res = await request(buildApp()).get('/api/bridge/jobs');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'job bus unavailable' });
  });
});
