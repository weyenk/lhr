import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertCandidates,
  getPendingCandidates,
  getLatestPendingCycleId,
  getCandidateById,
  markCandidateStatus,
  getApprovedCandidates,
  type NewCandidate,
} from '../src/candidates';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const baseCandidate: NewCandidate = {
  cycleId: '2026-W35',
  asin: 'B0EXAMPLE1',
  title: 'Ceramic Mixing Bowl Set',
  category: 'Kitchen',
  priceCents: 2999,
  imageUrl: 'https://example.com/bowl.jpg',
  productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03,
  commissionRateIsFallback: false,
  estimatedMonthlySales: 450,
  bsr: 1200,
  bsrCategory: 'Kitchen',
  rating: 4.6,
  reviewCount: 812,
  score: 0.71,
  isWildcard: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCandidates', () => {
  it('issues one insert query per candidate', async () => {
    const pool = mockPool();
    await insertCandidates(pool as never, [baseCandidate, { ...baseCandidate, asin: 'B0EXAMPLE2' }]);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO candidates');
    expect(pool.query.mock.calls[0][1]).toEqual([
      '2026-W35', 'B0EXAMPLE1', 'Ceramic Mixing Bowl Set', 'Kitchen', 2999,
      'https://example.com/bowl.jpg', 'https://www.amazon.com/dp/B0EXAMPLE1',
      0.03, false, 450, 1200, 'Kitchen', 4.6, 812, 0.71, false,
    ]);
  });
});

describe('getPendingCandidates', () => {
  it('queries by cycle_id and pending status, mapping snake_case rows to camelCase', async () => {
    const row = {
      id: 1, cycle_id: '2026-W35', asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set', category: 'Kitchen',
      price_cents: 2999, image_url: 'https://example.com/bowl.jpg', product_url: 'https://www.amazon.com/dp/B0EXAMPLE1',
      commission_rate: '0.03', commission_rate_is_fallback: false, estimated_monthly_sales: 450,
      bsr: 1200, bsr_category: 'Kitchen', rating: '4.6', review_count: 812, score: '0.71', is_wildcard: false,
      status: 'pending', decided_at: null, created_at: new Date('2026-08-24T00:00:00Z'),
    };
    const pool = mockPool([row]);
    const result = await getPendingCandidates(pool as never, '2026-W35');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"), ['2026-W35']);
    expect(result).toEqual([{
      id: 1, cycleId: '2026-W35', asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set', category: 'Kitchen',
      priceCents: 2999, imageUrl: 'https://example.com/bowl.jpg', productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
      commissionRate: 0.03, commissionRateIsFallback: false, estimatedMonthlySales: 450,
      bsr: 1200, bsrCategory: 'Kitchen', rating: 4.6, reviewCount: 812, score: 0.71, isWildcard: false,
      status: 'pending', decidedAt: null, createdAt: new Date('2026-08-24T00:00:00Z'),
    }]);
  });
});

describe('getLatestPendingCycleId', () => {
  it('returns the most recent cycle_id with pending candidates', async () => {
    const pool = mockPool([{ cycle_id: '2026-W35' }]);
    const result = await getLatestPendingCycleId(pool as never);
    expect(result).toBe('2026-W35');
  });

  it('returns null when there are no pending candidates', async () => {
    const pool = mockPool([]);
    const result = await getLatestPendingCycleId(pool as never);
    expect(result).toBeNull();
  });
});

describe('getCandidateById', () => {
  it('returns null when no row matches', async () => {
    const pool = mockPool([]);
    const result = await getCandidateById(pool as never, 999);
    expect(result).toBeNull();
  });
});

describe('markCandidateStatus', () => {
  it('updates status and decided_at', async () => {
    const pool = mockPool();
    await markCandidateStatus(pool as never, 1, 'approved');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE candidates SET status'), ['approved', 1]);
  });
});

describe('getApprovedCandidates', () => {
  it('queries for approved status only', async () => {
    const pool = mockPool([]);
    await getApprovedCandidates(pool as never);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'approved'"));
  });
});
