import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { findTrendingCandidates, parseKeepaProduct, CATEGORY_SEEDS } from '../src/keepa';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseKeepaProduct', () => {
  it('parses a Keepa product response into a KeepaCandidate', () => {
    const product = {
      asin: 'B0EXAMPLE1',
      title: 'Ceramic Mixing Bowl Set',
      categoryTree: [{ name: 'Kitchen' }],
      images: 'abc123.jpg,def456.jpg',
      monthlySold: 450,
      csv: [
        [], // AMAZON (index 0) — unused
        [123456, 2999], // NEW (index 1)
        [], // USED (index 2) — unused
        [123456, 1200], // SALES / BSR (index 3)
        [], [], [], [], [], [], [], [], [], [], [], [], // indices 4-15 unused
        [123456, 46], // RATING (index 16), stored ×10
        [123456, 812], // COUNT_REVIEWS (index 17)
      ],
    };
    const result = parseKeepaProduct(product);
    expect(result).toEqual({
      asin: 'B0EXAMPLE1',
      title: 'Ceramic Mixing Bowl Set',
      category: 'Kitchen',
      priceCents: 2999,
      imageUrl: 'https://m.media-amazon.com/images/I/abc123.jpg',
      productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
      bsr: 1200,
      bsrCategory: 'Kitchen',
      rating: 4.6,
      reviewCount: 812,
      estimatedMonthlySales: 450,
    });
  });

  it('falls back to null/Uncategorized fields when data is missing', () => {
    const product = { asin: 'B0EXAMPLE2', title: 'Mystery Item', csv: [] };
    const result = parseKeepaProduct(product);
    expect(result.category).toBe('Uncategorized');
    expect(result.priceCents).toBe(0);
    expect(result.bsr).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.estimatedMonthlySales).toBeNull();
    expect(result.imageUrl).toBe('');
    expect(result.bsrCategory).toBeNull();
  });
});

describe('findTrendingCandidates', () => {
  it('queries the product finder per seed, dedupes ASINs, then fetches product details once', async () => {
    const finderCalls: unknown[] = [];
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlString = url.toString();
      if (urlString.includes('/query')) {
        finderCalls.push(JSON.parse(init!.body as string));
        return { ok: true, json: async () => ({ asinList: ['B0EXAMPLE1', 'B0EXAMPLE2'] }) } as Response;
      }
      if (urlString.includes('/product')) {
        expect(urlString).toContain('asin=B0EXAMPLE1,B0EXAMPLE2');
        return {
          ok: true,
          json: async () => ({
            products: [
              { asin: 'B0EXAMPLE1', title: 'Item One', csv: [] },
              { asin: 'B0EXAMPLE2', title: 'Item Two', csv: [] },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected URL: ${urlString}`);
    }) as unknown as typeof fetch;

    const result = await findTrendingCandidates('test-key', [CATEGORY_SEEDS[0]]);
    expect(finderCalls).toHaveLength(1);
    expect((finderCalls[0] as { selection: { rootCategory: number } }).selection.rootCategory).toBe(CATEGORY_SEEDS[0].rootCategoryId);
    expect(result.map((c) => c.asin)).toEqual(['B0EXAMPLE1', 'B0EXAMPLE2']);
  });

  it('throws when the product finder request fails, so the caller can skip the cycle', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(findTrendingCandidates('test-key', [CATEGORY_SEEDS[0]])).rejects.toThrow('Keepa product finder request failed: 429');
  });
});
