import type { Queryable } from './client.js';
import type { OrchestratorRun, RunStatus } from './types.js';

type RawRun = {
  id: number;
  job_name: string;
  status: RunStatus;
  summary: string | null;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
};

function mapRow(row: RawRun): OrchestratorRun {
  return {
    id: row.id,
    jobName: row.job_name,
    status: row.status,
    summary: row.summary,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function insertRunningRow(db: Queryable, jobName: string): Promise<number> {
  const result = await db.query<{ id: number }>(
    `INSERT INTO orchestrator_runs (job_name, status) VALUES ($1, 'running') RETURNING id`,
    [jobName],
  );
  return result.rows[0].id;
}

export async function finishRun(
  db: Queryable,
  id: number,
  status: Extract<RunStatus, 'success' | 'partial' | 'failure'>,
  summary: string | null,
): Promise<void> {
  await db.query(
    `UPDATE orchestrator_runs SET status = $2, summary = $3, finished_at = now() WHERE id = $1`,
    [id, status, summary],
  );
}

export async function failRun(db: Queryable, id: number, errorMessage: string): Promise<void> {
  await db.query(
    `UPDATE orchestrator_runs SET status = 'failure', error_message = $2, finished_at = now() WHERE id = $1`,
    [id, errorMessage],
  );
}

export async function getLatestSuccess(db: Queryable, jobName: string): Promise<OrchestratorRun | null> {
  const result = await db.query<RawRun>(
    `SELECT * FROM orchestrator_runs WHERE job_name = $1 AND status IN ('success', 'partial') ORDER BY finished_at DESC LIMIT 1`,
    [jobName],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getRecentRunning(
  db: Queryable,
  jobName: string,
  sinceMs: number,
): Promise<OrchestratorRun | null> {
  const result = await db.query<RawRun>(
    `SELECT * FROM orchestrator_runs WHERE job_name = $1 AND status = 'running' AND started_at >= $2 ORDER BY started_at DESC LIMIT 1`,
    [jobName, new Date(Date.now() - sinceMs)],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getRunHistory(db: Queryable, jobName: string, limit: number): Promise<OrchestratorRun[]> {
  const result = await db.query<RawRun>(
    `SELECT * FROM orchestrator_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT $2`,
    [jobName, limit],
  );
  return result.rows.map(mapRow);
}
