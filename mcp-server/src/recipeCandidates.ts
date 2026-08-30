import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createBranch, deleteBranch, getFile, listBranches, putFile, type GitHubClient } from './github.js';
import { pickUnusedSourceRecipe } from './themealdb.js';
import { generateNarrative } from './narrative.js';
import { createDraft, type DraftPost } from './drafts.js';
import { loadExistingSourceMealDbIds } from './generateWeeklyVariantRecipe.js';

const candidateSchema = z.object({
  status: z.enum(['pending', 'rerolled']),
  source: z.object({
    idMeal: z.string(),
    title: z.string(),
    cuisine: z.string(),
    category: z.string(),
    thumbnail: z.string(),
    ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })),
    steps: z.array(z.string()),
  }),
});

export type CandidateRecord = z.infer<typeof candidateSchema>;

export interface CandidateSummary {
  id: string;
  record: CandidateRecord;
}

const BRANCH_PREFIX = 'candidate/';

function branchName(id: string): string {
  return `${BRANCH_PREFIX}${id}`;
}

function candidatePath(id: string): string {
  return `.candidates/${id}.json`;
}

async function readCandidate(client: GitHubClient, id: string): Promise<CandidateRecord | null> {
  const file = await getFile(client, candidatePath(id), branchName(id));
  return file ? candidateSchema.parse(JSON.parse(file.content)) : null;
}

async function listCandidates(client: GitHubClient): Promise<CandidateSummary[]> {
  const branches = await listBranches(client, BRANCH_PREFIX);
  const summaries: CandidateSummary[] = [];
  for (const branch of branches) {
    const id = branch.slice(BRANCH_PREFIX.length);
    const record = await readCandidate(client, id);
    if (record) summaries.push({ id, record });
  }
  return summaries;
}

// Every candidate branch — pending or rerolled — permanently reserves its recipe's idMeal so a
// rejected suggestion is never re-suggested and a pending one isn't duplicated by a concurrent
// pick. Combined with loadExistingSourceMealDbIds' posts+drafts check, this covers every place a
// recipe could already "belong to" this week.
async function loadCandidateSourceMealDbIds(client: GitHubClient): Promise<Set<string>> {
  const candidates = await listCandidates(client);
  return new Set(candidates.map((c) => c.record.source.idMeal));
}

export async function getPendingCandidate(client: GitHubClient): Promise<CandidateSummary | null> {
  const candidates = await listCandidates(client);
  return candidates.find((c) => c.record.status === 'pending') ?? null;
}

export async function pickNewCandidate(client: GitHubClient): Promise<CandidateSummary | null> {
  const usedIds = await loadExistingSourceMealDbIds(client);
  const candidateIds = await loadCandidateSourceMealDbIds(client);
  const excluded = new Set([...usedIds, ...candidateIds]);

  const source = await pickUnusedSourceRecipe(excluded);
  if (!source) return null;

  const id = randomBytes(4).toString('hex');
  const record: CandidateRecord = { status: 'pending', source };
  await createBranch(client, branchName(id));
  await putFile(client, {
    path: candidatePath(id),
    content: JSON.stringify(record, null, 2),
    branch: branchName(id),
    message: `Suggest recipe candidate ${id}: ${source.title}`,
  });
  return { id, record };
}

// Keeps the rerolled candidate's branch around (status flips to 'rerolled' rather than being
// deleted) so its idMeal stays permanently excluded via loadCandidateSourceMealDbIds — a rejected
// suggestion should never come back. Immediately picks a replacement so the UI has something
// fresh to show without waiting for the picker job's next cadence tick.
export async function rerollCandidate(client: GitHubClient, id: string): Promise<CandidateSummary | null> {
  const branch = branchName(id);
  const file = await getFile(client, candidatePath(id), branch);
  if (!file) throw new Error(`Candidate ${id} not found`);
  const record = candidateSchema.parse(JSON.parse(file.content));

  await putFile(client, {
    path: candidatePath(id),
    content: JSON.stringify({ ...record, status: 'rerolled' }, null, 2),
    branch,
    message: `Reroll candidate ${id}`,
    sha: file.sha,
  });

  return pickNewCandidate(client);
}

export interface ApprovedCandidate {
  draftId: string;
  title: string;
  sourceMealDbId: string;
}

// Only now — once a human has approved the suggestion — is any AI cycle spent on it (the
// narrative call here, and later the diet variants via the recipe-variant-finisher job).
export async function approveCandidate(client: GitHubClient, id: string): Promise<ApprovedCandidate> {
  const record = await readCandidate(client, id);
  if (!record) throw new Error(`Candidate ${id} not found`);
  const { source } = record;

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
    variants: [{ diet: 'original', ingredients: source.ingredients, steps: source.steps }],
    sourceMealDbId: source.idMeal,
    narrativeBody,
  };

  const { id: draftId } = await createDraft(client, 'post', initial);
  await deleteBranch(client, branchName(id));

  return { draftId, title: source.title, sourceMealDbId: source.idMeal };
}
