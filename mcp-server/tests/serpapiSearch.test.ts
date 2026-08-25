import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchSearchResults } from '../src/serpapiSearch';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SERPAPI_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('fetchSearchResults', () => {
  it('maps organic_results into SearchResultItem[] with a derived domain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [
          { position: 1, title: 'Sourdough 101', link: 'https://www.example-recipes.com/sourdough-101' },
          { position: 2, title: 'Kitchenware Roundup', link: 'https://gear.example.com/roundup' },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await fetchSearchResults('sourdough recipes');

    expect(result).toEqual([
      { position: 1, title: 'Sourdough 101', link: 'https://www.example-recipes.com/sourdough-101', domain: 'example-recipes.com' },
      { position: 2, title: 'Kitchenware Roundup', link: 'https://gear.example.com/roundup', domain: 'gear.example.com' },
    ]);
  });

  it('strips a leading www. from the derived domain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic_results: [{ position: 1, title: 'T', link: 'https://www.foo.com/x' }] }),
    }) as unknown as typeof fetch;

    const result = await fetchSearchResults('anything');
    expect(result[0].domain).toBe('foo.com');
  });

  it('sends the query, engine, and num as URL params', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return { ok: true, json: async () => ({ organic_results: [] }) };
    }) as unknown as typeof fetch;

    await fetchSearchResults('kitchenware affiliate roundup', 15);
    const params = new URL(capturedUrl).searchParams;
    expect(params.get('engine')).toBe('google');
    expect(params.get('q')).toBe('kitchenware affiliate roundup');
    expect(params.get('num')).toBe('15');
    expect(params.get('api_key')).toBe('test-key');
  });

  it('defaults num to 10', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return { ok: true, json: async () => ({ organic_results: [] }) };
    }) as unknown as typeof fetch;

    await fetchSearchResults('anything');
    expect(new URL(capturedUrl).searchParams.get('num')).toBe('10');
  });

  it('returns an empty array when organic_results is absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    expect(await fetchSearchResults('no results here')).toEqual([]);
  });

  it('throws when SERPAPI_KEY is not set', async () => {
    delete process.env.SERPAPI_KEY;
    await expect(fetchSearchResults('anything')).rejects.toThrow(/SERPAPI_KEY/);
  });

  it('throws with the query name when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(fetchSearchResults('rate limited query')).rejects.toThrow(/rate limited query/);
  });
});
