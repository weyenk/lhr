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

  if (username.trim().length === 0) {
    return context.redirect('/admin/?error=' + encodeURIComponent('Username is required'));
  }
  if (password.length < 12) {
    return context.redirect('/admin/?error=' + encodeURIComponent('Password must be at least 12 characters'));
  }

  try {
    await createAdmin(getPool(), username, password, authResult.admin.id);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
      return context.redirect('/admin/?error=' + encodeURIComponent('That username already exists'));
    }
    throw err;
  }

  return context.redirect('/admin/');
}
