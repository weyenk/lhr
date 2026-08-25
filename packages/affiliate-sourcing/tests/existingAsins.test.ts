import { describe, expect, it, vi, beforeEach } from 'vitest';

const catalogMock = { readCollection: vi.fn() };
vi.mock('@lhr/github', async () => {
  const actual = await vi.importActual<typeof import('@lhr/github')>('@lhr/github');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { extractAsinFromUrl, getExcludedAsins } = await import('../src/existingAsins');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractAsinFromUrl', () => {
  it('extracts the ASIN from a /dp/ URL with a trailing slash', () => {
    expect(extractAsinFromUrl('https://www.amazon.com/dp/B0EXAMPLE1/')).toBe('B0EXAMPLE1');
  });

  it('extracts the ASIN from a /dp/ URL with a query string', () => {
    expect(extractAsinFromUrl('https://www.amazon.com/dp/B0EXAMPLE1?tag=lhr-20')).toBe('B0EXAMPLE1');
  });

  it('returns null for a shortened amzn.to URL', () => {
    expect(extractAsinFromUrl('https://amzn.to/3SQybP5')).toBeNull();
  });
});

describe('getExcludedAsins', () => {
  it('merges decided ASINs with ones parsed out of existing affiliate-links URLs', async () => {
    catalogMock.readCollection.mockResolvedValue([
      { id: 'bamboo-skewers-9c2e', data: { url: 'https://amzn.to/3SQybP5' } },
      { id: 'ceramic-mixing-bowls', data: { url: 'https://www.amazon.com/dp/B0EXAMPLE2/' } },
    ]);
    const result = await getExcludedAsins({} as never, new Set(['B0EXAMPLE1']));
    expect(result).toEqual(new Set(['B0EXAMPLE1', 'B0EXAMPLE2']));
  });
});
