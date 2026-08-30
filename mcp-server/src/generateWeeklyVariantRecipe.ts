import { listFiles, getFile, createGitHubClient, type GitHubClient } from './github.js';
import { parsePostFrontmatter } from './backfillIngredientLinks.js';
import { listDrafts, readDraft } from './drafts.js';
import { getPendingCandidate, pickNewCandidate } from './recipeCandidates.js';
import { requireEnv } from './blob.js';
import { postSchema } from '@lhr/schemas';

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

// Mirrors packages/jobs/src/types.ts's JobResult contract. Defined locally, not imported from
// @lhr/jobs, because @lhr/jobs depends on this package (lhr-authoring-mcp-server) for its job
// entry points — importing back from @lhr/jobs here would be circular. The shape matches
// structurally, which is all the real `Job` type in the registry needs.
export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
}

// The Job-contract entry point named in this pipeline's spec amendment
// (2026-08-24-recipe-variant-generator-design.md) and referenced by name in the orchestrator's
// registry (packages/jobs/src/registry.ts): { name: 'recipe-variant-generator', cadenceDays: 7,
// run: generateWeeklyVariantRecipe }.
//
// This job only ever ensures a recipe *candidate* is pending — it never creates a real draft or
// spends an OpenRouter call itself. That happens in approveCandidate (recipeCandidates.ts), from
// the author clicking Approve on /status, per the 2026-08-30 "pick/approve" amendment: seeing
// (and rerolling) the pick before any AI cycles are spent on it.
export async function generateWeeklyVariantRecipe(): Promise<JobResult> {
  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));

  const existing = await getPendingCandidate(client);
  if (existing) {
    return {
      status: 'success',
      summary: `A recipe candidate ("${existing.record.source.title}") is already awaiting approval — see /status.`,
      details: { candidateId: existing.id, sourceMealDbId: existing.record.source.idMeal },
    };
  }

  const candidate = await pickNewCandidate(client);
  if (!candidate) {
    return {
      status: 'success',
      summary: 'No unused TheMealDB recipe found this week after retrying across categories; skipped.',
    };
  }

  return {
    status: 'success',
    summary: `Suggested "${candidate.record.source.title}" (idMeal ${candidate.record.source.idMeal}) — approve or reroll it on /status before variants are generated.`,
    details: { candidateId: candidate.id, sourceMealDbId: candidate.record.source.idMeal },
  };
}
