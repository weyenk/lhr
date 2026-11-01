import type { Queryable } from '@lhr/db';
import { getJobTuning, listJobTuning } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { JOB_PROSE_CATALOG, type ProseCatalogEntry } from './jobProseCatalog.js';

export interface ResolvedProseEntry {
  id: string;
  title: string;
  source: ProseCatalogEntry['source'];
  editable: boolean;
  text: string;
  note?: string;
}

/** Effective cadence (in days) for every job in `registry` — a DB override from `job_tuning`
 * when one is saved, otherwise the registry's own default. Used by the orchestrator's due-check
 * and surfaced read-only on GET /api/jobs. */
export async function effectiveCadence(db: Queryable, registry: JobRegistration[]): Promise<Map<string, number>> {
  const overrides = await listJobTuning(db);
  const overrideByJob = new Map(overrides.map((row) => [row.jobName, row.cadenceDays]));
  const result = new Map<string, number>();
  for (const job of registry) {
    const override = overrideByJob.get(job.name);
    result.set(job.name, override != null ? override : job.cadenceDays);
  }
  return result;
}

/** A single prose override value — the DB override for `jobName`/`key` if one is saved, else
 * `fallback` (the code's own hardcoded default). */
export async function resolveProse(db: Queryable, jobName: string, key: string, fallback: string): Promise<string> {
  const tuning = await getJobTuning(db, jobName);
  return tuning?.proseOverrides[key] ?? fallback;
}

/** The full prose catalog for a job, each entry's `text` resolved to its DB override (when
 * editable and saved) or its catalog default otherwise. Used by GET /api/jobs to show the
 * author what's actually in effect for every prose field on a job, editable or not. */
export async function resolveProseCatalog(db: Queryable, jobName: string): Promise<ResolvedProseEntry[]> {
  const catalog = JOB_PROSE_CATALOG[jobName] ?? [];
  if (catalog.length === 0) return [];
  const tuning = await getJobTuning(db, jobName);
  return catalog.map((entry) => ({
    id: entry.id,
    title: entry.title,
    source: entry.source,
    editable: entry.editable,
    note: entry.note,
    text: entry.editable ? tuning?.proseOverrides[entry.id] ?? entry.defaultText : entry.defaultText,
  }));
}
