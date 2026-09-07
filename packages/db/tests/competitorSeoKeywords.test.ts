import { describe, expect, it, vi, beforeEach } from 'vitest';
import { addKeyword, removeKeyword, listKeywords } from '../src/competitorSeoKeywords';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const keywordRow = { id: 1, keyword: 'gluten free dinner recipes', added_at: new Date('2026-09-06T00:00:00Z') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addKeyword', () => {
  it('inserts a new keyword and returns it', async () => {
    const db = mockDb([keywordRow]);
    const result = await addKeyword(db as never, 'gluten free dinner recipes');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (keyword) DO UPDATE'),
      ['gluten free dinner recipes'],
    );
    expect(result).toEqual({ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at });
  });

  it('is idempotent — re-adding an existing keyword still returns a row, not an error', async () => {
    const db = mockDb([keywordRow]);
    await expect(addKeyword(db as never, 'gluten free dinner recipes')).resolves.toBeDefined();
  });
});

describe('removeKeyword', () => {
  it('deletes the keyword row', async () => {
    const db = mockDb();
    await removeKeyword(db as never, 1);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM competitor_seo_keywords'), [1]);
  });
});

describe('listKeywords', () => {
  it('lists keywords ordered alphabetically', async () => {
    const db = mockDb([keywordRow]);
    const result = await listKeywords(db as never);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY keyword ASC'));
    expect(result).toEqual([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at }]);
  });
});
