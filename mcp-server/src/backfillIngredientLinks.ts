import yaml from 'js-yaml';
import { normalizeIngredient } from './normalizeIngredient.js';

export function parsePostFrontmatter(mdxContent: string): Record<string, unknown> {
  const match = mdxContent.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error('No frontmatter delimiters found in post content');
  return yaml.load(match[1]) as Record<string, unknown>;
}

export interface BackfillPost {
  id: string;
  ingredients: Array<{ item: string }>;
  affiliateLinkIds: string[];
}

export interface BackfillResult {
  seeded: Array<{ postId: string; ingredient: string; affiliateLinkId: string }>;
  skipped: Array<{ postId: string; reason: string }>;
}

export function computeBackfillEntries(
  posts: BackfillPost[],
  existingIngredientLinks: Array<{ ingredient: string }>,
): BackfillResult {
  const seeded: BackfillResult['seeded'] = [];
  const skipped: BackfillResult['skipped'] = [];
  const seenNormalized = new Set(existingIngredientLinks.map((e) => e.ingredient));

  for (const post of posts) {
    if (post.affiliateLinkIds.length === 0) continue;

    if (post.affiliateLinkIds.length !== 1) {
      skipped.push({
        postId: post.id,
        reason: `has ${post.affiliateLinkIds.length} affiliate links; cannot infer a 1:1 pairing without guessing`,
      });
      continue;
    }

    if (post.ingredients.length !== 1) {
      skipped.push({
        postId: post.id,
        reason: `has exactly one affiliate link but ${post.ingredients.length} ingredients; cannot infer which ingredient it belongs to`,
      });
      continue;
    }

    const normalized = normalizeIngredient(post.ingredients[0].item);
    if (seenNormalized.has(normalized)) {
      skipped.push({ postId: post.id, reason: `normalized ingredient "${normalized}" already has a library entry; not overwriting` });
      continue;
    }

    seeded.push({ postId: post.id, ingredient: normalized, affiliateLinkId: post.affiliateLinkIds[0] });
    seenNormalized.add(normalized);
  }

  return { seeded, skipped };
}
