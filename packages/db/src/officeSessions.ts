import type { Pool, QueryResult } from 'pg';
import { randomBytes } from 'node:crypto';

export interface OfficeSession {
  id: string;
  adminId: number;
  createdAt: Date;
  expiresAt: Date;
}

interface OfficeSessionRow {
  id: string;
  admin_id: number;
  created_at: Date;
  expires_at: Date;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function rowToSession(row: OfficeSessionRow): OfficeSession {
  return { id: row.id, adminId: row.admin_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

export async function createSession(pool: Pool, adminId: number): Promise<OfficeSession> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const res = (await pool.query(
    `INSERT INTO office_sessions (id, admin_id, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [id, adminId, expiresAt],
  )) as QueryResult<OfficeSessionRow>;
  return rowToSession(res.rows[0]);
}

export async function getSession(pool: Pool, id: string): Promise<OfficeSession | null> {
  const res = (await pool.query(`SELECT * FROM office_sessions WHERE id = $1`, [id])) as QueryResult<OfficeSessionRow>;
  return res.rows[0] ? rowToSession(res.rows[0]) : null;
}

export async function renewSession(pool: Pool, id: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(`UPDATE office_sessions SET expires_at = $1 WHERE id = $2`, [expiresAt, id]);
}

export async function deleteSession(pool: Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM office_sessions WHERE id = $1`, [id]);
}
