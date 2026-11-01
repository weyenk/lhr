import type { Queryable } from './client.js';

export interface JobTuning {
  jobName: string;
  cadenceDays: number | null;
  proseOverrides: Record<string, string>;
  updatedAt: Date;
}

type JobTuningRow = {
  job_name: string;
  cadence_days: number | null;
  prose_overrides: Record<string, string>;
  updated_at: Date;
};

function mapRow(row: JobTuningRow): JobTuning {
  return {
    jobName: row.job_name,
    cadenceDays: row.cadence_days,
    proseOverrides: row.prose_overrides ?? {},
    updatedAt: row.updated_at,
  };
}

export async function getJobTuning(db: Queryable, jobName: string): Promise<JobTuning | null> {
  const result = await db.query<JobTuningRow>(`SELECT * FROM job_tuning WHERE job_name = $1`, [jobName]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listJobTuning(db: Queryable): Promise<JobTuning[]> {
  const result = await db.query<JobTuningRow>(`SELECT * FROM job_tuning`);
  return result.rows.map(mapRow);
}

export interface JobTuningPatch {
  cadenceDays?: number;
  prose?: Record<string, string>;
}

/**
 * Upserts a job's tuning row. `cadenceDays` is only overwritten when provided — omitting it
 * (via COALESCE) keeps any previously-saved override. `prose` is shallow-merged into the
 * existing `prose_overrides` JSONB (via `||`) rather than replacing the whole column, so saving
 * one prose field never clobbers another field saved in a previous PATCH.
 */
export async function upsertJobTuning(db: Queryable, jobName: string, patch: JobTuningPatch): Promise<JobTuning> {
  const result = await db.query<JobTuningRow>(
    `INSERT INTO job_tuning (job_name, cadence_days, prose_overrides)
     VALUES ($1, $2, COALESCE($3::jsonb, '{}'::jsonb))
     ON CONFLICT (job_name) DO UPDATE SET
       cadence_days = COALESCE($2, job_tuning.cadence_days),
       prose_overrides = job_tuning.prose_overrides || COALESCE($3::jsonb, '{}'::jsonb),
       updated_at = now()
     RETURNING *`,
    [jobName, patch.cadenceDays ?? null, JSON.stringify(patch.prose ?? {})],
  );
  return mapRow(result.rows[0]);
}
