import type { APIContext } from 'astro';
import { getPool } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/auth.js';
import { createAdmin } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context);
  if ('response' in authResult) return authResult.response;

  const form = await context.request.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');

  await createAdmin(getPool(), username, password, authResult.admin.id);

  return context.redirect('/admin/');
}
