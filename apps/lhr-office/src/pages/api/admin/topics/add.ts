import type { APIContext } from 'astro';
import { getPool } from '../../../../lib/db.js';
import { requireAdminSession } from '../../../../lib/auth.js';
import { addCuratedTopic, TREND_CATEGORIES, type TrendCategory } from '@lhr/db';

function isTrendCategory(value: string): value is TrendCategory {
  return (TREND_CATEGORIES as readonly string[]).includes(value);
}

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context);
  if ('response' in authResult) return authResult.response;

  const form = await context.request.formData();
  const category = String(form.get('category') ?? '');
  const topic = String(form.get('topic') ?? '');
  if (!isTrendCategory(category)) {
    return new Response('Invalid category', { status: 400 });
  }

  await addCuratedTopic(getPool(), category, topic);

  return context.redirect('/admin/');
}
