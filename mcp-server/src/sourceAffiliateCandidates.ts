import { createGitHubClient } from './github.js';
import { requireEnv } from './blob.js';
// Mirrors packages/jobs/src/types.ts's JobResult contract, imported from a sibling module here
// rather than from @lhr/jobs for the same reason spelled out in generateWeeklyVariantRecipe.ts:
// @lhr/jobs depends on this package for its job entry points, so importing back would be circular.
import type { JobResult } from './generateWeeklyVariantRecipe.js';
import { getPool, insertCandidates, getDecidedAsins, getAllDecisionHistory, selectCycle, type NewCandidate } from '@lhr/db';
import { findTrendingCandidates } from './keepa.js';
import { lookupCommissionRate } from './amazonCommissionRates.js';
import { getExcludedAsins } from './existingAsins.js';
import { reconcileApprovedCandidates } from './reconcileApprovedCandidates.js';
import { computeCycleId } from './computeCycleId.js';

const CYCLE_SLOTS = 20;

// The Job-contract entry point registered in packages/jobs/src/registry.ts as
// { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates }. Candidates it
// writes are reviewed (approved or denied) by the author on apps/lhr-office's /status page — see
// affiliateCandidateOps.ts.
export async function sourceAffiliateCandidates(): Promise<JobResult> {
  const keepaApiKey = requireEnv('KEEPA_API_KEY');
  const githubToken = requireEnv('GITHUB_TOKEN');
  const associatesTag = requireEnv('AMAZON_ASSOCIATES_TAG');

  // The shared orchestrator pool (@lhr/db's getPool) reads DATABASE_URL itself and applies the
  // Supabase-pooler SSL handling client.ts documents. It is a process-wide singleton reused by
  // every job in an invocation, so this job must never end() it.
  const db = getPool();
  const client = createGitHubClient(githubToken);

  const reconciled = await reconcileApprovedCandidates(client, db, associatesTag);

  let trending;
  try {
    trending = await findTrendingCandidates(keepaApiKey);
  } catch (err) {
    return {
      status: 'failure',
      summary: `Keepa request failed; skipped this cycle rather than shipping a partial list: ${err instanceof Error ? err.message : String(err)}`,
      details: { reconciledAsins: reconciled.reconciledAsins },
    };
  }

  const decidedAsins = await getDecidedAsins(db);
  const excludedAsins = await getExcludedAsins(client, decidedAsins);
  const fresh = trending.filter((c) => !excludedAsins.has(c.asin));

  if (fresh.length === 0) {
    return {
      status: 'success',
      summary: 'No new candidates found after filtering; nothing to write this cycle.',
      details: { reconciledAsins: reconciled.reconciledAsins },
    };
  }

  const history = await getAllDecisionHistory(db);
  const scoringInput = fresh.map((c) => ({
    asin: c.asin,
    category: c.category,
    priceCents: c.priceCents,
    commissionRate: lookupCommissionRate(c.category).rate,
    estimatedMonthlySales: c.estimatedMonthlySales,
    rating: c.rating,
  }));
  const selected = selectCycle(scoringInput, history, CYCLE_SLOTS);

  const cycleId = computeCycleId(new Date());
  const byAsin = new Map(fresh.map((c) => [c.asin, c]));
  const newCandidates: NewCandidate[] = selected.map((s) => {
    const full = byAsin.get(s.asin)!;
    const { rate, isFallback } = lookupCommissionRate(full.category);
    return {
      cycleId,
      asin: full.asin,
      title: full.title,
      category: full.category,
      priceCents: full.priceCents,
      imageUrl: full.imageUrl,
      productUrl: full.productUrl,
      commissionRate: rate,
      commissionRateIsFallback: isFallback,
      estimatedMonthlySales: full.estimatedMonthlySales,
      bsr: full.bsr,
      bsrCategory: full.bsrCategory,
      rating: full.rating,
      reviewCount: full.reviewCount,
      score: s.score,
      isWildcard: s.isWildcard,
    };
  });

  await insertCandidates(db, newCandidates);

  const wildcardCount = newCandidates.filter((c) => c.isWildcard).length;
  const summary = `Wrote ${newCandidates.length} candidate(s) for cycle ${cycleId} (${wildcardCount} wildcard).`;
  const details = { cycleId, count: newCandidates.length, wildcardCount, reconciledAsins: reconciled.reconciledAsins };

  if (newCandidates.length === 0) {
    return { status: 'success', summary, details };
  }
  if (newCandidates.length < CYCLE_SLOTS) {
    return { status: 'partial', summary: `${summary} Target was ${CYCLE_SLOTS}; shipped what was found.`, details };
  }
  return { status: 'success', summary, details };
}
