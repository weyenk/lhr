import type { Queryable } from './client.js';

export interface CompetitorDiscoveryQuery {
  id: number;
  query: string;
  addedAt: Date;
}

type CompetitorDiscoveryQueryRow = {
  id: number;
  query: string;
  added_at: Date;
};

function mapRow(row: CompetitorDiscoveryQueryRow): CompetitorDiscoveryQuery {
  return { id: row.id, query: row.query, addedAt: row.added_at };
}

export async function addDiscoveryQuery(db: Queryable, query: string): Promise<CompetitorDiscoveryQuery> {
  const normalized = query.trim();
  if (!normalized) throw new Error('Discovery query cannot be empty');
  const result = await db.query<CompetitorDiscoveryQueryRow>(
    `INSERT INTO competitor_discovery_queries (query)
     VALUES ($1)
     ON CONFLICT (query) DO UPDATE SET query = EXCLUDED.query
     RETURNING *`,
    [normalized],
  );
  return mapRow(result.rows[0]);
}

export async function removeDiscoveryQuery(db: Queryable, id: number): Promise<void> {
  await db.query(`DELETE FROM competitor_discovery_queries WHERE id = $1`, [id]);
}

export async function listDiscoveryQueries(db: Queryable): Promise<CompetitorDiscoveryQuery[]> {
  const result = await db.query<CompetitorDiscoveryQueryRow>(
    `SELECT * FROM competitor_discovery_queries ORDER BY query ASC`,
  );
  return result.rows.map(mapRow);
}
