import type { Pool, QueryResult } from 'pg';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface OfficeAdmin {
  id: number;
  username: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  createdBy: number | null;
}

export type OfficeAdminSummary = Omit<OfficeAdmin, 'passwordHash'>;

interface OfficeAdminRow {
  id: number;
  username: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  created_by: number | null;
}

const SCRYPT_KEYLEN = 64;
const LOCKOUT_THRESHOLD = 5;

function rowToAdmin(row: OfficeAdminRow): OfficeAdmin {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function isLocked(admin: Pick<OfficeAdmin, 'lockedUntil'>): boolean {
  return admin.lockedUntil !== null && admin.lockedUntil.getTime() > Date.now();
}

export async function createAdmin(
  pool: Pool,
  username: string,
  password: string,
  createdBy: number | null,
): Promise<OfficeAdmin> {
  const passwordHash = hashPassword(password);
  const res = (await pool.query(
    `INSERT INTO office_admins (username, password_hash, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [username, passwordHash, createdBy],
  )) as QueryResult<OfficeAdminRow>;
  return rowToAdmin(res.rows[0]);
}

export async function getAdminByUsername(pool: Pool, username: string): Promise<OfficeAdmin | null> {
  const res = (await pool.query(
    `SELECT * FROM office_admins WHERE username = $1`,
    [username],
  )) as QueryResult<OfficeAdminRow>;
  return res.rows[0] ? rowToAdmin(res.rows[0]) : null;
}

export async function getAdminById(pool: Pool, id: number): Promise<OfficeAdmin | null> {
  const res = (await pool.query(`SELECT * FROM office_admins WHERE id = $1`, [id])) as QueryResult<OfficeAdminRow>;
  return res.rows[0] ? rowToAdmin(res.rows[0]) : null;
}

export async function listAdmins(pool: Pool): Promise<OfficeAdminSummary[]> {
  const res = (await pool.query(
    `SELECT * FROM office_admins ORDER BY created_at ASC`,
  )) as QueryResult<OfficeAdminRow>;
  return res.rows.map(rowToAdmin).map(({ passwordHash: _passwordHash, ...rest }) => rest);
}

export async function recordFailedAttempt(pool: Pool, adminId: number): Promise<void> {
  const res = (await pool.query(
    `UPDATE office_admins SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts`,
    [adminId],
  )) as QueryResult<{ failed_attempts: number }>;
  const failedAttempts = res.rows[0]?.failed_attempts ?? 0;
  if (failedAttempts >= LOCKOUT_THRESHOLD) {
    await pool.query(
      `UPDATE office_admins SET locked_until = now() + interval '15 minutes' WHERE id = $1`,
      [adminId],
    );
  }
}

export async function resetFailedAttempts(pool: Pool, adminId: number): Promise<void> {
  await pool.query(`UPDATE office_admins SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [adminId]);
}
