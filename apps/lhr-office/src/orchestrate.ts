import type { Queryable } from '@lhr/db';
import { getLatestSuccess, getRecentRunning, insertRunningRow, finishRun, failRun } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { isDue, selectMostOverdue } from '@lhr/jobs';

const OVERLAP_WINDOW_MS = 10 * 60 * 1000;

export type OrchestrationOutcome =
  | { outcome: 'nothing-due' }
  | { outcome: 'skipped'; job: string; reason: 'already-running' }
  | { outcome: 'ran'; job: string; status: 'success' | 'partial' | 'failure'; summary: string };

export async function runDueJob(db: Queryable, registry: JobRegistration[]): Promise<OrchestrationOutcome> {
  const now = new Date();
  const lastSuccessAt = new Map<string, Date | null>();
  const due: JobRegistration[] = [];

  for (const candidate of registry) {
    const latest = await getLatestSuccess(db, candidate.name);
    const finishedAt = latest?.finishedAt ?? null;
    lastSuccessAt.set(candidate.name, finishedAt);
    if (isDue(candidate.cadenceDays, finishedAt, now)) due.push(candidate);
  }

  const selected = selectMostOverdue(due, lastSuccessAt, now);
  if (!selected) return { outcome: 'nothing-due' };

  return runIfNotOverlapping(db, selected);
}

export async function runJobNow(
  db: Queryable,
  registry: JobRegistration[],
  jobName: string,
): Promise<OrchestrationOutcome | null> {
  const job = registry.find((candidate) => candidate.name === jobName);
  if (!job) return null;
  return runIfNotOverlapping(db, job);
}

async function runIfNotOverlapping(db: Queryable, job: JobRegistration): Promise<OrchestrationOutcome> {
  const running = await getRecentRunning(db, job.name, OVERLAP_WINDOW_MS);
  if (running) return { outcome: 'skipped', job: job.name, reason: 'already-running' };

  const id = await insertRunningRow(db, job.name);
  try {
    const result = await job.run();
    await finishRun(db, id, result.status, result.summary);
    return { outcome: 'ran', job: job.name, status: result.status, summary: result.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(db, id, message);
    return { outcome: 'ran', job: job.name, status: 'failure', summary: message };
  }
}
