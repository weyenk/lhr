import { requireEnv } from './blob.js';

const SERPAPI_URL = 'https://serpapi.com/search.json';

// Confirmed from SerpApi's published Google Trends Trending Now category list.
const CATEGORY_ID_MAP: Record<string, string> = {
  'web-design': '18', // Technology
  cooking: '5', // Food and Drink
  nutrition: '7', // Health
};

export interface RelatedQuery {
  query: string;
  value: string;
}

export interface InterestAndRelatedQueries {
  direction: 'rising' | 'falling' | 'flat';
  topQueries: RelatedQuery[];
  risingQueries: RelatedQuery[];
}

export interface TrendingNowItem {
  query: string;
  searchVolume: number | null;
  increasePercentage: number | null;
}

interface TimelinePoint {
  values?: { extracted_value?: number }[];
}

interface GoogleTrendsInterestResponse {
  interest_over_time?: { timeline_data?: TimelinePoint[] };
}

interface RelatedQueryItem {
  query?: string;
  value?: string;
}

interface GoogleTrendsRelatedResponse {
  related_queries?: { top?: RelatedQueryItem[]; rising?: RelatedQueryItem[] };
}

interface TrendingNowResponse {
  trending_searches?: { query?: string; search_volume?: number; increase_percentage?: number }[];
}

const DIRECTION_THRESHOLD = 5;

function computeDirection(points: TimelinePoint[]): 'rising' | 'falling' | 'flat' {
  const values = points
    .map((p) => p.values?.[0]?.extracted_value)
    .filter((v): v is number => typeof v === 'number');
  if (values.length < 2) return 'flat';
  const delta = values[values.length - 1] - values[0];
  if (delta > DIRECTION_THRESHOLD) return 'rising';
  if (delta < -DIRECTION_THRESHOLD) return 'falling';
  return 'flat';
}

function toRelated(items: RelatedQueryItem[] | undefined): RelatedQuery[] {
  return (items ?? [])
    .filter((item): item is Required<RelatedQueryItem> => typeof item.query === 'string' && typeof item.value === 'string')
    .map((item) => ({ query: item.query, value: item.value }));
}

export async function fetchInterestAndRelatedQueries(
  topic: string,
  geo = 'US',
): Promise<InterestAndRelatedQueries> {
  const apiKey = requireEnv('SERPAPI_KEY');

  const interestUrl = new URL(SERPAPI_URL);
  interestUrl.searchParams.set('engine', 'google_trends');
  interestUrl.searchParams.set('q', topic);
  interestUrl.searchParams.set('geo', geo);
  interestUrl.searchParams.set('data_type', 'TIMESERIES');
  interestUrl.searchParams.set('api_key', apiKey);

  const interestRes = await fetch(interestUrl);
  if (!interestRes.ok) {
    throw new Error(`SerpApi google_trends TIMESERIES request failed for "${topic}": ${interestRes.status}`);
  }
  const interestData = (await interestRes.json()) as GoogleTrendsInterestResponse;

  const relatedUrl = new URL(SERPAPI_URL);
  relatedUrl.searchParams.set('engine', 'google_trends');
  relatedUrl.searchParams.set('q', topic);
  relatedUrl.searchParams.set('geo', geo);
  relatedUrl.searchParams.set('data_type', 'RELATED_QUERIES');
  relatedUrl.searchParams.set('api_key', apiKey);

  const relatedRes = await fetch(relatedUrl);
  if (!relatedRes.ok) {
    throw new Error(`SerpApi google_trends RELATED_QUERIES request failed for "${topic}": ${relatedRes.status}`);
  }
  const relatedData = (await relatedRes.json()) as GoogleTrendsRelatedResponse;

  const timelineData = interestData.interest_over_time?.timeline_data ?? [];

  return {
    direction: computeDirection(timelineData),
    topQueries: toRelated(relatedData.related_queries?.top),
    risingQueries: toRelated(relatedData.related_queries?.rising),
  };
}

export async function fetchTrendingNow(category: string): Promise<TrendingNowItem[]> {
  const apiKey = requireEnv('SERPAPI_KEY');

  const url = new URL(SERPAPI_URL);
  url.searchParams.set('engine', 'google_trends_trending_now');
  url.searchParams.set('geo', 'US');
  const categoryId = CATEGORY_ID_MAP[category];
  if (categoryId) url.searchParams.set('category_id', categoryId);
  url.searchParams.set('api_key', apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpApi google_trends_trending_now request failed for category "${category}": ${res.status}`);
  }
  const data = (await res.json()) as TrendingNowResponse;

  return (data.trending_searches ?? [])
    .filter((item): item is { query: string; search_volume?: number; increase_percentage?: number } => typeof item.query === 'string')
    .map((item) => ({
      query: item.query,
      searchVolume: item.search_volume ?? null,
      increasePercentage: item.increase_percentage ?? null,
    }));
}
