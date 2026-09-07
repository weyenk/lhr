import type { Queryable } from './client.js';

export interface CompetitorSeoKeyword {
  id: number;
  keyword: string;
  addedAt: Date;
}

type CompetitorSeoKeywordRow = {
  id: number;
  keyword: string;
  added_at: Date;
};

function mapRow(row: CompetitorSeoKeywordRow): CompetitorSeoKeyword {
  return { id: row.id, keyword: row.keyword, addedAt: row.added_at };
}

export async function addKeyword(db: Queryable, keyword: string): Promise<CompetitorSeoKeyword> {
  const result = await db.query<CompetitorSeoKeywordRow>(
    `INSERT INTO competitor_seo_keywords (keyword)
     VALUES ($1)
     ON CONFLICT (keyword) DO UPDATE SET keyword = EXCLUDED.keyword
     RETURNING *`,
    [keyword],
  );
  return mapRow(result.rows[0]);
}

export async function removeKeyword(db: Queryable, id: number): Promise<void> {
  await db.query(`DELETE FROM competitor_seo_keywords WHERE id = $1`, [id]);
}

export async function listKeywords(db: Queryable): Promise<CompetitorSeoKeyword[]> {
  const result = await db.query<CompetitorSeoKeywordRow>(`SELECT * FROM competitor_seo_keywords ORDER BY keyword ASC`);
  return result.rows.map(mapRow);
}
