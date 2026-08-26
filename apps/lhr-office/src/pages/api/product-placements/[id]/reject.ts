import type { APIContext } from 'astro';
import { getPool } from '../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../lib/auth.js';
import { getProposalById, markProposalStatus } from '@lhr/db';

export async function POST({ params }: APIContext): Promise<Response> {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthNotConfiguredError) {
      return new Response(JSON.stringify({ error: 'Admin auth is not configured yet' }), { status: 503 });
    }
    throw err;
  }

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid proposal id' }), { status: 400 });
  }

  const pool = getPool();
  const proposal = await getProposalById(pool, id);
  if (!proposal) {
    return new Response(JSON.stringify({ error: 'Proposal not found' }), { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Proposal is already ${proposal.status}` }), { status: 409 });
  }

  await markProposalStatus(pool, id, 'rejected');

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
