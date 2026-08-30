export type RunStatus = 'running' | 'success' | 'partial' | 'failure';

export interface OrchestratorRun {
  id: number;
  jobName: string;
  status: RunStatus;
  summary: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}
