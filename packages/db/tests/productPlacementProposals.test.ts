import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertProductPlacementProposal,
  getPendingProposals,
  getReviewableProposals,
  getProposalById,
  markProposalStatus,
  getPendingAffiliateLinkIds,
  getApprovedProposals,
  type NewProductPlacementProposal,
} from '../src/productPlacementProposals';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const baseProposal: NewProductPlacementProposal = {
  cycleId: '2026-08-25',
  affiliateLinkId: 'bamboo-skewers-1234',
  postSlug: 'chicago-deep-dish-pizza',
  targetImageKind: 'body',
  targetImageUrl: 'https://example.com/original.jpg',
  targetImageLine: '![A photo](https://example.com/original.jpg)',
  matchRationale: 'Skewers pair well with this recipe\'s garnish step.',
  compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertProductPlacementProposal', () => {
  it('inserts a row and returns its id', async () => {
    const pool = mockPool([{ id: 42 }]);
    const id = await insertProductPlacementProposal(pool as never, baseProposal);
    expect(id).toBe(42);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO product_placement_proposals');
    expect(params).toEqual([
      '2026-08-25', 'bamboo-skewers-1234', 'chicago-deep-dish-pizza', 'body',
      'https://example.com/original.jpg', '![A photo](https://example.com/original.jpg)',
      'Skewers pair well with this recipe\'s garnish step.', 'https://example.com/composited.jpg', 'pending',
    ]);
  });
});

const dbRow = {
  id: 42, cycle_id: '2026-08-25', affiliate_link_id: 'bamboo-skewers-1234',
  post_slug: 'chicago-deep-dish-pizza', target_image_kind: 'body',
  target_image_url: 'https://example.com/original.jpg',
  target_image_line: '![A photo](https://example.com/original.jpg)',
  match_rationale: 'Skewers pair well with this recipe\'s garnish step.',
  composited_image_url: 'https://example.com/composited.jpg',
  status: 'pending', decided_at: null, created_at: new Date('2026-08-25T00:00:00Z'),
};

describe('getPendingProposals', () => {
  it('maps rows to camelCase and filters by status in the query', async () => {
    const pool = mockPool([dbRow]);
    const result = await getPendingProposals(pool as never);
    expect(result).toEqual([{
      id: 42, cycleId: '2026-08-25', affiliateLinkId: 'bamboo-skewers-1234',
      postSlug: 'chicago-deep-dish-pizza', targetImageKind: 'body',
      targetImageUrl: 'https://example.com/original.jpg',
      targetImageLine: '![A photo](https://example.com/original.jpg)',
      matchRationale: 'Skewers pair well with this recipe\'s garnish step.',
      compositedImageUrl: 'https://example.com/composited.jpg',
      status: 'pending', decidedAt: null, createdAt: new Date('2026-08-25T00:00:00Z'),
    }]);
    expect(pool.query.mock.calls[0][0]).toContain("status = 'pending'");
  });
});

describe('getReviewableProposals', () => {
  it('maps rows to camelCase and filters by pending or edit_failed status in the query', async () => {
    const editFailedRow = { ...dbRow, id: 43, status: 'edit_failed', composited_image_url: null };
    const pool = mockPool([dbRow, editFailedRow]);
    const result = await getReviewableProposals(pool as never);
    expect(result).toEqual([
      {
        id: 42, cycleId: '2026-08-25', affiliateLinkId: 'bamboo-skewers-1234',
        postSlug: 'chicago-deep-dish-pizza', targetImageKind: 'body',
        targetImageUrl: 'https://example.com/original.jpg',
        targetImageLine: '![A photo](https://example.com/original.jpg)',
        matchRationale: 'Skewers pair well with this recipe\'s garnish step.',
        compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'pending', decidedAt: null, createdAt: new Date('2026-08-25T00:00:00Z'),
      },
      {
        id: 43, cycleId: '2026-08-25', affiliateLinkId: 'bamboo-skewers-1234',
        postSlug: 'chicago-deep-dish-pizza', targetImageKind: 'body',
        targetImageUrl: 'https://example.com/original.jpg',
        targetImageLine: '![A photo](https://example.com/original.jpg)',
        matchRationale: 'Skewers pair well with this recipe\'s garnish step.',
        compositedImageUrl: null,
        status: 'edit_failed', decidedAt: null, createdAt: new Date('2026-08-25T00:00:00Z'),
      },
    ]);
    expect(pool.query.mock.calls[0][0]).toContain("status IN ('pending', 'edit_failed')");
  });
});

describe('getProposalById', () => {
  it('returns null when no row matches', async () => {
    const pool = mockPool([]);
    expect(await getProposalById(pool as never, 999)).toBeNull();
  });
});

describe('markProposalStatus', () => {
  it('sets status and decided_at', async () => {
    const pool = mockPool();
    await markProposalStatus(pool as never, 42, 'approved');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('SET status = $1, decided_at = now()');
    expect(params).toEqual(['approved', 42]);
  });
});

describe('getPendingAffiliateLinkIds', () => {
  it('returns a Set of affiliate_link_id for pending proposals', async () => {
    const pool = mockPool([{ affiliate_link_id: 'a' }, { affiliate_link_id: 'b' }]);
    const result = await getPendingAffiliateLinkIds(pool as never);
    expect(result).toEqual(new Set(['a', 'b']));
  });
});

describe('getApprovedProposals', () => {
  it('maps rows to camelCase and filters by approved status', async () => {
    const pool = mockPool([{ ...dbRow, status: 'approved', decided_at: new Date('2026-08-26T00:00:00Z') }]);
    const result = await getApprovedProposals(pool as never);
    expect(result[0].status).toBe('approved');
    expect(pool.query.mock.calls[0][0]).toContain("status = 'approved'");
  });
});
