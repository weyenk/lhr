import { Pool } from 'pg';
import { createGitHubClient } from '@lhr/github';
import type { JobResult } from '@lhr/jobs';
import { insertCandidates, getDecidedAsins, getAllDecisionHistory, selectCycle, type NewCandidate } from '@lhr/db';
import { findTrendingCandidates } from './keepa.js';
import { lookupCommissionRate } from './amazonCommissionRates.js';
import { getExcludedAsins } from './existingAsins.js';
import { reconcileApprovedCandidates } from './reconcileApprovedCandidates.js';
import { computeCycleId } from './computeCycleId.js';

const CYCLE_SLOTS = 20;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

export async function sourceAffiliateCandidates(): Promise<JobResult> {
  const keepaApiKey = requireEnv('KEEPA_API_KEY');
  const githubToken = requireEnv('AUTHOR_GITHUB_TOKEN');
  const databaseUrl = requireEnv('DATABASE_URL');
  const associatesTag = requireEnv('AMAZON_ASSOCIATES_TAG');

  const pool = new Pool({ connectionString: databaseUrl });
  const client = createGitHubClient(githubToken);

  try {
    const reconciled = await reconcileApprovedCandidates(client, pool, associatesTag);

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

    const decidedAsins = await getDecidedAsins(pool);
    const excludedAsins = await getExcludedAsins(client, decidedAsins);
    const fresh = trending.filter((c) => !excludedAsins.has(c.asin));

    if (fresh.length === 0) {
      return {
        status: 'success',
        summary: 'No new candidates found after filtering; nothing to write this cycle.',
        details: { reconciledAsins: reconciled.reconciledAsins },
      };
    }

    const history = await getAllDecisionHistory(pool);
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

    await insertCandidates(pool, newCandidates);

    const wildcardCount = newCandidates.filter((c) => c.isWildcard).length;
    const summary = `Wrote ${newCandidates.length} candidate(s) for cycle ${cycleId} (${wildcardCount} wildcard).`;
    const details = { cycleId, count: newCandidates.length, wildcardCount, reconciledAsins: reconciled.reconciledAsins };

    if (newCandidates.length < CYCLE_SLOTS) {
      return { status: 'partial', summary: `${summary} Target was ${CYCLE_SLOTS}; shipped what was found.`, details };
    }
    return { status: 'success', summary, details };
  } finally {
    await pool.end();
  }
}
