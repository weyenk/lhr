import { describe, expect, it, vi, beforeEach } from 'vitest';
import { addDiscoveryQuery, removeDiscoveryQuery, listDiscoveryQueries } from '../src/competitorDiscoveryQueries';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const queryRow = { id: 1, query: 'gluten free recipe blog', added_at: new Date('2026-09-06T00:00:00Z') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addDiscoveryQuery', () => {
  it('inserts a new discovery query and returns it', async () => {
    const db = mockDb([queryRow]);
    const result = await addDiscoveryQuery(db as never, 'gluten free recipe blog');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (query) DO UPDATE'),
      ['gluten free recipe blog'],
    );
    expect(result).toEqual({ id: 1, query: 'gluten free recipe blog', addedAt: queryRow.added_at });
  });

  it('rejects an empty query', async () => {
    const db = mockDb();
    await expect(addDiscoveryQuery(db as never, '   ')).rejects.toThrow(/empty/i);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('removeDiscoveryQuery', () => {
  it('deletes the discovery query row', async () => {
    const db = mockDb();
    await removeDiscoveryQuery(db as never, 1);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM competitor_discovery_queries'), [1]);
  });
});

describe('listDiscoveryQueries', () => {
  it('lists queries ordered alphabetically', async () => {
    const db = mockDb([queryRow]);
    const result = await listDiscoveryQueries(db as never);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY query ASC'));
    expect(result).toEqual([{ id: 1, query: 'gluten free recipe blog', addedAt: queryRow.added_at }]);
  });
});
