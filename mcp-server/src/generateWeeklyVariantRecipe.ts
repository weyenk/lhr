import { listFiles, getFile, type GitHubClient } from './github.js';
import { parsePostFrontmatter } from './backfillIngredientLinks.js';
import { createDraft, listDrafts, readDraft, type DraftPost } from './drafts.js';
import { pickUnusedSourceRecipe } from './themealdb.js';
import { generateAllVariants } from './dietSubstitutions.js';
import { generateNarrative } from './narrative.js';
import { postSchema } from '@lhr/schemas';

export interface WeeklyRunResult {
  skipped: boolean;
  draftId?: string;
  title?: string;
  sourceMealDbId?: string;
  flaggedDiets?: string[];
}

export async function loadExistingSourceMealDbIds(client: GitHubClient): Promise<Set<string>> {
  const filenames = await listFiles(client, 'src/content/posts', 'main');
  const ids = new Set<string>();
  for (const filename of filenames.filter((f) => f.endsWith('.mdx'))) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;
    const frontmatter = parsePostFrontmatter(file.content);
    const parsed = postSchema.safeParse(frontmatter);
    if (parsed.success && parsed.data.type === 'recipe' && parsed.data.sourceMealDbId) {
      ids.add(parsed.data.sourceMealDbId);
    }
  }

  const draftSummaries = await listDrafts(client, 'post');
  for (const summary of draftSummaries) {
    const draft = await readDraft(client, 'post', summary.id);
    if (draft.kind === 'post' && draft.sourceMealDbId) {
      ids.add(draft.sourceMealDbId);
    }
  }

  return ids;
}

export async function runWeeklyVariantRecipeGeneration(client: GitHubClient): Promise<WeeklyRunResult> {
  const usedIds = await loadExistingSourceMealDbIds(client);
  const source = await pickUnusedSourceRecipe(usedIds);
  if (!source) {
    return { skipped: true };
  }

  const { variants, flaggedDiets } = await generateAllVariants(source.ingredients, source.steps);
  const narrativeBody = await generateNarrative({
    title: source.title,
    cuisine: source.cuisine,
    category: source.category,
  });

  const initial: DraftPost = {
    kind: 'post',
    postType: 'recipe',
    title: source.title,
    ingredients: source.ingredients,
    steps: source.steps,
    sections: [],
    photos: [{ url: source.thumbnail, caption: source.title }],
    kitchenwareIds: [],
    affiliateLinkIds: [],
    pendingAffiliateLinks: [],
    pendingIngredientLinks: [],
    variants,
    sourceMealDbId: source.idMeal,
    narrativeBody,
  };

  const { id } = await createDraft(client, 'post', initial);

  return {
    skipped: false,
    draftId: id,
    title: source.title,
    sourceMealDbId: source.idMeal,
    flaggedDiets,
  };
}
