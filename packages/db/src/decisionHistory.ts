import type { Queryable } from './client.js';

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

// A type alias, not an interface, so it satisfies Queryable's
// `T extends Record<string, unknown>` constraint (see candidates.ts).
type DecisionHistoryRow = {
  asin: string;
  category: string;
  price_cents: number;
  commission_rate: string;
  estimated_monthly_sales: number | null;
  decision: 'approved' | 'denied';
  decided_at: Date;
};

export async function insertDecisionHistory(db: Queryable, record: NewDecisionHistoryRecord): Promise<void> {
  await db.query(
    `INSERT INTO decision_history (asin, category, price_cents, commission_rate, estimated_monthly_sales, decision)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [record.asin, record.category, record.priceCents, record.commissionRate, record.estimatedMonthlySales, record.decision],
  );
}

export async function getAllDecisionHistory(db: Queryable): Promise<DecisionHistoryRecord[]> {
  const res = await db.query<DecisionHistoryRow>(
    `SELECT asin, category, price_cents, commission_rate, estimated_monthly_sales, decision, decided_at FROM decision_history`,
  );
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

export async function getDecidedAsins(db: Queryable): Promise<Set<string>> {
  const res = await db.query<{ asin: string }>(`SELECT DISTINCT asin FROM decision_history`);
  return new Set(res.rows.map((r) => r.asin));
}
