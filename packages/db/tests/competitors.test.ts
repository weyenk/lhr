import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertCandidateCompetitor,
  listCompetitorsByStatus,
  setCompetitorStatus,
} from '../src/competitors';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const competitorRow = {
  id: 1,
  domain: 'example-recipes.com',
  name: null,
  status: 'candidate',
  discovered_at: new Date('2026-09-06T00:00:00Z'),
  approved_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCandidateCompetitor', () => {
  it('inserts a new domain as a candidate and returns it', async () => {
    const db = mockDb([competitorRow]);
    const result = await insertCandidateCompetitor(db as never, 'example-recipes.com');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (domain) DO NOTHING'),
      ['example-recipes.com', null],
    );
    expect(result).toEqual({
      id: 1,
      domain: 'example-recipes.com',
      name: null,
      status: 'candidate',
      discoveredAt: competitorRow.discovered_at,
      approvedAt: null,
    });
  });

  it('passes through an optional name', async () => {
    const db = mockDb([{ ...competitorRow, name: 'Example Recipes' }]);
    await insertCandidateCompetitor(db as never, 'example-recipes.com', 'Example Recipes');
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['example-recipes.com', 'Example Recipes']);
  });

  it('returns null when the domain already exists (safe no-op)', async () => {
    const db = mockDb([]);
    expect(await insertCandidateCompetitor(db as never, 'already-tracked.com')).toBeNull();
  });
});

describe('listCompetitorsByStatus', () => {
  it('queries by status, ordered by domain', async () => {
    const db = mockDb([{ ...competitorRow, status: 'tracked' }]);
    const result = await listCompetitorsByStatus(db as never, 'tracked');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY domain ASC'), ['tracked']);
    expect(result[0].status).toBe('tracked');
  });
});

describe('setCompetitorStatus', () => {
  it('sets approved_at when approving to tracked', async () => {
    const db = mockDb();
    await setCompetitorStatus(db as never, 1, 'tracked');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'tracked'"), [1]);
    expect(db.query.mock.calls[0][0]).toContain('approved_at = now()');
  });

  it('does not touch approved_at when rejecting', async () => {
    const db = mockDb();
    await setCompetitorStatus(db as never, 1, 'rejected');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'rejected'"), [1]);
    expect(db.query.mock.calls[0][0]).not.toContain('approved_at');
  });
});
