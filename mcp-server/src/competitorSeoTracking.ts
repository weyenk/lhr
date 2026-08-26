import type { Pool } from 'pg';
import { fetchSearchResults } from './serpapiSearch.js';
import { listCompetitorsByStatus, listKeywords, type SeoPositionEntry } from '@lhr/db';

export interface SeoTrackingResult {
  positionsByCompetitorId: Map<number, SeoPositionEntry[]>;
  failedKeywords: string[];
}

export async function trackSeoPositions(pool: Pool): Promise<SeoTrackingResult> {
  const tracked = await listCompetitorsByStatus(pool, 'tracked');
  const keywords = await listKeywords(pool);

  const positionsByCompetitorId = new Map<number, SeoPositionEntry[]>();
  for (const competitor of tracked) {
    positionsByCompetitorId.set(competitor.id, []);
  }

  const failedKeywords: string[] = [];

  for (const { keyword } of keywords) {
    let results;
    try {
      results = await fetchSearchResults(keyword);
    } catch (err) {
      console.error(`SEO keyword "${keyword}" SerpApi call failed; skipping.`, err);
      failedKeywords.push(keyword);
      continue;
    }

    for (const competitor of tracked) {
      const match = results.find((r) => r.domain === competitor.domain);
      const entry: SeoPositionEntry = { keyword, position: match ? match.position : null };
      positionsByCompetitorId.get(competitor.id)!.push(entry);
    }
  }

  return { positionsByCompetitorId, failedKeywords };
}
