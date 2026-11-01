import type { Queryable } from './client.js';

export type SourcedProductCycleStatus =
  | 'drafting_criteria'
  | 'awaiting_criteria_approval'
  | 'searching'
  | 'awaiting_product_picks'
  | 'monetizing'
  | 'awaiting_monetize_approval'
  | 'branding'
  | 'awaiting_final'
  | 'closed';

export type GatingProfile = 'strict' | 'trust';

export type SourcedProductCycle = {
  id: number;
  startedAt: Date;
  status: SourcedProductCycleStatus;
  criteriaJson: unknown;
  criteriaApprovedAt: Date | null;
  gatingProfile: GatingProfile;
  closedAt: Date | null;
};

// A type alias (not an interface) so it satisfies Queryable's
// `T extends Record<string, unknown>` constraint.
type SourcedProductCycleRow = {
  id: number;
  started_at: Date;
  status: SourcedProductCycleStatus;
  criteria_json: unknown;
  criteria_approved_at: Date | null;
  gating_profile: GatingProfile;
  closed_at: Date | null;
};

function mapRow(row: SourcedProductCycleRow): SourcedProductCycle {
  return {
    id: row.id,
    startedAt: row.started_at,
    status: row.status,
    criteriaJson: row.criteria_json,
    criteriaApprovedAt: row.criteria_approved_at,
    gatingProfile: row.gating_profile,
    closedAt: row.closed_at,
  };
}

export async function createSourcedProductCycle(
  db: Queryable,
  input: { gatingProfile: GatingProfile },
): Promise<SourcedProductCycle> {
  const res = await db.query<SourcedProductCycleRow>(
    `INSERT INTO sourced_product_cycles (status, gating_profile)
     VALUES ($1, $2)
     RETURNING *`,
    ['drafting_criteria', input.gatingProfile],
  );
  return mapRow(res.rows[0]);
}

/** The newest cycle in any status other than `closed`. */
export async function getOpenSourcedProductCycle(db: Queryable): Promise<SourcedProductCycle | null> {
  const res = await db.query<SourcedProductCycleRow>(
    `SELECT * FROM sourced_product_cycles
     WHERE status <> 'closed'
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function getSourcedProductCycle(db: Queryable, id: number): Promise<SourcedProductCycle | null> {
  const res = await db.query<SourcedProductCycleRow>(
    `SELECT * FROM sourced_product_cycles WHERE id = $1`,
    [id],
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

/** Stores the criteria only; callers move the status with `setCycleStatus`. */
export async function setCycleCriteria(db: Queryable, id: number, criteriaJson: unknown): Promise<void> {
  await db.query(
    `UPDATE sourced_product_cycles SET criteria_json = $1 WHERE id = $2`,
    [JSON.stringify(criteriaJson), id],
  );
}

export async function setCycleStatus(db: Queryable, id: number, status: SourcedProductCycleStatus): Promise<void> {
  await db.query(`UPDATE sourced_product_cycles SET status = $1 WHERE id = $2`, [status, id]);
}

export async function approveCycleCriteria(db: Queryable, id: number): Promise<void> {
  await db.query(
    `UPDATE sourced_product_cycles
     SET criteria_approved_at = now(), status = 'searching'
     WHERE id = $1`,
    [id],
  );
}

export async function closeSourcedProductCycle(db: Queryable, id: number): Promise<void> {
  await db.query(
    `UPDATE sourced_product_cycles SET status = 'closed', closed_at = now() WHERE id = $1`,
    [id],
  );
}
