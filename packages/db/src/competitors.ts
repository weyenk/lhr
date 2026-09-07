import type { Queryable } from './client.js';

export type CompetitorStatus = 'candidate' | 'tracked' | 'rejected';

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discoveredAt: Date;
  approvedAt: Date | null;
}

type CompetitorRow = {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discovered_at: Date;
  approved_at: Date | null;
};

function mapRow(row: CompetitorRow): Competitor {
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
  db: Queryable,
  domain: string,
  name: string | null = null,
): Promise<Competitor | null> {
  const result = await db.query<CompetitorRow>(
    `INSERT INTO competitors (domain, name) VALUES ($1, $2) ON CONFLICT (domain) DO NOTHING RETURNING *`,
    [domain, name],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listCompetitorsByStatus(db: Queryable, status: CompetitorStatus): Promise<Competitor[]> {
  const result = await db.query<CompetitorRow>(
    `SELECT * FROM competitors WHERE status = $1 ORDER BY domain ASC`,
    [status],
  );
  return result.rows.map(mapRow);
}

export async function setCompetitorStatus(db: Queryable, id: number, status: 'tracked' | 'rejected'): Promise<void> {
  if (status === 'tracked') {
    await db.query(`UPDATE competitors SET status = 'tracked', approved_at = now() WHERE id = $1`, [id]);
  } else {
    await db.query(`UPDATE competitors SET status = 'rejected' WHERE id = $1`, [id]);
  }
}
