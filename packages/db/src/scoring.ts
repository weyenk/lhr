export interface DecisionRecord {
  category: string;
  priceCents: number;
  commissionRate: number;
  decision: 'approved' | 'denied';
}

export interface ScoringCandidate {
  asin: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  estimatedMonthlySales: number | null;
  rating: number | null;
}

export interface ScoredCandidate extends ScoringCandidate {
  score: number;
  isWildcard: boolean;
}

export function priceBand(priceCents: number): 'under-15' | '15-40' | '40-plus' {
  if (priceCents < 1500) return 'under-15';
  if (priceCents <= 4000) return '15-40';
  return '40-plus';
}

export function commissionBand(rate: number): 'low' | 'mid' | 'high' {
  if (rate < 0.02) return 'low';
  if (rate < 0.04) return 'mid';
  return 'high';
}

function bucketKey(category: string, priceCents: number, commissionRate: number): string {
  return `${category}|${priceBand(priceCents)}|${commissionBand(commissionRate)}`;
}

export function computeBucketApproveRates(history: DecisionRecord[]): Map<string, number> {
  const counts = new Map<string, { approved: number; total: number }>();
  for (const record of history) {
    const key = bucketKey(record.category, record.priceCents, record.commissionRate);
    const entry = counts.get(key) ?? { approved: 0, total: 0 };
    entry.total += 1;
    if (record.decision === 'approved') entry.approved += 1;
    counts.set(key, entry);
  }
  const rates = new Map<string, number>();
  for (const [key, { approved, total }] of counts) rates.set(key, approved / total);
  return rates;
}

const MAX_MONTHLY_SALES_FOR_SCORING = 10_000;
const NEUTRAL_RATING = 3.5;
const NEUTRAL_APPROVE_RATE = 0.5;
const APPROVE_RATE_WEIGHT = 0.6;
const POPULARITY_WEIGHT = 0.4;
const SALES_WEIGHT_WITHIN_POPULARITY = 0.7;
const RATING_WEIGHT_WITHIN_POPULARITY = 0.3;

export function popularityScore(candidate: Pick<ScoringCandidate, 'estimatedMonthlySales' | 'rating'>): number {
  const sales = candidate.estimatedMonthlySales ?? 0;
  const normalizedSales = Math.min(Math.log10(sales + 1) / Math.log10(MAX_MONTHLY_SALES_FOR_SCORING + 1), 1);
  const normalizedRating = (candidate.rating ?? NEUTRAL_RATING) / 5;
  return SALES_WEIGHT_WITHIN_POPULARITY * normalizedSales + RATING_WEIGHT_WITHIN_POPULARITY * normalizedRating;
}

export function scoreCandidate(candidate: ScoringCandidate, bucketRates: Map<string, number>): number {
  const key = bucketKey(candidate.category, candidate.priceCents, candidate.commissionRate);
  const approveRate = bucketRates.get(key) ?? NEUTRAL_APPROVE_RATE;
  return APPROVE_RATE_WEIGHT * approveRate + POPULARITY_WEIGHT * popularityScore(candidate);
}

export function selectCycle(
  candidates: ScoringCandidate[],
  history: DecisionRecord[],
  slots = 20,
  wildcardFraction = 0.2,
): ScoredCandidate[] {
  if (candidates.length === 0) return [];

  const bucketRates = computeBucketApproveRates(history);
  const scored = candidates.map((c) => ({ ...c, score: scoreCandidate(c, bucketRates) }));

  const take = Math.min(slots, scored.length);
  const wildcardCount = Math.round(take * wildcardFraction);
  const rankedCount = take - wildcardCount;

  const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
  const ranked: ScoredCandidate[] = byScoreDesc.slice(0, rankedCount).map((c) => ({ ...c, isWildcard: false }));
  const rankedAsins = new Set(ranked.map((c) => c.asin));

  const byPopularityDesc = [...scored]
    .filter((c) => !rankedAsins.has(c.asin))
    .sort((a, b) => popularityScore(b) - popularityScore(a));
  const wildcards: ScoredCandidate[] = byPopularityDesc.slice(0, wildcardCount).map((c) => ({ ...c, isWildcard: true }));

  return [...ranked, ...wildcards];
}
