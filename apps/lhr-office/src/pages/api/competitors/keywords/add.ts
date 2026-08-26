import type { APIContext } from 'astro';
import { requireAdminSession } from '../../../../lib/auth.js';
import { getPool } from '../../../../lib/db.js';
import { addKeyword } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context as never);
  if ('response' in authResult) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const form = await context.request.formData();
  const keyword = String(form.get('keyword') ?? '').trim();
  if (!keyword) {
    return new Response(JSON.stringify({ error: 'Keyword must not be empty' }), { status: 400 });
  }

  const created = await addKeyword(getPool(), keyword);
  return new Response(JSON.stringify(created), { status: 200 });
}
