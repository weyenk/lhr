import yaml from 'js-yaml';
import type { DraftPost } from './drafts';

export function renderPostMdx(draft: DraftPost): string {
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

  return `---\n${yaml.dump(frontmatter)}---\n`;
}
