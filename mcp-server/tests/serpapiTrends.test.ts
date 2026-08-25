import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchInterestAndRelatedQueries, fetchTrendingNow } from '../src/serpapiTrends';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SERPAPI_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('fetchInterestAndRelatedQueries', () => {
  it('fetches TIMESERIES and RELATED_QUERIES and combines them', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return {
          ok: true,
          json: async () => ({
            interest_over_time: {
              timeline_data: [
                { values: [{ extracted_value: 20 }] },
                { values: [{ extracted_value: 60 }] },
              ],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          related_queries: {
            top: [{ query: 'air fryer chicken', value: '100' }],
            rising: [{ query: 'air fryer salmon', value: 'Breakout' }],
          },
        }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('air fryer recipes');

    expect(result.direction).toBe('rising');
    expect(result.topQueries).toEqual([{ query: 'air fryer chicken', value: '100' }]);
    expect(result.risingQueries).toEqual([{ query: 'air fryer salmon', value: 'Breakout' }]);
  });

  it('reports falling direction when the trend declines', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return { ok: true, json: async () => ({ interest_over_time: { timeline_data: [{ values: [{ extracted_value: 60 }] }, { values: [{ extracted_value: 10 }] }] } }) };
      }
      return { ok: true, json: async () => ({ related_queries: {} }) };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('declining topic');
    expect(result.direction).toBe('falling');
  });

  it('throws when SERPAPI_KEY is not set', async () => {
    delete process.env.SERPAPI_KEY;
    await expect(fetchInterestAndRelatedQueries('anything')).rejects.toThrow(/SERPAPI_KEY/);
  });

  it('throws with the topic name when the TIMESERIES request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(fetchInterestAndRelatedQueries('rate limited topic')).rejects.toThrow(/rate limited topic/);
  });

  it('coerces a numeric related-query value to a string instead of dropping it', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return { ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) };
      }
      return {
        ok: true,
        json: async () => ({
          related_queries: {
            top: [{ query: 'numeric value topic', value: 87 }],
            rising: [],
          },
        }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('numeric value topic');
    expect(result.topQueries).toEqual([{ query: 'numeric value topic', value: '87' }]);
  });

  it('warns when related-query items exist but none have a usable query+value pair', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return { ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) };
      }
      return {
        ok: true,
        json: async () => ({
          related_queries: {
            top: [{ value: 'no query field' }],
            rising: [],
          },
        }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('malformed shape topic');
    expect(result.topQueries).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('fetchTrendingNow', () => {
  it('maps trending_searches into TrendingNowItem[]', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        trending_searches: [
          { query: 'meal prep containers', search_volume: 5000, increase_percentage: 120 },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await fetchTrendingNow('cooking');
    expect(result).toEqual([{ query: 'meal prep containers', searchVolume: 5000, increasePercentage: 120 }]);
  });

  it('uses the documented category_id for each known category', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return { ok: true, json: async () => ({ trending_searches: [] }) };
    }) as unknown as typeof fetch;

    await fetchTrendingNow('web-design');
    expect(new URL(capturedUrl).searchParams.get('category_id')).toBe('18');

    await fetchTrendingNow('cooking');
    expect(new URL(capturedUrl).searchParams.get('category_id')).toBe('5');

    await fetchTrendingNow('nutrition');
    expect(new URL(capturedUrl).searchParams.get('category_id')).toBe('7');
  });

  it('throws with the category name when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(fetchTrendingNow('cooking')).rejects.toThrow(/cooking/);
  });
});
