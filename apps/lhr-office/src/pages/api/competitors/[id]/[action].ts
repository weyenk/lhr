import type { APIContext } from 'astro';
import { requireAdminSession } from '../../../../lib/auth.js';
import { getPool } from '../../../../lib/db.js';
import { setCompetitorStatus } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context as never);
  if ('response' in authResult) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid competitor id' }), { status: 400 });
  }

  const action = context.params.action;
  if (action !== 'approve' && action !== 'reject') {
    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
  }

  await setCompetitorStatus(getPool(), id, action === 'approve' ? 'tracked' : 'rejected');
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
