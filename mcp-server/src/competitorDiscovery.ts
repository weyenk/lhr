import type { Pool } from 'pg';
import { fetchSearchResults } from './serpapiSearch.js';
import { insertCandidateCompetitor } from '@lhr/db';

// A small, curated, non-auto-expanding list of niche-discovery queries (spec §2 Phase A).
export const DISCOVERY_QUERIES: readonly string[] = [
  'gluten free recipe blog',
  'kitchenware affiliate roundup',
  'comfort food recipe blog',
  'best kitchen gadgets blog',
];

export interface DiscoveryResult {
  newCandidateDomains: string[];
  failedQueries: string[];
}

export async function runDiscovery(pool: Pool): Promise<DiscoveryResult> {
  const newCandidateDomains: string[] = [];
  const failedQueries: string[] = [];
  const seenThisRun = new Set<string>();

  for (const query of DISCOVERY_QUERIES) {
    let results;
    try {
      results = await fetchSearchResults(query);
    } catch (err) {
      console.error(`Discovery query "${query}" failed; skipping.`, err);
      failedQueries.push(query);
      continue;
    }

    for (const result of results) {
      if (seenThisRun.has(result.domain)) continue;
      seenThisRun.add(result.domain);

      const inserted = await insertCandidateCompetitor(pool, result.domain);
      if (inserted) {
        newCandidateDomains.push(result.domain);
      }
    }
  }

  return { newCandidateDomains, failedQueries };
}
