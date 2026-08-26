import type { Pool, QueryResult } from 'pg';

export type ProductPlacementImageKind = 'cover' | 'body';
export type ProductPlacementStatus = 'pending' | 'approved' | 'rejected' | 'edit_failed' | 'stale';

export interface ProductPlacementProposal {
  id: number;
  cycleId: string;
  affiliateLinkId: string;
  postSlug: string;
  targetImageKind: ProductPlacementImageKind;
  targetImageUrl: string;
  targetImageLine: string | null;
  matchRationale: string;
  compositedImageUrl: string | null;
  status: ProductPlacementStatus;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface NewProductPlacementProposal {
  cycleId: string;
  affiliateLinkId: string;
  postSlug: string;
  targetImageKind: ProductPlacementImageKind;
  targetImageUrl: string;
  targetImageLine: string | null;
  matchRationale: string;
  compositedImageUrl: string | null;
  status: 'pending' | 'edit_failed';
}

interface ProposalRow {
  id: number;
  cycle_id: string;
  affiliate_link_id: string;
  post_slug: string;
  target_image_kind: ProductPlacementImageKind;
  target_image_url: string;
  target_image_line: string | null;
  match_rationale: string;
  composited_image_url: string | null;
  status: ProductPlacementStatus;
  decided_at: Date | null;
  created_at: Date;
}

function rowToProposal(row: ProposalRow): ProductPlacementProposal {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    affiliateLinkId: row.affiliate_link_id,
    postSlug: row.post_slug,
    targetImageKind: row.target_image_kind,
    targetImageUrl: row.target_image_url,
    targetImageLine: row.target_image_line,
    matchRationale: row.match_rationale,
    compositedImageUrl: row.composited_image_url,
    status: row.status,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function insertProductPlacementProposal(
  pool: Pool,
  proposal: NewProductPlacementProposal,
): Promise<number> {
  const res = (await pool.query(
    `INSERT INTO product_placement_proposals
       (cycle_id, affiliate_link_id, post_slug, target_image_kind, target_image_url,
        target_image_line, match_rationale, composited_image_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      proposal.cycleId, proposal.affiliateLinkId, proposal.postSlug, proposal.targetImageKind,
      proposal.targetImageUrl, proposal.targetImageLine, proposal.matchRationale,
      proposal.compositedImageUrl, proposal.status,
    ],
  )) as QueryResult<{ id: number }>;
  return res.rows[0].id;
}

export async function getPendingProposals(pool: Pool): Promise<ProductPlacementProposal[]> {
  const res = (await pool.query(
    `SELECT * FROM product_placement_proposals WHERE status = 'pending' ORDER BY created_at ASC`,
  )) as QueryResult<ProposalRow>;
  return res.rows.map(rowToProposal);
}

export async function getProposalById(pool: Pool, id: number): Promise<ProductPlacementProposal | null> {
  const res = (await pool.query(
    `SELECT * FROM product_placement_proposals WHERE id = $1`,
    [id],
  )) as QueryResult<ProposalRow>;
  return res.rows[0] ? rowToProposal(res.rows[0]) : null;
}

export async function markProposalStatus(
  pool: Pool,
  id: number,
  status: 'approved' | 'rejected' | 'stale',
): Promise<void> {
  await pool.query(
    `UPDATE product_placement_proposals SET status = $1, decided_at = now() WHERE id = $2`,
    [status, id],
  );
}

export async function getPendingAffiliateLinkIds(pool: Pool): Promise<Set<string>> {
  const res = (await pool.query(
    `SELECT DISTINCT affiliate_link_id FROM product_placement_proposals WHERE status = 'pending'`,
  )) as QueryResult<{ affiliate_link_id: string }>;
  return new Set(res.rows.map((r) => r.affiliate_link_id));
}

export async function getApprovedProposals(pool: Pool): Promise<ProductPlacementProposal[]> {
  const res = (await pool.query(
    `SELECT * FROM product_placement_proposals WHERE status = 'approved' ORDER BY decided_at ASC`,
  )) as QueryResult<ProposalRow>;
  return res.rows.map(rowToProposal);
}
