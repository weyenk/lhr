import yaml from 'js-yaml';
import type { DraftPost } from './drafts.js';

export function buildPostFrontmatter(draft: DraftPost): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    type: draft.postType,
    title: draft.title,
    date: new Date().toISOString().slice(0, 10),
    coverPhoto: draft.photos[0]?.url ?? '',
    coverPhotoAlt: draft.photos[0]?.caption ?? draft.title,
    kitchenwareIds: draft.kitchenwareIds,
    affiliateLinkIds: [...draft.affiliateLinkIds, ...draft.pendingAffiliateLinks.map((p) => p.id)],
  };

  if (draft.postType === 'recipe') {
    frontmatter.ingredients = draft.ingredients;
    frontmatter.steps = draft.steps;
    if (draft.variants.length > 0) frontmatter.variants = draft.variants;
    if (draft.sourceMealDbId) frontmatter.sourceMealDbId = draft.sourceMealDbId;
  } else {
    frontmatter.sections = draft.sections;
  }

  return frontmatter;
}

export function renderFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  return `---\n${yaml.dump(frontmatter)}---\n`;
}

// MDX parses the body as JSX-flavored markdown, so raw `{`, `}`, and `<` characters in
// LLM-generated prose (e.g. "ready in <10 minutes", "add sugar {optional}") would break the
// build. Escape them before they're interpolated into the .mdx file.
export function escapeMdxBody(text: string): string {
  const withEscapedBraces = text.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  return withEscapedBraces.replace(/</g, '&lt;');
}

export function renderPostMdx(draft: DraftPost): string {
  const frontmatterBlock = renderFrontmatterYaml(buildPostFrontmatter(draft));
  return draft.narrativeBody ? `${frontmatterBlock}\n${escapeMdxBody(draft.narrativeBody)}\n` : frontmatterBlock;
}
