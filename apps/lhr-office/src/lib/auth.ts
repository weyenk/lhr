import { getPool } from './db.js';
import { getSession, renewSession, getAdminById, type OfficeAdmin } from '@lhr/db';

const SESSION_COOKIE = 'office_session';

export interface AuthContext {
  cookies: { get(name: string): { value: string } | undefined };
  redirect(path: string): Response;
}

export type AuthResult = { admin: OfficeAdmin } | { response: Response };

export async function requireAdminSession(context: AuthContext): Promise<AuthResult> {
  const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return { response: context.redirect('/login') };

  const pool = getPool();
  const session = await getSession(pool, sessionId);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    return { response: context.redirect('/login') };
  }

  const admin = await getAdminById(pool, session.adminId);
  if (!admin) return { response: context.redirect('/login') };

  await renewSession(pool, sessionId);
  return { admin };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
