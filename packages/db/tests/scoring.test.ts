import { describe, expect, it } from 'vitest';
import { selectCycle, computeBucketApproveRates, popularityScore, type DecisionRecord, type ScoringCandidate } from '../src/scoring';

function candidate(overrides: Partial<ScoringCandidate> & { asin: string }): ScoringCandidate {
  return {
    category: 'Kitchen',
    priceCents: 2000,
    commissionRate: 0.03,
    estimatedMonthlySales: 100,
    rating: 4.0,
    ...overrides,
  };
}

describe('computeBucketApproveRates', () => {
  it('computes approve rate per category/price-band/commission-band bucket', () => {
    const history: DecisionRecord[] = [
      { category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' },
      { category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' },
      { category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'denied' },
      { category: 'Grocery', priceCents: 2000, commissionRate: 0.01, decision: 'denied' },
    ];
    const rates = computeBucketApproveRates(history);
    expect(rates.get('Kitchen|15-40|mid')).toBeCloseTo(2 / 3);
    expect(rates.get('Grocery|15-40|low')).toBe(0);
  });
});

describe('selectCycle bucketed weighting', () => {
  it('ranks a candidate from a historically well-approved bucket above an identically popular one from a poorly-approved bucket', () => {
    const history: DecisionRecord[] = [
      ...Array(8).fill({ category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' }),
      ...Array(2).fill({ category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'denied' }),
      ...Array(1).fill({ category: 'Electronics', priceCents: 2000, commissionRate: 0.01, decision: 'approved' }),
      ...Array(9).fill({ category: 'Electronics', priceCents: 2000, commissionRate: 0.01, decision: 'denied' }),
    ];
    const candidates = [
      candidate({ asin: 'GOOD-BUCKET', category: 'Kitchen', commissionRate: 0.03 }),
      candidate({ asin: 'BAD-BUCKET', category: 'Electronics', commissionRate: 0.01 }),
    ];
    const [selected] = selectCycle(candidates, history, 1, 0);
    expect(selected.asin).toBe('GOOD-BUCKET');
  });
});

describe('selectCycle wildcard reservation', () => {
  it('selects wildcards as the highest-popularity members of the score-ranked remainder, not merely "whatever is left"', () => {
    const history: DecisionRecord[] = Array(20).fill({ category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' });
    const winners: ScoringCandidate[] = Array.from({ length: 8 }, (_, i) => candidate({ asin: `WINNER-${i}` }));
    // Insertion order deliberately does NOT match popularity order (HIGH > MID > LOW > LOWEST) —
    // a wildcard selection that used insertion/arbitrary order instead of sorting by popularity
    // would pick REM-LOW/REM-LOWEST here instead of the correct REM-HIGH/REM-MID.
    const remainder: ScoringCandidate[] = [
      candidate({ asin: 'REM-LOW', category: 'Grocery', commissionRate: 0.01, estimatedMonthlySales: 50, rating: 2.5 }),
      candidate({ asin: 'REM-LOWEST', category: 'Grocery', commissionRate: 0.01, estimatedMonthlySales: 5, rating: 1.0 }),
      candidate({ asin: 'REM-HIGH', category: 'Grocery', commissionRate: 0.01, estimatedMonthlySales: 1000, rating: 4.5 }),
      candidate({ asin: 'REM-MID', category: 'Grocery', commissionRate: 0.01, estimatedMonthlySales: 300, rating: 4.0 }),
    ];
    const selected = selectCycle([...winners, ...remainder], history, 10, 0.2);
    expect(selected).toHaveLength(10);
    const ranked = selected.filter((c) => !c.isWildcard).map((c) => c.asin).sort();
    expect(ranked).toEqual(winners.map((c) => c.asin).sort());
    const wildcards = selected.filter((c) => c.isWildcard).map((c) => c.asin);
    expect(wildcards).toHaveLength(2);
    expect(wildcards).toEqual(['REM-HIGH', 'REM-MID']);
  });
});

describe('selectCycle cold start', () => {
  it('converges to pure popularity ranking when decision_history is empty', () => {
    const candidates: ScoringCandidate[] = [
      candidate({ asin: 'LOW', estimatedMonthlySales: 10, rating: 3 }),
      candidate({ asin: 'HIGH', estimatedMonthlySales: 9000, rating: 4.8 }),
      candidate({ asin: 'MID', estimatedMonthlySales: 500, rating: 4.0 }),
    ];
    const selected = selectCycle(candidates, [], 3, 0.2);
    const byPopularity = [...candidates].sort((a, b) => popularityScore(b) - popularityScore(a)).map((c) => c.asin);
    expect(selected.map((c) => c.asin)).toEqual(byPopularity);
  });
});

describe('selectCycle with fewer candidates than slots', () => {
  it('ships every candidate found rather than padding', () => {
    const candidates: ScoringCandidate[] = [
      candidate({ asin: 'ONE' }),
      candidate({ asin: 'TWO' }),
    ];
    const selected = selectCycle(candidates, [], 20, 0.2);
    expect(selected).toHaveLength(2);
  });

  it('returns an empty array for an empty candidate pool', () => {
    expect(selectCycle([], [], 20, 0.2)).toEqual([]);
  });
});
