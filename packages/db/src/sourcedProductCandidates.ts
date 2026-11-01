import type { Queryable } from './client.js';

export type SourcedProductCandidateStatus =
  | 'sourced'
  | 'picked'
  | 'skipped'
  | 'monetize_pass'
  | 'monetize_fail'
  | 'monetize_confirmed'
  | 'dropped'
  | 'brand_pass'
  | 'brand_fail'
  | 'pending_final'
  | 'approved'
  | 'denied';

export type SourcedProductCandidate = {
  id: number;
  cycleId: number;
  title: string;
  imageUrl: string | null;
  sourceUrl: string;
  platform: string;
  moq: string | null;
  unitCostCents: number | null;
  notes: string | null;
  status: SourcedProductCandidateStatus;
  monetizePass: boolean | null;
  monetizeRationale: string | null;
  brandPass: boolean | null;
  brandRationale: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

export type NewSourcedProductCandidate = {
  cycleId: number;
  title: string;
  imageUrl?: string | null;
  sourceUrl: string;
  platform: string;
  moq?: string | null;
  unitCostCents?: number | null;
  notes?: string | null;
};

// A type alias (not an interface) so it satisfies Queryable's
// `T extends Record<string, unknown>` constraint.
type SourcedProductCandidateRow = {
  id: number;
  cycle_id: number;
  title: string;
  image_url: string | null;
  source_url: string;
  platform: string;
  moq: string | null;
  unit_cost_cents: number | null;
  notes: string | null;
  status: SourcedProductCandidateStatus;
  monetize_pass: boolean | null;
  monetize_rationale: string | null;
  brand_pass: boolean | null;
  brand_rationale: string | null;
  decided_at: Date | null;
  created_at: Date;
};

function mapRow(row: SourcedProductCandidateRow): SourcedProductCandidate {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    title: row.title,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    platform: row.platform,
    moq: row.moq,
    unitCostCents: row.unit_cost_cents,
    notes: row.notes,
    status: row.status,
    monetizePass: row.monetize_pass,
    monetizeRationale: row.monetize_rationale,
    brandPass: row.brand_pass,
    brandRationale: row.brand_rationale,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/** Returns null when `(cycle_id, source_url)` already exists (safe no-op). */
export async function insertSourcedProductCandidate(
  db: Queryable,
  candidate: NewSourcedProductCandidate,
): Promise<SourcedProductCandidate | null> {
  const res = await db.query<SourcedProductCandidateRow>(
    `INSERT INTO sourced_product_candidates
       (cycle_id, title, image_url, source_url, platform, moq, unit_cost_cents, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (cycle_id, source_url) DO NOTHING
     RETURNING *`,
    [
      candidate.cycleId,
      candidate.title,
      candidate.imageUrl ?? null,
      candidate.sourceUrl,
      candidate.platform,
      candidate.moq ?? null,
      candidate.unitCostCents ?? null,
      candidate.notes ?? null,
    ],
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function listSourcedProductCandidates(
  db: Queryable,
  cycleId: number,
  status?: SourcedProductCandidateStatus,
): Promise<SourcedProductCandidate[]> {
  const res = status === undefined
    ? await db.query<SourcedProductCandidateRow>(
        `SELECT * FROM sourced_product_candidates WHERE cycle_id = $1 ORDER BY id ASC`,
        [cycleId],
      )
    : await db.query<SourcedProductCandidateRow>(
        `SELECT * FROM sourced_product_candidates WHERE cycle_id = $1 AND status = $2 ORDER BY id ASC`,
        [cycleId, status],
      );
  return res.rows.map(mapRow);
}

export async function setCandidateStatus(
  db: Queryable,
  id: number,
  status: SourcedProductCandidateStatus,
): Promise<void> {
  await db.query(`UPDATE sourced_product_candidates SET status = $1 WHERE id = $2`, [status, id]);
}

export async function setCandidateMonetizeResult(
  db: Queryable,
  id: number,
  result: { pass: boolean; rationale: string },
): Promise<void> {
  await db.query(
    `UPDATE sourced_product_candidates
     SET monetize_pass = $1, monetize_rationale = $2
     WHERE id = $3`,
    [result.pass, result.rationale, id],
  );
}

export async function setCandidateBrandResult(
  db: Queryable,
  id: number,
  result: { pass: boolean; rationale: string },
): Promise<void> {
  await db.query(
    `UPDATE sourced_product_candidates
     SET brand_pass = $1, brand_rationale = $2
     WHERE id = $3`,
    [result.pass, result.rationale, id],
  );
}

export async function decideSourcedProductCandidate(
  db: Queryable,
  id: number,
  decision: 'approved' | 'denied',
): Promise<void> {
  await db.query(
    `UPDATE sourced_product_candidates SET status = $1, decided_at = now() WHERE id = $2`,
    [decision, id],
  );
}
