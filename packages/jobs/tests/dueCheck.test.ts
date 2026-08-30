import { describe, expect, it } from 'vitest';
import { isDue, selectMostOverdue } from '../src/dueCheck';
import type { JobRegistration } from '../src/types';

describe('isDue', () => {
  it('is due when there is no prior success', () => {
    expect(isDue(7, null, new Date('2026-08-25T00:00:00Z'))).toBe(true);
  });

  it('is not due when the last success is within the cadence window', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const lastSuccess = new Date('2026-08-20T00:00:00Z'); // 5 days ago
    expect(isDue(7, lastSuccess, now)).toBe(false);
  });

  it('is due when the last success is older than the cadence window', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const lastSuccess = new Date('2026-08-17T00:00:00Z'); // 8 days ago
    expect(isDue(7, lastSuccess, now)).toBe(true);
  });

  it('is due exactly at the cadence boundary', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const lastSuccess = new Date('2026-08-18T00:00:00Z'); // exactly 7 days ago
    expect(isDue(7, lastSuccess, now)).toBe(true);
  });
});

describe('selectMostOverdue', () => {
  const makeJob = (name: string): JobRegistration => ({
    name,
    cadenceDays: 7,
    run: async () => ({ status: 'success', summary: '' }),
  });

  it('returns null when there are no candidates', () => {
    expect(selectMostOverdue([], new Map(), new Date())).toBeNull();
  });

  it('picks the job whose last success is oldest', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const a = makeJob('a');
    const b = makeJob('b');
    const lastSuccessAt = new Map<string, Date | null>([
      ['a', new Date('2026-08-10T00:00:00Z')],
      ['b', new Date('2026-08-01T00:00:00Z')],
    ]);
    expect(selectMostOverdue([a, b], lastSuccessAt, now)).toBe(b);
  });

  it('treats a job with no prior success as more overdue than one with a recorded success', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const a = makeJob('a');
    const b = makeJob('b');
    const lastSuccessAt = new Map<string, Date | null>([['a', new Date('2020-01-01T00:00:00Z')]]); // b has no entry at all
    expect(selectMostOverdue([a, b], lastSuccessAt, now)).toBe(b);
  });
});
