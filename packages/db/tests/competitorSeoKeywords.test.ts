import { describe, expect, it, vi, beforeEach } from 'vitest';
import { addKeyword, removeKeyword, listKeywords } from '../src/competitorSeoKeywords';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const keywordRow = { id: 1, keyword: 'gluten free dinner recipes', added_at: new Date('2026-08-24T00:00:00Z') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addKeyword', () => {
  it('inserts a new keyword and returns it', async () => {
    const pool = mockPool([keywordRow]);
    const result = await addKeyword(pool as never, 'gluten free dinner recipes');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (keyword) DO UPDATE'),
      ['gluten free dinner recipes'],
    );
    expect(result).toEqual({ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at });
  });

  it('is idempotent — re-adding an existing keyword still returns a row, not an error', async () => {
    const pool = mockPool([keywordRow]);
    await expect(addKeyword(pool as never, 'gluten free dinner recipes')).resolves.toBeDefined();
  });
});

describe('removeKeyword', () => {
  it('deletes the keyword row', async () => {
    const pool = mockPool();
    await removeKeyword(pool as never, 1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM competitor_seo_keywords'), [1]);
  });
});

describe('listKeywords', () => {
  it('lists keywords ordered alphabetically', async () => {
    const pool = mockPool([keywordRow]);
    const result = await listKeywords(pool as never);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY keyword ASC'));
    expect(result).toEqual([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at }]);
  });
});
