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

/** Strip protocol/www/path so "https://www.Foo.com/x" and "foo.com" collide on UNIQUE(domain). */
export function normalizeCompetitorDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.split(/[/?#]/)[0] ?? '';
  return domain.replace(/\.$/, '');
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

/** Manual add from the office: create as tracked, or re-track if the domain already exists. */
export async function upsertTrackedCompetitor(
  db: Queryable,
  domainInput: string,
  name: string | null = null,
): Promise<Competitor> {
  const domain = normalizeCompetitorDomain(domainInput);
  if (!domain || !domain.includes('.')) {
    throw new Error('Enter a valid domain (e.g. example.com)');
  }
  const result = await db.query<CompetitorRow>(
    `INSERT INTO competitors (domain, name, status, approved_at)
     VALUES ($1, $2, 'tracked', now())
     ON CONFLICT (domain) DO UPDATE
       SET status = 'tracked',
           approved_at = COALESCE(competitors.approved_at, now()),
           name = COALESCE(EXCLUDED.name, competitors.name)
     RETURNING *`,
    [domain, name],
  );
  return mapRow(result.rows[0]);
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
