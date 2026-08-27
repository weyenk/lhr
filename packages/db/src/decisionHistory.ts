import type { Pool, QueryResult } from 'pg';

export interface DecisionHistoryRecord {
  asin: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  estimatedMonthlySales: number | null;
  decision: 'approved' | 'denied';
  decidedAt: Date;
}

export interface NewDecisionHistoryRecord {
  asin: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  estimatedMonthlySales: number | null;
  decision: 'approved' | 'denied';
}

interface DecisionHistoryRow {
  asin: string;
  category: string;
  price_cents: number;
  commission_rate: string;
  estimated_monthly_sales: number | null;
  decision: 'approved' | 'denied';
  decided_at: Date;
}

export async function insertDecisionHistory(pool: Pool, record: NewDecisionHistoryRecord): Promise<void> {
  await pool.query(
    `INSERT INTO decision_history (asin, category, price_cents, commission_rate, estimated_monthly_sales, decision)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [record.asin, record.category, record.priceCents, record.commissionRate, record.estimatedMonthlySales, record.decision],
  );
}

export async function getAllDecisionHistory(pool: Pool): Promise<DecisionHistoryRecord[]> {
  const res = (await pool.query(
    `SELECT asin, category, price_cents, commission_rate, estimated_monthly_sales, decision, decided_at FROM decision_history`,
  )) as QueryResult<DecisionHistoryRow>;
  return res.rows.map((row) => ({
    asin: row.asin,
    category: row.category,
    priceCents: row.price_cents,
    commissionRate: Number(row.commission_rate),
    estimatedMonthlySales: row.estimated_monthly_sales,
    decision: row.decision,
    decidedAt: row.decided_at,
  }));
}

export async function getDecidedAsins(pool: Pool): Promise<Set<string>> {
  const res = (await pool.query(`SELECT DISTINCT asin FROM decision_history`)) as QueryResult<{ asin: string }>;
  return new Set(res.rows.map((r) => r.asin));
}
