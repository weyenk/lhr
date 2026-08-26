import type { APIContext } from 'astro';
import { getPool } from '../../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../../lib/auth.js';
import { getCandidateById, markCandidateStatus, insertDecisionHistory } from '@lhr/db';

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
    return new Response(JSON.stringify({ error: 'Invalid candidate id' }), { status: 400 });
  }

  const pool = getPool();
  const candidate = await getCandidateById(pool, id);
  if (!candidate) {
    return new Response(JSON.stringify({ error: 'Candidate not found' }), { status: 404 });
  }
  if (candidate.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Candidate is already ${candidate.status}` }), { status: 409 });
  }

  await markCandidateStatus(pool, id, 'denied');
  await insertDecisionHistory(pool, {
    asin: candidate.asin,
    category: candidate.category,
    priceCents: candidate.priceCents,
    commissionRate: candidate.commissionRate,
    estimatedMonthlySales: candidate.estimatedMonthlySales,
    decision: 'denied',
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
