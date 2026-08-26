import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertDecisionHistory, getAllDecisionHistory, getDecidedAsins } from '../src/decisionHistory';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertDecisionHistory', () => {
  it('inserts a decision row with the given fields', async () => {
    const pool = mockPool();
    await insertDecisionHistory(pool as never, {
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999,
      commissionRate: 0.03, estimatedMonthlySales: 450, decision: 'approved',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO decision_history'),
      ['B0EXAMPLE1', 'Kitchen', 2999, 0.03, 450, 'approved'],
    );
  });
});

describe('getAllDecisionHistory', () => {
  it('maps snake_case rows to camelCase records', async () => {
    const pool = mockPool([{
      asin: 'B0EXAMPLE1', category: 'Kitchen', price_cents: 2999, commission_rate: '0.03',
      estimated_monthly_sales: 450, decision: 'approved', decided_at: new Date('2026-08-01T00:00:00Z'),
    }]);
    const result = await getAllDecisionHistory(pool as never);
    expect(result).toEqual([{
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999, commissionRate: 0.03,
      estimatedMonthlySales: 450, decision: 'approved', decidedAt: new Date('2026-08-01T00:00:00Z'),
    }]);
  });
});

describe('getDecidedAsins', () => {
  it('returns a set of distinct ASINs', async () => {
    const pool = mockPool([{ asin: 'B0EXAMPLE1' }, { asin: 'B0EXAMPLE2' }]);
    const result = await getDecidedAsins(pool as never);
    expect(result).toEqual(new Set(['B0EXAMPLE1', 'B0EXAMPLE2']));
  });
});
