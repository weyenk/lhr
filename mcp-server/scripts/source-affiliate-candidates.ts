import { Pool } from 'pg';
import { createGitHubClient } from '../src/github.js';
import { findTrendingCandidates } from '../src/keepa.js';
import { lookupCommissionRate } from '../src/amazonCommissionRates.js';
import { getExcludedAsins } from '../src/existingAsins.js';
import { reconcileApprovedCandidates } from '../src/reconcileApprovedCandidates.js';
import { computeCycleId } from '../src/computeCycleId.js';
import {
  insertCandidates,
  getDecidedAsins,
  getAllDecisionHistory,
  selectCycle,
  type NewCandidate,
} from '@lhr/db';

const CYCLE_SLOTS = 20;

async function main() {
  const keepaApiKey = process.env.KEEPA_API_KEY;
  const githubToken = process.env.AUTHOR_GITHUB_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;
  const associatesTag = process.env.AMAZON_ASSOCIATES_TAG;
  if (!keepaApiKey || !githubToken || !databaseUrl || !associatesTag) {
    console.error('KEEPA_API_KEY, AUTHOR_GITHUB_TOKEN, DATABASE_URL, and AMAZON_ASSOCIATES_TAG env vars are all required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = createGitHubClient(githubToken);

  const reconciled = await reconcileApprovedCandidates(client, pool, associatesTag);
  if (reconciled.reconciledAsins.length > 0) {
    console.log(`Reconciled ${reconciled.reconciledAsins.length} approved candidate(s) missing a file: ${reconciled.reconciledAsins.join(', ')}`);
  }

  let trending;
  try {
    trending = await findTrendingCandidates(keepaApiKey);
  } catch (err) {
    console.error('Keepa request failed; skipping this cycle rather than shipping a partial list.', err);
    await pool.end();
    process.exit(1);
  }

  const decidedAsins = await getDecidedAsins(pool);
  const excludedAsins = await getExcludedAsins(client, decidedAsins);
  const fresh = trending.filter((c) => !excludedAsins.has(c.asin));

  if (fresh.length === 0) {
    console.log('No new candidates found after filtering; nothing to write this cycle.');
    await pool.end();
    return;
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

  if (selected.length < CYCLE_SLOTS) {
    console.log(`Only ${selected.length} qualifying candidate(s) found this cycle (target ${CYCLE_SLOTS}); shipping what's found.`);
  }

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
  console.log(`Wrote ${newCandidates.length} candidate(s) for cycle ${cycleId} (${newCandidates.filter((c) => c.isWildcard).length} wildcard).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
