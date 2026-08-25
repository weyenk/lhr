import type { Pool, QueryResult } from 'pg';

export type CompetitorStatus = 'candidate' | 'tracked' | 'rejected';

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discoveredAt: Date;
  approvedAt: Date | null;
}

interface CompetitorRow {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discovered_at: Date;
  approved_at: Date | null;
}

function rowToCompetitor(row: CompetitorRow): Competitor {
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    status: row.status,
    discoveredAt: row.discovered_at,
    approvedAt: row.approved_at,
  };
}

export async function insertCandidateCompetitor(
  pool: Pool,
  domain: string,
  name: string | null = null,
): Promise<Competitor | null> {
  const res = (await pool.query(
    `INSERT INTO competitors (domain, name) VALUES ($1, $2) ON CONFLICT (domain) DO NOTHING RETURNING *`,
    [domain, name],
  )) as QueryResult<CompetitorRow>;
  return res.rows[0] ? rowToCompetitor(res.rows[0]) : null;
}

export async function getCompetitorByDomain(pool: Pool, domain: string): Promise<Competitor | null> {
  const res = (await pool.query(`SELECT * FROM competitors WHERE domain = $1`, [domain])) as QueryResult<CompetitorRow>;
  return res.rows[0] ? rowToCompetitor(res.rows[0]) : null;
}

export async function getCompetitorById(pool: Pool, id: number): Promise<Competitor | null> {
  const res = (await pool.query(`SELECT * FROM competitors WHERE id = $1`, [id])) as QueryResult<CompetitorRow>;
  return res.rows[0] ? rowToCompetitor(res.rows[0]) : null;
}

export async function listCompetitorsByStatus(pool: Pool, status: CompetitorStatus): Promise<Competitor[]> {
  const res = (await pool.query(
    `SELECT * FROM competitors WHERE status = $1 ORDER BY domain ASC`,
    [status],
  )) as QueryResult<CompetitorRow>;
  return res.rows.map(rowToCompetitor);
}

export async function setCompetitorStatus(pool: Pool, id: number, status: 'tracked' | 'rejected'): Promise<void> {
  if (status === 'tracked') {
    await pool.query(`UPDATE competitors SET status = 'tracked', approved_at = now() WHERE id = $1`, [id]);
  } else {
    await pool.query(`UPDATE competitors SET status = 'rejected' WHERE id = $1`, [id]);
  }
}
