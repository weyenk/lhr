import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createBranch, deleteBranch, getFile, listBranches, putFile, type GitHubClient } from './github.js';

export const draftPostSchema = z.object({
  kind: z.literal('post'),
  postType: z.enum(['recipe', 'article']),
  title: z.string().default(''),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).default([]),
  steps: z.array(z.string()).default([]),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
  photos: z.array(z.object({ url: z.string().url(), caption: z.string().optional() })).default([]),
  kitchenwareIds: z.array(z.string()).default([]),
  affiliateLinkIds: z.array(z.string()).default([]),
  pendingAffiliateLinks: z
    .array(z.object({ id: z.string(), label: z.string(), url: z.string().url(), tag: z.string() }))
    .default([]),
  pendingIngredientLinks: z.array(z.object({ ingredient: z.string(), affiliateLinkId: z.string() })).default([]),
});

export const draftSetSchema = z.object({
  kind: z.literal('set'),
  name: z.string().default(''),
  startDate: z.string().optional(),
  products: z
    .array(
      z.object({
        name: z.string(),
        priceCents: z.number().int().positive(),
        image: z.string().url(),
        imageAlt: z.string(),
        vendorUrl: z.string().url(),
      }),
    )
    .default([]),
});

export const draftSchema = z.discriminatedUnion('kind', [draftPostSchema, draftSetSchema]);
export type DraftPost = z.infer<typeof draftPostSchema>;
export type DraftSet = z.infer<typeof draftSetSchema>;
export type Draft = z.infer<typeof draftSchema>;

export interface DraftSummary {
  id: string;
  branch: string;
  title: string;
}

function branchName(kind: 'post' | 'set', id: string): string {
  return `draft/${kind}-${id}`;
}

function draftPath(id: string): string {
  return `.drafts/${id}.json`;
}

export function generateDraftId(): string {
  return randomBytes(4).toString('hex');
}

export async function createDraft(
  client: GitHubClient,
  kind: 'post' | 'set',
  initial: Draft,
): Promise<{ id: string; branch: string }> {
  const id = generateDraftId();
  const branch = branchName(kind, id);
  await createBranch(client, branch);
  await putFile(client, {
    path: draftPath(id),
    content: JSON.stringify(initial, null, 2),
    branch,
    message: `Start ${kind} draft ${id}`,
  });
  return { id, branch };
}

export async function readDraft(client: GitHubClient, kind: 'post' | 'set', id: string): Promise<Draft> {
  const branch = branchName(kind, id);
  const file = await getFile(client, draftPath(id), branch);
  if (!file) throw new Error(`Draft ${id} not found on branch ${branch}`);
  return draftSchema.parse(JSON.parse(file.content));
}

export async function writeDraft(
  client: GitHubClient,
  kind: 'post' | 'set',
  id: string,
  draft: Draft,
  message: string,
): Promise<void> {
  const branch = branchName(kind, id);
  const file = await getFile(client, draftPath(id), branch);
  await putFile(client, {
    path: draftPath(id),
    content: JSON.stringify(draft, null, 2),
    branch,
    message,
    sha: file?.sha,
  });
}

export async function listDrafts(client: GitHubClient, kind: 'post' | 'set'): Promise<DraftSummary[]> {
  const prefix = `draft/${kind}-`;
  const branches = await listBranches(client, prefix);
  const summaries: DraftSummary[] = [];
  for (const branch of branches) {
    const id = branch.slice(prefix.length);
    const file = await getFile(client, draftPath(id), branch);
    if (!file) continue;
    const draft = draftSchema.parse(JSON.parse(file.content));
    const title = draft.kind === 'post' ? draft.title : draft.name;
    summaries.push({ id, branch, title });
  }
  return summaries;
}

export async function deleteDraftBranch(client: GitHubClient, kind: 'post' | 'set', id: string): Promise<void> {
  await deleteBranch(client, branchName(kind, id));
}

export async function findDraftKind(client: GitHubClient, id: string): Promise<'post' | 'set' | null> {
  const postBranch = branchName('post', id);
  const postBranches = await listBranches(client, postBranch);
  if (postBranches.includes(postBranch)) return 'post';
  const setBranch = branchName('set', id);
  const setBranches = await listBranches(client, setBranch);
  if (setBranches.includes(setBranch)) return 'set';
  return null;
}

export function summarizeDraftPost(draft: DraftPost): string {
  const lines = [`Type: ${draft.postType}`, `Title: ${draft.title || '(untitled)'}`];
  if (draft.postType === 'recipe') {
    lines.push(`Ingredients: ${draft.ingredients.length}`, `Steps: ${draft.steps.length}`);
  } else {
    lines.push(`Sections: ${draft.sections.length}`);
  }
  lines.push(`Photos: ${draft.photos.length}`);
  lines.push(`Kitchenware linked: ${draft.kitchenwareIds.length}`);
  lines.push(`Affiliate links: ${draft.affiliateLinkIds.length + draft.pendingAffiliateLinks.length}`);
  lines.push(`Ingredient links to remember: ${draft.pendingIngredientLinks.length}`);
  return lines.join('\n');
}
