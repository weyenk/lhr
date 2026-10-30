// tests/bridge/hubClient.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHubClient, HubClientError } from '../../src/bridge/hubClient.js';

const config = {
  hubUrl: 'https://hub.example/api/v1',
  tenantKey: 'tenant-secret',
};

const sampleJob = {
  id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'lhr',
  kind: 'studio',
  status: 'queued',
  payload: { goal: 'hi', repo_key: 'lhr' },
  result: null,
  error_message: null,
  created_by: 'user-1',
  channel: 'web',
  channel_ref: null,
  worker_id: null,
  claimed_at: null,
  finished_at: null,
  created_at: '2026-10-30T00:00:00.000Z',
  updated_at: '2026-10-30T00:00:00.000Z',
};

describe('createHubClient', () => {
  const fetchMock = vi.fn();
  beforeEach(() => fetchMock.mockReset());

  it('POSTs enqueue with tenant bearer, created_by, channel web, and data-only payload', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ job: sampleJob }), { status: 201 }),
    );
    const client = createHubClient(config, fetchMock);
    const job = await client.enqueueStudio('user-1', { goal: 'hi', repo_key: 'lhr' });
    expect(job.id).toBe(sampleJob.id);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hub.example/api/v1/jobs');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tenant-secret');
    expect(JSON.parse(init.body)).toEqual({
      kind: 'studio',
      created_by: 'user-1',
      channel: 'web',
      payload: { goal: 'hi', repo_key: 'lhr' },
    });
  });

  it('GETs a job with X-Created-By', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ job: sampleJob }), { status: 200 }),
    );
    const client = createHubClient(config, fetchMock);
    await client.getJob('user-1', sampleJob.id);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://hub.example/api/v1/jobs/${sampleJob.id}`);
    expect(init.headers['X-Created-By']).toBe('user-1');
    expect(init.headers.authorization).toBe('Bearer tenant-secret');
  });

  it('lists jobs for X-Created-By', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ jobs: [sampleJob] }), { status: 200 }),
    );
    const client = createHubClient(config, fetchMock);
    const jobs = await client.listJobs('user-1');
    expect(jobs).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hub.example/api/v1/jobs');
    expect(init.headers['X-Created-By']).toBe('user-1');
  });

  it('throws HubClientError on 401 without leaking the key in the message', async () => {
    fetchMock.mockImplementation(() => new Response('{"error":"no"}', { status: 401 }));
    const client = createHubClient(config, fetchMock);
    await expect(client.listJobs('user-1')).rejects.toBeInstanceOf(HubClientError);
    await expect(client.listJobs('user-1')).rejects.toThrow(/401/);
    try {
      await client.listJobs('user-1');
    } catch (e) {
      expect(String(e)).not.toContain('tenant-secret');
    }
  });
});
