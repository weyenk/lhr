import type { JobRegistration } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isDue(cadenceDays: number, lastSuccessAt: Date | null, now: Date): boolean {
  if (lastSuccessAt === null) return true;
  return now.getTime() - lastSuccessAt.getTime() >= cadenceDays * MS_PER_DAY;
}

export function selectMostOverdue(
  candidates: JobRegistration[],
  lastSuccessAt: ReadonlyMap<string, Date | null>,
  now: Date,
): JobRegistration | null {
  let best: JobRegistration | null = null;
  let bestOverdueMs = -Infinity;

  for (const candidate of candidates) {
    const lastAt = lastSuccessAt.get(candidate.name) ?? null;
    const overdueMs = now.getTime() - (lastAt ? lastAt.getTime() : 0);
    if (overdueMs > bestOverdueMs) {
      bestOverdueMs = overdueMs;
      best = candidate;
    }
  }

  return best;
}
