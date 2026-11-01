import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getJobTuning, listJobTuning, upsertJobTuning } from '../src/jobTuning';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const tuningRow = {
  job_name: 'trends-watcher',
  cadence_days: 10,
  prose_overrides: { suggest: 'Custom suggest persona.' },
  updated_at: new Date('2026-10-30T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getJobTuning', () => {
  it('returns the mapped tuning row for a job that has one', async () => {
    const db = mockDb([tuningRow]);
    const result = await getJobTuning(db as never, 'trends-watcher');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM job_tuning WHERE job_name = $1'), [
      'trends-watcher',
    ]);
    expect(result).toEqual({
      jobName: 'trends-watcher',
      cadenceDays: 10,
      proseOverrides: { suggest: 'Custom suggest persona.' },
      updatedAt: tuningRow.updated_at,
    });
  });

  it('returns null when the job has no tuning row', async () => {
    const db = mockDb([]);
    const result = await getJobTuning(db as never, 'trends-watcher');
    expect(result).toBeNull();
  });
});

describe('listJobTuning', () => {
  it('lists every tuning row, mapped', async () => {
    const db = mockDb([tuningRow]);
    const result = await listJobTuning(db as never);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM job_tuning'));
    expect(result).toEqual([
      {
        jobName: 'trends-watcher',
        cadenceDays: 10,
        proseOverrides: { suggest: 'Custom suggest persona.' },
        updatedAt: tuningRow.updated_at,
      },
    ]);
  });

  it('returns an empty array when there are no tuning rows', async () => {
    const db = mockDb([]);
    const result = await listJobTuning(db as never);
    expect(result).toEqual([]);
  });
});

describe('upsertJobTuning', () => {
  it('inserts a new row with the given cadence and prose overrides', async () => {
    const db = mockDb([tuningRow]);
    const result = await upsertJobTuning(db as never, 'trends-watcher', {
      cadenceDays: 10,
      prose: { suggest: 'Custom suggest persona.' },
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (job_name) DO UPDATE'),
      ['trends-watcher', 10, JSON.stringify({ suggest: 'Custom suggest persona.' })],
    );
    expect(result).toEqual({
      jobName: 'trends-watcher',
      cadenceDays: 10,
      proseOverrides: { suggest: 'Custom suggest persona.' },
      updatedAt: tuningRow.updated_at,
    });
  });

  it('passes null for cadenceDays when omitted, relying on COALESCE to keep any existing value', async () => {
    const db = mockDb([{ ...tuningRow, cadence_days: null }]);
    await upsertJobTuning(db as never, 'trends-watcher', { prose: { suggest: 'x' } });
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['trends-watcher', null, JSON.stringify({ suggest: 'x' })]);
  });

  it('passes an empty jsonb object when prose is omitted, so the merge is a no-op', async () => {
    const db = mockDb([tuningRow]);
    await upsertJobTuning(db as never, 'trends-watcher', { cadenceDays: 14 });
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['trends-watcher', 14, JSON.stringify({})]);
  });

  it('merges prose_overrides via jsonb || rather than overwriting the whole column', async () => {
    const db = mockDb([tuningRow]);
    await upsertJobTuning(db as never, 'trends-watcher', { prose: { suggest: 'new text' } });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('prose_overrides || '), expect.any(Array));
  });
});
