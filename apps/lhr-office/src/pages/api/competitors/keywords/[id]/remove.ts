import type { APIContext } from 'astro';
import { requireAdminSession } from '../../../../../lib/auth.js';
import { getPool } from '../../../../../lib/db.js';
import { removeKeyword } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context as never);
  if ('response' in authResult) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid keyword id' }), { status: 400 });
  }

  await removeKeyword(getPool(), id);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
