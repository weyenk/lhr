export type BridgeJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type BridgeJob = {
  id: string;
  tenant_id: string;
  kind: string;
  status: BridgeJobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_by: string;
  channel: string | null;
  channel_ref: string | null;
  worker_id: string | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioEnqueueInput = {
  goal: string;
  repo_key?: 'lhr' | 'ecff';
};
