import { requireEnv } from './blob.js';

const SERPAPI_URL = 'https://serpapi.com/search.json';

export interface SearchResultItem {
  position: number;
  title: string;
  link: string;
  domain: string;
}

interface SerpApiSearchResponse {
  organic_results?: { position: number; title: string; link: string }[];
}

function extractDomain(link: string): string {
  const hostname = new URL(link).hostname;
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

export async function fetchSearchResults(query: string, num = 10): Promise<SearchResultItem[]> {
  const apiKey = requireEnv('SERPAPI_KEY');

  const url = new URL(SERPAPI_URL);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(num));
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`SerpApi search request failed for query "${query}": ${response.status}`);
  }

  const data = (await response.json()) as SerpApiSearchResponse;
  return (data.organic_results ?? []).map((r) => ({
    position: r.position,
    title: r.title,
    link: r.link,
    domain: extractDomain(r.link),
  }));
}
