import type { APIContext } from 'astro';
import { getPool } from '../../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../../lib/auth.js';
import { getCandidateById, markCandidateStatus, insertDecisionHistory, buildAffiliateLinkFile } from '@lhr/db';
import { createGitHubClient, commitFilesToMain } from '@lhr/github';

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

  const associatesTag = process.env.AMAZON_ASSOCIATES_TAG;
  const githubToken = process.env.AUTHOR_GITHUB_TOKEN;
  if (!associatesTag || !githubToken) {
    return new Response(
      JSON.stringify({ error: 'Server misconfigured: missing AMAZON_ASSOCIATES_TAG or AUTHOR_GITHUB_TOKEN' }),
      { status: 500 },
    );
  }

  const client = createGitHubClient(githubToken);
  const file = buildAffiliateLinkFile(candidate, associatesTag);
  await commitFilesToMain(client, [file], `Add affiliate link: ${candidate.title}`);

  await markCandidateStatus(pool, id, 'approved');
  await insertDecisionHistory(pool, {
    asin: candidate.asin,
    category: candidate.category,
    priceCents: candidate.priceCents,
    commissionRate: candidate.commissionRate,
    estimatedMonthlySales: candidate.estimatedMonthlySales,
    decision: 'approved',
  });

  return new Response(JSON.stringify({ ok: true, path: file.path }), { status: 200 });
}
