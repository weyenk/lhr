import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertCandidateCompetitor,
  getCompetitorByDomain,
  getCompetitorById,
  listCompetitorsByStatus,
  setCompetitorStatus,
} from '../src/competitors';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const competitorRow = {
  id: 1,
  domain: 'example-recipes.com',
  name: null,
  status: 'candidate',
  discovered_at: new Date('2026-08-24T00:00:00Z'),
  approved_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCandidateCompetitor', () => {
  it('inserts a new domain as a candidate and returns it', async () => {
    const pool = mockPool([competitorRow]);
    const result = await insertCandidateCompetitor(pool as never, 'example-recipes.com');
    expect(pool.query).toHaveBeenCalledWith(
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
    const pool = mockPool([{ ...competitorRow, name: 'Example Recipes' }]);
    await insertCandidateCompetitor(pool as never, 'example-recipes.com', 'Example Recipes');
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['example-recipes.com', 'Example Recipes']);
  });

  it('returns null when the domain already exists (safe no-op)', async () => {
    const pool = mockPool([]);
    const result = await insertCandidateCompetitor(pool as never, 'already-tracked.com');
    expect(result).toBeNull();
  });
});

describe('getCompetitorByDomain', () => {
  it('returns null when no competitor matches', async () => {
    const pool = mockPool([]);
    expect(await getCompetitorByDomain(pool as never, 'nobody.com')).toBeNull();
  });

  it('maps a found row to camelCase', async () => {
    const pool = mockPool([competitorRow]);
    const result = await getCompetitorByDomain(pool as never, 'example-recipes.com');
    expect(result?.discoveredAt).toEqual(competitorRow.discovered_at);
  });
});

describe('getCompetitorById', () => {
  it('maps a found row to camelCase', async () => {
    const pool = mockPool([competitorRow]);
    const result = await getCompetitorById(pool as never, 1);
    expect(result?.domain).toBe('example-recipes.com');
  });
});

describe('listCompetitorsByStatus', () => {
  it('queries by status, ordered by domain', async () => {
    const pool = mockPool([{ ...competitorRow, status: 'tracked' }]);
    const result = await listCompetitorsByStatus(pool as never, 'tracked');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY domain ASC'), ['tracked']);
    expect(result[0].status).toBe('tracked');
  });
});

describe('setCompetitorStatus', () => {
  it('sets approved_at when approving to tracked', async () => {
    const pool = mockPool();
    await setCompetitorStatus(pool as never, 1, 'tracked');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'tracked'"), [1]);
    expect(pool.query.mock.calls[0][0]).toContain('approved_at = now()');
  });

  it('does not touch approved_at when rejecting', async () => {
    const pool = mockPool();
    await setCompetitorStatus(pool as never, 1, 'rejected');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'rejected'"), [1]);
    expect(pool.query.mock.calls[0][0]).not.toContain('approved_at');
  });
});
