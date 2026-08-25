import type { Pool, QueryResult } from 'pg';

export interface CompetitorSeoKeyword {
  id: number;
  keyword: string;
  addedAt: Date;
}

interface CompetitorSeoKeywordRow {
  id: number;
  keyword: string;
  added_at: Date;
}

function rowToKeyword(row: CompetitorSeoKeywordRow): CompetitorSeoKeyword {
  return { id: row.id, keyword: row.keyword, addedAt: row.added_at };
}

export async function addKeyword(pool: Pool, keyword: string): Promise<CompetitorSeoKeyword> {
  const res = (await pool.query(
    `INSERT INTO competitor_seo_keywords (keyword)
     VALUES ($1)
     ON CONFLICT (keyword) DO UPDATE SET keyword = EXCLUDED.keyword
     RETURNING *`,
    [keyword],
  )) as QueryResult<CompetitorSeoKeywordRow>;
  return rowToKeyword(res.rows[0]);
}

export async function removeKeyword(pool: Pool, id: number): Promise<void> {
  await pool.query(`DELETE FROM competitor_seo_keywords WHERE id = $1`, [id]);
}

export async function listKeywords(pool: Pool): Promise<CompetitorSeoKeyword[]> {
  const res = (await pool.query(
    `SELECT * FROM competitor_seo_keywords ORDER BY keyword ASC`,
  )) as QueryResult<CompetitorSeoKeywordRow>;
  return res.rows.map(rowToKeyword);
}
