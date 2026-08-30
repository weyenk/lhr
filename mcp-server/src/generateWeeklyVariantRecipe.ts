import { listFiles, getFile, createGitHubClient, type GitHubClient } from './github.js';
import { parsePostFrontmatter } from './backfillIngredientLinks.js';
import { createDraft, listDrafts, readDraft, type DraftPost } from './drafts.js';
import { pickUnusedSourceRecipe } from './themealdb.js';
import { generateAllVariants } from './dietSubstitutions.js';
import { generateNarrative } from './narrative.js';
import { requireEnv } from './blob.js';
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

// Mirrors packages/jobs/src/types.ts's JobResult contract (spec
// 2026-08-25-local-orchestrator-design.md §2). Defined locally — not
// imported from @lhr/jobs — because that package doesn't exist in this
// worktree yet; the shape matches exactly, so it satisfies the real `Job`
// type structurally once the orchestrator sub-project wires this in.
export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
}

export function runResultToJobResult(result: WeeklyRunResult): JobResult {
  if (result.skipped) {
    return {
      status: 'success',
      summary: 'No unused TheMealDB recipe found this week after retrying across categories; skipped.',
    };
  }

  const flaggedDiets = result.flaggedDiets ?? [];
  const summary =
    flaggedDiets.length > 0
      ? `Created draft "${result.title}" (idMeal ${result.sourceMealDbId}); ${flaggedDiets.length} diet(s) need a manual pass: ${flaggedDiets.join(', ')}.`
      : `Created draft "${result.title}" (idMeal ${result.sourceMealDbId}); all 7 diet variants generated cleanly.`;

  return {
    status: flaggedDiets.length > 0 ? 'partial' : 'success',
    summary,
    details: {
      draftId: result.draftId,
      sourceMealDbId: result.sourceMealDbId,
      flaggedDiets,
    },
  };
}

// The Job-contract entry point named in this pipeline's spec amendment
// (2026-08-24-recipe-variant-generator-design.md) and referenced by name in
// the orchestrator's registry example (§2 of the local-orchestrator spec):
// `{ name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe }`.
// Validates both required env vars eagerly (GITHUB_TOKEN here, OPENROUTER_API_KEY
// via requireEnv so a missing key fails fast rather than only surfacing once
// every diet/narrative call individually falls back).
export async function generateWeeklyVariantRecipe(): Promise<JobResult> {
  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  requireEnv('OPENROUTER_API_KEY');

  const result = await runWeeklyVariantRecipeGeneration(client);
  return runResultToJobResult(result);
}
