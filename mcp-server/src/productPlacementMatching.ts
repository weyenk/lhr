import type { OpenRouterMessage } from './openrouter.js';

export interface AffiliateLinkCandidate {
  id: string;
  label: string;
  url: string;
  imageUrl?: string;
}

export interface MatchablePostImage {
  id: number;
  kind: 'cover' | 'body';
  alt: string;
}

export interface MatchablePost {
  slug: string;
  title: string;
  ingredients: string[];
  images: MatchablePostImage[];
}

export interface MatchResult {
  slug: string;
  imageId: number;
  rationale: string;
}

export function computeUnattachedCandidates(
  allLinks: AffiliateLinkCandidate[],
  attachedIds: Set<string>,
  pendingIds: Set<string>,
): AffiliateLinkCandidate[] {
  return allLinks.filter((link) => !attachedIds.has(link.id) && !pendingIds.has(link.id));
}

export function buildMatchPrompt(product: AffiliateLinkCandidate, posts: MatchablePost[]): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content:
        'You match affiliate products to the best-fit recipe post on a food blog, and pick which ' +
        'photo in that post the product should be composited into. Respond with ONLY JSON, no ' +
        'other text, in exactly this shape: {"match": {"slug": string, "imageId": number, ' +
        '"rationale": string}} or {"match": null} if nothing fits well enough.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        product: { label: product.label, url: product.url },
        posts: posts.map((post) => ({
          slug: post.slug,
          title: post.title,
          ingredients: post.ingredients,
          images: post.images,
        })),
      }),
    },
  ];
}

export function parseMatchResponse(rawText: string, posts: MatchablePost[]): MatchResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  const match = (parsed as { match?: unknown } | null)?.match;
  if (!match || typeof match !== 'object') return null;

  const { slug, imageId, rationale } = match as Record<string, unknown>;
  if (typeof slug !== 'string' || typeof imageId !== 'number' || typeof rationale !== 'string') return null;

  const post = posts.find((p) => p.slug === slug);
  if (!post || !post.images.some((img) => img.id === imageId)) return null;

  return { slug, imageId, rationale };
}
