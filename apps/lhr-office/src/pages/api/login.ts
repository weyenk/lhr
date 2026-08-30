import type { APIContext } from 'astro';
import { getPool } from '../../lib/db.js';
import { getAdminByUsername, isLocked, verifyPassword, recordFailedAttempt, resetFailedAttempts, createSession } from '@lhr/db';

const SESSION_COOKIE = 'office_session';
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export async function POST({ request, cookies, redirect }: APIContext): Promise<Response> {
  const form = await request.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');

  const pool = getPool();
  const admin = await getAdminByUsername(pool, username);
  if (!admin) {
    return new Response('Invalid username or password', { status: 401 });
  }
  if (isLocked(admin)) {
    return new Response('Account locked. Try again in 15 minutes.', { status: 423 });
  }
  if (!verifyPassword(password, admin.passwordHash)) {
    await recordFailedAttempt(pool, admin.id);
    return new Response('Invalid username or password', { status: 401 });
  }

  await resetFailedAttempts(pool, admin.id);
  const session = await createSession(pool, admin.id);
  cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SEVEN_DAYS_SECONDS,
  });
  return redirect('/');
}
