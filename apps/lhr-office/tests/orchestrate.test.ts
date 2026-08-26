import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { JobRegistration } from '@lhr/jobs';
import type { Queryable } from '@lhr/db';

const db = {
  getLatestSuccess: vi.fn(),
  getRecentRunning: vi.fn(),
  insertRunningRow: vi.fn(),
  finishRun: vi.fn(),
  failRun: vi.fn(),
};

vi.mock('@lhr/db', () => ({
  getLatestSuccess: (...args: unknown[]) => db.getLatestSuccess(...args),
  getRecentRunning: (...args: unknown[]) => db.getRecentRunning(...args),
  insertRunningRow: (...args: unknown[]) => db.insertRunningRow(...args),
  finishRun: (...args: unknown[]) => db.finishRun(...args),
  failRun: (...args: unknown[]) => db.failRun(...args),
}));

const { runDueJob, runJobNow } = await import('../src/orchestrate');

const fakeDb = {} as Queryable;

function job(name: string, run: JobRegistration['run'], cadenceDays = 7): JobRegistration {
  return { name, cadenceDays, run };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getLatestSuccess.mockResolvedValue(null);
  db.getRecentRunning.mockResolvedValue(null);
  db.insertRunningRow.mockResolvedValue(1);
});

describe('runDueJob', () => {
  it('returns nothing-due when no job is due', async () => {
    db.getLatestSuccess.mockResolvedValue({ finishedAt: new Date() });
    const outcome = await runDueJob(fakeDb, [job('a', vi.fn())]);
    expect(outcome).toEqual({ outcome: 'nothing-due' });
    expect(db.insertRunningRow).not.toHaveBeenCalled();
  });

  it('runs the only due job and records success', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'success', summary: 'did the thing' });
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(run).toHaveBeenCalledOnce();
    expect(db.insertRunningRow).toHaveBeenCalledWith(fakeDb, 'a');
    expect(db.finishRun).toHaveBeenCalledWith(fakeDb, 1, 'success', 'did the thing');
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'success', summary: 'did the thing' });
  });

  it('picks the most overdue job when multiple are due', async () => {
    db.getLatestSuccess.mockImplementation(async (_db: unknown, name: string) => {
      if (name === 'a') return { finishedAt: new Date('2026-08-01T00:00:00Z') };
      return { finishedAt: new Date('2026-07-01T00:00:00Z') };
    });
    const runA = vi.fn().mockResolvedValue({ status: 'success', summary: '' });
    const runB = vi.fn().mockResolvedValue({ status: 'success', summary: '' });
    await runDueJob(fakeDb, [job('a', runA), job('b', runB)]);
    expect(runB).toHaveBeenCalledOnce();
    expect(runA).not.toHaveBeenCalled();
  });

  it('skips a job with a recent running row instead of double-running it', async () => {
    db.getRecentRunning.mockResolvedValue({ startedAt: new Date() });
    const run = vi.fn();
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'skipped', job: 'a', reason: 'already-running' });
  });

  it('records a failure row and returns a failure outcome (not a throw) when the job throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(db.failRun).toHaveBeenCalledWith(fakeDb, 1, 'boom');
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
  });

  it('treats a partial result as a completed run, not a failure', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'partial', summary: 'skipped 2 diets' });
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(db.finishRun).toHaveBeenCalledWith(fakeDb, 1, 'partial', 'skipped 2 diets');
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'partial', summary: 'skipped 2 diets' });
  });
});

describe('runJobNow', () => {
  it('returns null for an unknown job name', async () => {
    expect(await runJobNow(fakeDb, [job('a', vi.fn())], 'nope')).toBeNull();
  });

  it('runs the named job even if it is not due', async () => {
    db.getLatestSuccess.mockResolvedValue({ finishedAt: new Date() }); // recently succeeded, still not due
    const run = vi.fn().mockResolvedValue({ status: 'success', summary: 'manual run' });
    const outcome = await runJobNow(fakeDb, [job('a', run)], 'a');
    expect(run).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'success', summary: 'manual run' });
  });

  it('still applies the overlap guard', async () => {
    db.getRecentRunning.mockResolvedValue({ startedAt: new Date() });
    const run = vi.fn();
    const outcome = await runJobNow(fakeDb, [job('a', run)], 'a');
    expect(run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'skipped', job: 'a', reason: 'already-running' });
  });
});
