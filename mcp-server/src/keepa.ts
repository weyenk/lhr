export interface CategorySeed {
  category: string;
  rootCategoryId: number;
  keywords: string[];
}

// Best-known Amazon US category node IDs — verify via GET https://api.keepa.com/category
// before a real sourcing cycle (see this task's verification note in the plan).
export const CATEGORY_SEEDS: CategorySeed[] = [
  { category: 'Kitchen', rootCategoryId: 284507, keywords: ['kitchen tools', 'cookware', 'bakeware'] },
  { category: 'Grocery', rootCategoryId: 16310211, keywords: ['pantry staples', 'spices', 'condiments'] },
];

export interface KeepaCandidate {
  asin: string;
  title: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  productUrl: string;
  bsr: number | null;
  bsrCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  estimatedMonthlySales: number | null;
}

const KEEPA_DOMAIN_US = 1;
const KEEPA_BASE_URL = 'https://api.keepa.com';

async function findAsinsForSeed(seed: CategorySeed, apiKey: string): Promise<string[]> {
  const selection = {
    rootCategory: seed.rootCategoryId,
    current_SALES_gte: 1,
    sort: [['current_SALES', 'asc']],
    perPage: 50,
    page: 0,
  };
  const res = await fetch(`${KEEPA_BASE_URL}/query?key=${apiKey}&domain=${KEEPA_DOMAIN_US}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection }),
  });
  if (!res.ok) throw new Error(`Keepa product finder request failed: ${res.status}`);
  const data = (await res.json()) as { asinList?: string[] };
  return data.asinList ?? [];
}

interface KeepaProductResponse {
  asin: string;
  title: string;
  categoryTree?: Array<{ name: string }>;
  csv?: Array<number[] | undefined>;
  images?: string;
  monthlySold?: number | null;
}

const CSV_NEW = 1;
const CSV_SALES = 3;
const CSV_RATING = 16;
const CSV_COUNT_REVIEWS = 17;

function latestCsvValue(csv: Array<number[] | undefined> | undefined, index: number): number | null {
  const series = csv?.[index];
  if (!series || series.length < 2) return null;
  const value = series[series.length - 1];
  return value === -1 ? null : value;
}

function buildImageUrl(imagesCsv: string | undefined): string {
  const first = imagesCsv?.split(',')[0];
  return first ? `https://m.media-amazon.com/images/I/${first}` : '';
}

export function parseKeepaProduct(product: KeepaProductResponse): KeepaCandidate {
  const priceCents = latestCsvValue(product.csv, CSV_NEW) ?? 0;
  const bsr = latestCsvValue(product.csv, CSV_SALES);
  const ratingRaw = latestCsvValue(product.csv, CSV_RATING);
  const category = product.categoryTree?.[0]?.name ?? 'Uncategorized';
  return {
    asin: product.asin,
    title: product.title,
    category,
    priceCents,
    imageUrl: buildImageUrl(product.images),
    productUrl: `https://www.amazon.com/dp/${product.asin}`,
    bsr,
    bsrCategory: bsr === null ? null : category,
    rating: ratingRaw === null ? null : ratingRaw / 10,
    reviewCount: latestCsvValue(product.csv, CSV_COUNT_REVIEWS),
    estimatedMonthlySales: product.monthlySold ?? null,
  };
}

async function fetchProductDetails(asins: string[], apiKey: string): Promise<KeepaCandidate[]> {
  if (asins.length === 0) return [];
  const res = await fetch(`${KEEPA_BASE_URL}/product?key=${apiKey}&domain=${KEEPA_DOMAIN_US}&asin=${asins.join(',')}&stats=180`);
  if (!res.ok) throw new Error(`Keepa product request failed: ${res.status}`);
  const data = (await res.json()) as { products?: KeepaProductResponse[] };
  return (data.products ?? []).map(parseKeepaProduct);
}

export async function findTrendingCandidates(apiKey: string, seeds: CategorySeed[] = CATEGORY_SEEDS): Promise<KeepaCandidate[]> {
  const asinLists = await Promise.all(seeds.map((seed) => findAsinsForSeed(seed, apiKey)));
  const uniqueAsins = Array.from(new Set(asinLists.flat()));
  return fetchProductDetails(uniqueAsins, apiKey);
}
