import type { APIContext } from 'astro';
import { getPool } from '../../lib/db.js';
import { deleteSession } from '@lhr/db';

const SESSION_COOKIE = 'office_session';

export async function POST({ cookies, redirect }: APIContext): Promise<Response> {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await deleteSession(getPool(), sessionId);
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login');
}
