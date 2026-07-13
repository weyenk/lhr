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
  } else {
    frontmatter.sections = draft.sections;
  }

  return frontmatter;
}

export function renderFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  return `---\n${yaml.dump(frontmatter)}---\n`;
}

export function renderPostMdx(draft: DraftPost): string {
  return renderFrontmatterYaml(buildPostFrontmatter(draft));
}
