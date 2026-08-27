import type { Pool, QueryResult } from 'pg';

export interface Candidate {
  id: number;
  cycleId: string;
  asin: string;
  title: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  productUrl: string;
  commissionRate: number;
  commissionRateIsFallback: boolean;
  estimatedMonthlySales: number | null;
  bsr: number | null;
  bsrCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  score: number;
  isWildcard: boolean;
  status: 'pending' | 'approved' | 'denied';
  decidedAt: Date | null;
  createdAt: Date;
}

export interface NewCandidate {
  cycleId: string;
  asin: string;
  title: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  productUrl: string;
  commissionRate: number;
  commissionRateIsFallback: boolean;
  estimatedMonthlySales: number | null;
  bsr: number | null;
  bsrCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  score: number;
  isWildcard: boolean;
}

interface CandidateRow {
  id: number;
  cycle_id: string;
  asin: string;
  title: string;
  category: string;
  price_cents: number;
  image_url: string;
  product_url: string;
  commission_rate: string;
  commission_rate_is_fallback: boolean;
  estimated_monthly_sales: number | null;
  bsr: number | null;
  bsr_category: string | null;
  rating: string | null;
  review_count: number | null;
  score: string;
  is_wildcard: boolean;
  status: 'pending' | 'approved' | 'denied';
  decided_at: Date | null;
  created_at: Date;
}

function rowToCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    asin: row.asin,
    title: row.title,
    category: row.category,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    commissionRate: Number(row.commission_rate),
    commissionRateIsFallback: row.commission_rate_is_fallback,
    estimatedMonthlySales: row.estimated_monthly_sales,
    bsr: row.bsr,
    bsrCategory: row.bsr_category,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: row.review_count,
    score: Number(row.score),
    isWildcard: row.is_wildcard,
    status: row.status,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

const INSERT_COLUMNS = [
  'cycle_id', 'asin', 'title', 'category', 'price_cents', 'image_url', 'product_url',
  'commission_rate', 'commission_rate_is_fallback', 'estimated_monthly_sales',
  'bsr', 'bsr_category', 'rating', 'review_count', 'score', 'is_wildcard',
] as const;

export async function insertCandidates(pool: Pool, candidates: NewCandidate[]): Promise<void> {
  if (candidates.length === 0) return;

  const values: unknown[] = [];
  const rowPlaceholders = candidates.map((c, i) => {
    values.push(
      c.cycleId, c.asin, c.title, c.category, c.priceCents, c.imageUrl, c.productUrl,
      c.commissionRate, c.commissionRateIsFallback, c.estimatedMonthlySales,
      c.bsr, c.bsrCategory, c.rating, c.reviewCount, c.score, c.isWildcard,
    );
    const base = i * INSERT_COLUMNS.length;
    return `(${INSERT_COLUMNS.map((_, j) => `$${base + j + 1}`).join(', ')})`;
  });

  await pool.query(
    `INSERT INTO candidates (${INSERT_COLUMNS.join(', ')})
     VALUES ${rowPlaceholders.join(', ')}
     ON CONFLICT (cycle_id, asin) DO NOTHING`,
    values,
  );
}

export async function getPendingCandidates(pool: Pool, cycleId: string): Promise<Candidate[]> {
  const res = (await pool.query(
    `SELECT * FROM candidates WHERE cycle_id = $1 AND status = 'pending' ORDER BY score DESC`,
    [cycleId],
  )) as QueryResult<CandidateRow>;
  return res.rows.map(rowToCandidate);
}

export async function getLatestPendingCycleId(pool: Pool): Promise<string | null> {
  const res = (await pool.query(
    `SELECT DISTINCT cycle_id FROM candidates WHERE status = 'pending' ORDER BY cycle_id DESC LIMIT 1`,
  )) as QueryResult<{ cycle_id: string }>;
  return res.rows[0]?.cycle_id ?? null;
}

export async function getCandidateById(pool: Pool, id: number): Promise<Candidate | null> {
  const res = (await pool.query(`SELECT * FROM candidates WHERE id = $1`, [id])) as QueryResult<CandidateRow>;
  return res.rows[0] ? rowToCandidate(res.rows[0]) : null;
}

export async function markCandidateStatus(pool: Pool, id: number, status: 'approved' | 'denied'): Promise<void> {
  await pool.query(`UPDATE candidates SET status = $1, decided_at = now() WHERE id = $2`, [status, id]);
}

export async function getApprovedCandidates(pool: Pool): Promise<Candidate[]> {
  const res = (await pool.query(
    `SELECT * FROM candidates WHERE status = 'approved' ORDER BY decided_at ASC`,
  )) as QueryResult<CandidateRow>;
  return res.rows.map(rowToCandidate);
}
