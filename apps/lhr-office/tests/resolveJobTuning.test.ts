import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Queryable } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';

const dbMock = {
  getJobTuning: vi.fn(),
  listJobTuning: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

vi.mock('../src/jobProseCatalog.js', () => ({
  JOB_PROSE_CATALOG: {
    'trends-watcher': [
      { id: 'suggest', title: 'Suggest persona', source: 'inline', editable: true, defaultText: 'default suggest text' },
      { id: 'strategist', title: 'strategist persona', source: 'repo', editable: false, defaultText: '(repo)' },
    ],
  },
}));

const { effectiveCadence, resolveProse, resolveProseCatalog } = await import('../src/resolveJobTuning');

const fakeDb = {} as Queryable;

function job(name: string, cadenceDays: number): JobRegistration {
  return { name, cadenceDays, run: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('effectiveCadence', () => {
  it('uses the registry default when there is no DB override', async () => {
    dbMock.listJobTuning.mockResolvedValue([]);
    const result = await effectiveCadence(fakeDb, [job('a', 7), job('b', 1)]);
    expect(result.get('a')).toBe(7);
    expect(result.get('b')).toBe(1);
  });

  it('uses the DB override cadence when one exists for the job', async () => {
    dbMock.listJobTuning.mockResolvedValue([
      { jobName: 'a', cadenceDays: 14, proseOverrides: {}, updatedAt: new Date() },
    ]);
    const result = await effectiveCadence(fakeDb, [job('a', 7), job('b', 1)]);
    expect(result.get('a')).toBe(14);
    expect(result.get('b')).toBe(1);
  });

  it('falls back to the registry default when the DB row has a null cadence', async () => {
    dbMock.listJobTuning.mockResolvedValue([
      { jobName: 'a', cadenceDays: null, proseOverrides: {}, updatedAt: new Date() },
    ]);
    const result = await effectiveCadence(fakeDb, [job('a', 7)]);
    expect(result.get('a')).toBe(7);
  });
});

describe('resolveProse', () => {
  it('returns the fallback when there is no tuning row for the job', async () => {
    dbMock.getJobTuning.mockResolvedValue(null);
    const result = await resolveProse(fakeDb, 'trends-watcher', 'suggest', 'fallback text');
    expect(result).toBe('fallback text');
  });

  it('returns the fallback when the tuning row exists but has no override for this key', async () => {
    dbMock.getJobTuning.mockResolvedValue({ jobName: 'trends-watcher', cadenceDays: null, proseOverrides: {}, updatedAt: new Date() });
    const result = await resolveProse(fakeDb, 'trends-watcher', 'suggest', 'fallback text');
    expect(result).toBe('fallback text');
  });

  it('returns the override text when present', async () => {
    dbMock.getJobTuning.mockResolvedValue({
      jobName: 'trends-watcher',
      cadenceDays: null,
      proseOverrides: { suggest: 'overridden text' },
      updatedAt: new Date(),
    });
    const result = await resolveProse(fakeDb, 'trends-watcher', 'suggest', 'fallback text');
    expect(result).toBe('overridden text');
  });
});

describe('resolveProseCatalog', () => {
  it('returns an empty array for a job with no catalog entries', async () => {
    const result = await resolveProseCatalog(fakeDb, 'unknown-job');
    expect(result).toEqual([]);
    expect(dbMock.getJobTuning).not.toHaveBeenCalled();
  });

  it('merges catalog defaults with DB overrides for editable entries, leaving read-only entries untouched', async () => {
    dbMock.getJobTuning.mockResolvedValue({
      jobName: 'trends-watcher',
      cadenceDays: null,
      proseOverrides: { suggest: 'overridden suggest text', strategist: 'should be ignored' },
      updatedAt: new Date(),
    });

    const result = await resolveProseCatalog(fakeDb, 'trends-watcher');

    expect(result).toEqual([
      { id: 'suggest', title: 'Suggest persona', source: 'inline', editable: true, text: 'overridden suggest text', note: undefined },
      { id: 'strategist', title: 'strategist persona', source: 'repo', editable: false, text: '(repo)', note: undefined },
    ]);
  });

  it('falls back to catalog defaults when there is no tuning row', async () => {
    dbMock.getJobTuning.mockResolvedValue(null);

    const result = await resolveProseCatalog(fakeDb, 'trends-watcher');

    expect(result).toEqual([
      { id: 'suggest', title: 'Suggest persona', source: 'inline', editable: true, text: 'default suggest text', note: undefined },
      { id: 'strategist', title: 'strategist persona', source: 'repo', editable: false, text: '(repo)', note: undefined },
    ]);
  });
});
