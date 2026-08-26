import type { Pool } from 'pg';
import type { GitHubClient } from './github.js';
import { getFile, commitFilesToMain } from './github.js';
import { readCollection } from './catalog.js';
import { callOpenRouter, type OpenRouterMessage } from './openrouter.js';
import { listPublishedPosts } from './publishedPosts.js';
import { enumeratePostImages, applyProductPlacement, StaleImageTargetError } from '@lhr/content';
import { getImageEditProvider, type ImageEditProvider } from './imageEdit/index.js';
import {
  computeUnattachedCandidates,
  buildMatchPrompt,
  parseMatchResponse,
  type AffiliateLinkCandidate,
  type MatchablePost,
} from './productPlacementMatching.js';
import {
  insertProductPlacementProposal,
  getPendingAffiliateLinkIds,
  getApprovedProposals,
  type NewProductPlacementProposal,
} from '@lhr/db';

export interface MatchProductsToRecipesDeps {
  githubClient: GitHubClient;
  pool: Pool;
  imageEditProvider?: ImageEditProvider;
  callLlm?: (messages: OpenRouterMessage[]) => Promise<string>;
}

interface AffiliateLinkData {
  label: string;
  url: string;
  image?: string;
}

function newCycleId(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function reconcileApprovedProposals(deps: MatchProductsToRecipesDeps): Promise<void> {
  const { githubClient, pool } = deps;
  const approved = await getApprovedProposals(pool);

  for (const proposal of approved) {
    if (!proposal.compositedImageUrl) continue;

    const file = await getFile(githubClient, `src/content/posts/${proposal.postSlug}.mdx`, 'main');
    if (!file) continue;

    const alreadyReflected =
      file.content.includes(proposal.compositedImageUrl) && file.content.includes(proposal.affiliateLinkId);
    if (alreadyReflected) continue;

    try {
      const updated = applyProductPlacement(file.content, {
        targetImageKind: proposal.targetImageKind,
        targetImageUrl: proposal.targetImageUrl,
        targetImageLine: proposal.targetImageLine,
        compositedImageUrl: proposal.compositedImageUrl,
        affiliateLinkId: proposal.affiliateLinkId,
      });
      await commitFilesToMain(
        githubClient,
        [{ path: `src/content/posts/${proposal.postSlug}.mdx`, content: updated }],
        `Add product placement: ${proposal.affiliateLinkId} in ${proposal.postSlug}`,
      );
    } catch (err) {
      if (err instanceof StaleImageTargetError) continue;
      continue; // commit failed again; retried on the next cycle
    }
  }
}

export async function matchProductsToRecipes(
  deps: MatchProductsToRecipesDeps,
): Promise<{ cycleId: string; proposalsCreated: number }> {
  await reconcileApprovedProposals(deps);

  const { githubClient, pool } = deps;
  const imageEditProvider = deps.imageEditProvider ?? getImageEditProvider();
  const callLlm = deps.callLlm ?? callOpenRouter;
  const cycleId = newCycleId();

  const [allLinkEntries, publishedPosts, pendingIds] = await Promise.all([
    readCollection<AffiliateLinkData>(githubClient, 'src/content/affiliate-links'),
    listPublishedPosts(githubClient),
    getPendingAffiliateLinkIds(pool),
  ]);

  const allLinks: AffiliateLinkCandidate[] = allLinkEntries.map((entry) => ({
    id: entry.id,
    label: entry.data.label,
    url: entry.data.url,
    imageUrl: entry.data.image,
  }));
  const attachedIds = new Set(publishedPosts.flatMap((p) => p.affiliateLinkIds));
  const candidates = computeUnattachedCandidates(allLinks, attachedIds, pendingIds);

  const postsWithImages = publishedPosts.map((post) => ({
    post,
    images: enumeratePostImages(post.raw).map((img, id) => ({ id, kind: img.kind, alt: img.alt })),
  }));
  const matchablePosts: MatchablePost[] = postsWithImages.map(({ post, images }) => ({
    slug: post.slug,
    title: post.title,
    ingredients: post.ingredients.map((i) => i.item),
    images,
  }));

  let proposalsCreated = 0;

  for (const candidate of candidates) {
    let rawResponse: string;
    try {
      rawResponse = await callLlm(buildMatchPrompt(candidate, matchablePosts));
    } catch {
      continue;
    }

    const match = parseMatchResponse(rawResponse, matchablePosts);
    if (!match) continue;

    const matchedEntry = postsWithImages.find(({ post }) => post.slug === match.slug);
    if (!matchedEntry) continue;
    const image = enumeratePostImages(matchedEntry.post.raw)[match.imageId];
    if (!image) continue;

    let compositedImageUrl: string | null = null;
    let status: 'pending' | 'edit_failed' = 'pending';

    if (!candidate.imageUrl) {
      status = 'edit_failed';
    } else {
      const editResult = await imageEditProvider.compositeProductIntoPhoto({
        sourceImageUrl: image.url,
        productImageUrl: candidate.imageUrl,
        productName: candidate.label,
      });
      if ('resultImageUrl' in editResult) {
        compositedImageUrl = editResult.resultImageUrl;
      } else {
        status = 'edit_failed';
      }
    }

    const proposal: NewProductPlacementProposal = {
      cycleId,
      affiliateLinkId: candidate.id,
      postSlug: match.slug,
      targetImageKind: image.kind,
      targetImageUrl: image.url,
      targetImageLine: image.line,
      matchRationale: match.rationale,
      compositedImageUrl,
      status,
    };
    await insertProductPlacementProposal(pool, proposal);
    proposalsCreated++;
  }

  return { cycleId, proposalsCreated };
}
