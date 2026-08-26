import type { APIContext } from 'astro';
import { getPool } from '../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../lib/auth.js';
import { getProposalById, markProposalStatus } from '@lhr/db';
import { createGitHubClient, getFile, commitFilesToMain } from '@lhr/github';
import { applyProductPlacement, StaleImageTargetError } from '@lhr/content';

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
  if (!proposal.compositedImageUrl) {
    return new Response(JSON.stringify({ error: 'Proposal has no composited image to publish' }), { status: 409 });
  }

  const githubToken = process.env.AUTHOR_GITHUB_TOKEN;
  if (!githubToken) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing AUTHOR_GITHUB_TOKEN' }), { status: 500 });
  }
  const client = createGitHubClient(githubToken);

  const file = await getFile(client, `src/content/posts/${proposal.postSlug}.mdx`, 'main');
  if (!file) {
    return new Response(JSON.stringify({ error: `Post ${proposal.postSlug} no longer exists` }), { status: 409 });
  }

  let updatedContent: string;
  try {
    updatedContent = applyProductPlacement(file.content, {
      targetImageKind: proposal.targetImageKind,
      targetImageUrl: proposal.targetImageUrl,
      targetImageLine: proposal.targetImageLine,
      compositedImageUrl: proposal.compositedImageUrl,
      affiliateLinkId: proposal.affiliateLinkId,
    });
  } catch (err) {
    if (err instanceof StaleImageTargetError) {
      await markProposalStatus(pool, id, 'stale');
      return new Response(
        JSON.stringify({ error: 'The target photo has changed since this proposal was created; marked stale.' }),
        { status: 409 },
      );
    }
    throw err;
  }

  // Marked approved before the commit attempt is deliberate: if the commit below fails, this
  // proposal stays 'approved' (not rolled back) so mcp-server's reconcileApprovedProposals picks
  // it up and retries on the next cycle, instead of leaving it stuck 'pending' forever.
  await markProposalStatus(pool, id, 'approved');

  try {
    await commitFilesToMain(
      client,
      [{ path: `src/content/posts/${proposal.postSlug}.mdx`, content: updatedContent }],
      `Add product placement: ${proposal.affiliateLinkId} in ${proposal.postSlug}`,
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Approved, but publishing the change failed; it will retry automatically.' }),
      { status: 502 },
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
