// src/bridge/hubClient.ts
import type { BridgeConfig } from './config.js';
import type { BridgeJob, StudioEnqueueInput } from './types.js';

export class HubClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HubClientError';
    this.status = status;
  }
}

type FetchLike = typeof fetch;

function headers(tenantKey: string, createdBy?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${tenantKey}`,
    'content-type': 'application/json',
  };
  if (createdBy) h['X-Created-By'] = createdBy;
  return h;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export function createHubClient(config: BridgeConfig, fetchImpl: FetchLike = fetch) {
  const base = config.hubUrl.replace(/\/$/, '');

  async function enqueueStudio(
    createdBy: string,
    input: StudioEnqueueInput,
  ): Promise<BridgeJob> {
    const res = await fetchImpl(`${base}/jobs`, {
      method: 'POST',
      headers: headers(config.tenantKey),
      body: JSON.stringify({
        kind: 'studio',
        created_by: createdBy,
        channel: 'web',
        payload: {
          goal: input.goal,
          ...(input.repo_key ? { repo_key: input.repo_key } : {}),
        },
      }),
    });
    const data = (await readJson(res)) as { job?: BridgeJob; error?: string };
    if (res.status !== 201 || !data.job) {
      throw new HubClientError(res.status, data.error ?? `hub enqueue failed (${res.status})`);
    }
    return data.job;
  }

  async function getJob(createdBy: string, id: string): Promise<BridgeJob> {
    const res = await fetchImpl(`${base}/jobs/${id}`, {
      method: 'GET',
      headers: headers(config.tenantKey, createdBy),
    });
    const data = (await readJson(res)) as { job?: BridgeJob; error?: string };
    if (!res.ok || !data.job) {
      throw new HubClientError(res.status, data.error ?? `hub get failed (${res.status})`);
    }
    return data.job;
  }

  async function listJobs(createdBy: string): Promise<BridgeJob[]> {
    const res = await fetchImpl(`${base}/jobs`, {
      method: 'GET',
      headers: headers(config.tenantKey, createdBy),
    });
    const data = (await readJson(res)) as { jobs?: BridgeJob[]; error?: string };
    if (!res.ok || !Array.isArray(data.jobs)) {
      throw new HubClientError(
        res.status,
        data.error ? `${data.error} (${res.status})` : `hub list failed (${res.status})`,
      );
    }
    return data.jobs;
  }

  return { enqueueStudio, getJob, listJobs };
}

export type HubClient = ReturnType<typeof createHubClient>;
