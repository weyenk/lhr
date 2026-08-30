import { createGitHubClient, type GitHubClient } from './github.js';
import { listDrafts, readDraft, writeDraft, MANUAL_PASS_SENTINEL, type DraftPost } from './drafts.js';
import { ALL_SUBSTITUTABLE_DIETS, generateVariant, type RecipeVariantResult, type SubstitutableDiet } from './dietSubstitutions.js';
import { requireEnv } from './blob.js';
import type { RecipeVariantData } from '@lhr/schemas';
import type { JobResult } from './generateWeeklyVariantRecipe.js';

// Mirrors dietSubstitutions.ts's own per-run budget: this job attempts every currently-pending
// diet in one invocation, so it gets the same headroom under Vercel's 300s cap.
const DIET_PIPELINE_BUDGET_MS = 180_000;

// A diet needs (re)work if it has no variant yet, or its variant was previously flagged as
// unresolved — both cases get retried the same way, since generateVariant doesn't distinguish
// "never attempted" from "attempted and gave up last time."
export function pendingDiets(variants: RecipeVariantData[]): SubstitutableDiet[] {
  const byDiet = new Map(variants.map((v) => [v.diet, v]));
  return ALL_SUBSTITUTABLE_DIETS.filter((diet) => {
    const existing = byDiet.get(diet);
    return !existing || existing.notes === MANUAL_PASS_SENTINEL;
  });
}

export interface IncompleteRecipeDraft {
  id: string;
  draft: DraftPost;
}

// Finds the first open recipe draft (in listDrafts order) that still has a pending diet — i.e.
// one the recipe-variant-generator job picked but hasn't been fully filled in yet, whether that's
// because it's brand new or because a previous finisher tick left some diets flagged.
export async function findIncompleteRecipeDraft(client: GitHubClient): Promise<IncompleteRecipeDraft | null> {
  const summaries = await listDrafts(client, 'post');
  for (const summary of summaries) {
    const draft = await readDraft(client, 'post', summary.id);
    if (draft.kind !== 'post' || draft.postType !== 'recipe') continue;
    if (pendingDiets(draft.variants).length > 0) {
      return { id: summary.id, draft };
    }
  }
  return null;
}

function applyResults(existing: RecipeVariantData[], results: RecipeVariantResult[]): RecipeVariantData[] {
  const byDiet = new Map(existing.map((v) => [v.diet, v]));
  for (const { rejected: _rejected, ...variant } of results) {
    byDiet.set(variant.diet, variant);
  }
  const original = byDiet.get('original');
  if (!original) throw new Error('applyResults: draft is missing its "original" variant');
  const rest = ALL_SUBSTITUTABLE_DIETS.filter((diet) => byDiet.has(diet)).map((diet) => byDiet.get(diet)!);
  return [original, ...rest];
}

// The Job-contract entry point for the daily companion to recipe-variant-generator (see the
// 2026-08-30 amendment in docs/superpowers/specs/active/2026-08-24-recipe-variant-generator-design.md):
// { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants }. Splitting
// the pick from the (expensive) variant generation means a picked recipe is visible on /status
// before any AI cycles are spent on it, and an incomplete draft gets retried daily instead of
// being abandoned once its picker run clears the weekly cadence.
export async function finishPendingRecipeVariants(): Promise<JobResult> {
  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  requireEnv('OPENROUTER_API_KEY');

  const found = await findIncompleteRecipeDraft(client);
  if (!found) {
    return { status: 'success', summary: 'No incomplete recipe drafts to work on.' };
  }

  const { id, draft } = found;
  const diets = pendingDiets(draft.variants);
  const deadline = Date.now() + DIET_PIPELINE_BUDGET_MS;

  const results: RecipeVariantResult[] = [];
  for (const diet of diets) {
    results.push(await generateVariant(diet, draft.ingredients, draft.steps, deadline));
  }

  const variants = applyResults(draft.variants, results);
  await writeDraft(client, 'post', id, { ...draft, variants }, `Fill in diet variants for draft ${id}`);

  const stillFlagged = results.filter((r) => r.rejected).map((r) => r.diet);
  const resolvedCount = diets.length - stillFlagged.length;

  return {
    status: stillFlagged.length > 0 ? 'partial' : 'success',
    summary:
      stillFlagged.length > 0
        ? `Filled in ${resolvedCount}/${diets.length} pending diet(s) for "${draft.title}"; still needs a manual pass: ${stillFlagged.join(', ')}.`
        : `Finished all diet variants for "${draft.title}".`,
    details: { draftId: id, resolvedCount, stillFlagged },
  };
}
