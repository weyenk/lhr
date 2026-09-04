import { readCollection } from './catalog.js';
import type { GitHubClient } from './github.js';

const ASIN_URL_PATTERN = /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/;

export function extractAsinFromUrl(url: string): string | null {
  const match = url.match(ASIN_URL_PATTERN);
  return match ? match[1] : null;
}

export async function getExcludedAsins(client: GitHubClient, decidedAsins: Set<string>): Promise<Set<string>> {
  const excluded = new Set(decidedAsins);
  const affiliateLinks = await readCollection<{ url: string }>(client, 'src/content/affiliate-links');
  for (const entry of affiliateLinks) {
    const asin = extractAsinFromUrl(entry.data.url);
    if (asin) excluded.add(asin);
  }
  return excluded;
}
