export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
}

export type Job = () => Promise<JobResult>;

export interface JobRegistration {
  name: string;
  cadenceDays: number;
  run: Job;
}
