import { describe, expect, it, vi } from 'vitest';
import {
  insertRunningRow,
  finishRun,
  failRun,
  getLatestSuccess,
  getRecentRunning,
  getRunHistory,
  reapOrphanedRunningRuns,
  ORCHESTRATOR_STALE_RUNNING_MS,
  ORPHANED_RUN_ERROR_MESSAGE,
} from '../src/orchestratorRuns';
import type { Queryable } from '../src/client';

function fakeDb(rows: Record<string, unknown>[]): Queryable & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('insertRunningRow', () => {
  it('inserts a running row and returns its id', async () => {
    const db = fakeDb([{ id: 42 }]);
    const id = await insertRunningRow(db, 'recipe-variant-generator');
    expect(id).toBe(42);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orchestrator_runs'),
      ['recipe-variant-generator'],
    );
  });
});

describe('finishRun', () => {
  it('updates the row with the final status and summary', async () => {
    const db = fakeDb([]);
    await finishRun(db, 42, 'success', 'did the thing');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orchestrator_runs'),
      [42, 'success', 'did the thing'],
    );
  });
});

describe('failRun', () => {
  it('updates the row with a failure status and error message', async () => {
    const db = fakeDb([]);
    await failRun(db, 42, 'boom');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orchestrator_runs'),
      [42, 'boom'],
    );
  });
});

const rawRow = {
  id: 1,
  job_name: 'recipe-variant-generator',
  status: 'success' as const,
  summary: 'generated 1 variant',
  error_message: null,
  started_at: new Date('2026-08-20T00:00:00Z'),
  finished_at: new Date('2026-08-20T00:05:00Z'),
};

const mappedRow = {
  id: 1,
  jobName: 'recipe-variant-generator',
  status: 'success' as const,
  summary: 'generated 1 variant',
  errorMessage: null,
  startedAt: new Date('2026-08-20T00:00:00Z'),
  finishedAt: new Date('2026-08-20T00:05:00Z'),
};

describe('getLatestSuccess', () => {
  it('maps the most recent successful row', async () => {
    const db = fakeDb([rawRow]);
    expect(await getLatestSuccess(db, 'recipe-variant-generator')).toEqual(mappedRow);
  });

  it('returns null when there is no successful row', async () => {
    const db = fakeDb([]);
    expect(await getLatestSuccess(db, 'recipe-variant-generator')).toBeNull();
  });

  it('queries for both success and partial statuses, since a partial run also counts as due-clearing', async () => {
    const db = fakeDb([rawRow]);
    await getLatestSuccess(db, 'recipe-variant-generator');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('success', 'partial')"),
      ['recipe-variant-generator'],
    );
  });
});

describe('getRecentRunning', () => {
  it('maps a recent running row', async () => {
    const runningRow = { ...rawRow, status: 'running' as const, finished_at: null };
    const db = fakeDb([runningRow]);
    const result = await getRecentRunning(db, 'recipe-variant-generator', 10 * 60 * 1000);
    expect(result?.status).toBe('running');
    expect(result?.finishedAt).toBeNull();
  });

  it('returns null when there is no recent running row', async () => {
    const db = fakeDb([]);
    expect(await getRecentRunning(db, 'recipe-variant-generator', 10 * 60 * 1000)).toBeNull();
  });
});

describe('getRunHistory', () => {
  it('maps every row in the history', async () => {
    const db = fakeDb([rawRow, rawRow]);
    const result = await getRunHistory(db, 'recipe-variant-generator', 5);
    expect(result).toEqual([mappedRow, mappedRow]);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['recipe-variant-generator', 5]);
  });
});

describe('reapOrphanedRunningRuns', () => {
  it('marks stale running rows as failure and returns how many were reaped', async () => {
    const db = fakeDb([{ id: 82 }, { id: 3 }]);
    const count = await reapOrphanedRunningRuns(db, ORCHESTRATOR_STALE_RUNNING_MS);
    expect(count).toBe(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE orchestrator_runs[\s\S]*status = 'failure'[\s\S]*status = 'running'/),
      [expect.any(Date), ORPHANED_RUN_ERROR_MESSAGE],
    );
    const cutoff = (db.query.mock.calls[0] as unknown[])[1] as [Date, string];
    expect(Date.now() - cutoff[0].getTime()).toBeGreaterThanOrEqual(ORCHESTRATOR_STALE_RUNNING_MS - 50);
    expect(cutoff[1]).toBe(ORPHANED_RUN_ERROR_MESSAGE);
  });

  it('returns 0 when nothing is stale', async () => {
    const db = fakeDb([]);
    expect(await reapOrphanedRunningRuns(db, ORCHESTRATOR_STALE_RUNNING_MS)).toBe(0);
  });
});
