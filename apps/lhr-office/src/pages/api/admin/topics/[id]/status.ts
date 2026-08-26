import type { APIContext } from 'astro';
import { getPool } from '../../../../../lib/db.js';
import { requireAdminSession } from '../../../../../lib/auth.js';
import { setTopicStatus } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context);
  if ('response' in authResult) return authResult.response;

  const form = await context.request.formData();
  const status = String(form.get('status') ?? '');
  if (status !== 'curated' && status !== 'candidate') {
    return new Response('Invalid status', { status: 400 });
  }

  const id = Number(context.params.id);
  if (!Number.isInteger(id)) return new Response('Invalid topic id', { status: 400 });
  await setTopicStatus(getPool(), id, status);

  return context.redirect('/admin/');
}
