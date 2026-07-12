import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient, commitFilesToMain, listFiles, type FileWrite } from '../github';
import { readDraft, findDraftKind, deleteDraftBranch, type DraftSet } from '../drafts';
import { readCollection, slugify, uniqueSlug } from '../catalog';
import { buildPostFrontmatter, renderFrontmatterYaml } from '../render';
import { postSchema, setSchema, productSchema } from '@lhr/schemas';

type GitHubClient = ReturnType<typeof createGitHubClient>;

async function publishPost(client: GitHubClient, draftId: string) {
  const draft = await readDraft(client, 'post', draftId);
  if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

  if (!draft.title.trim()) throw new Error('Draft has no title; cannot publish.');
  if (draft.postType === 'recipe' && (draft.ingredients.length === 0 || draft.steps.length === 0)) {
    throw new Error('Recipe drafts need at least one ingredient and one step before publishing.');
  }
  if (draft.postType === 'article' && draft.sections.length === 0) {
    throw new Error('Article drafts need at least one section before publishing.');
  }
  if (draft.photos.length === 0) {
    throw new Error('Draft has no cover photo; attach at least one photo before publishing.');
  }

  const frontmatter = buildPostFrontmatter(draft);
  const parsed = postSchema.safeParse(frontmatter);
  if (!parsed.success) {
    throw new Error(`Draft does not match the site's post schema: ${parsed.error.message}`);
  }

  const slug = await uniqueSlug(client, draft.title);
  const files: FileWrite[] = [
    { path: `src/content/posts/${slug}.mdx`, content: renderFrontmatterYaml(frontmatter) },
    ...draft.pendingAffiliateLinks.map((link) => ({
      path: `src/content/affiliate-links/${link.id}.json`,
      content: JSON.stringify({ label: link.label, url: link.url, tag: link.tag }, null, 2),
    })),
  ];

  await commitFilesToMain(client, files, `Publish post: ${draft.title}`);
  await deleteDraftBranch(client, 'post', draftId);

  return { content: [{ type: 'text' as const, text: `Published "${draft.title}" at /posts/${slug}/` }] };
}

interface ExistingSetData {
  name: string;
  startDate: string;
  endDate: string;
}

function dayBefore(isoDate: string): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function uniqueProductSlugs(client: GitHubClient, names: string[]): Promise<string[]> {
  const existingFiles = await listFiles(client, 'src/content/products', 'main');
  const taken = new Set(existingFiles.map((f) => f.replace(/\.json$/, '')));
  const slugs: string[] = [];
  for (const name of names) {
    const base = slugify(name);
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${n}`;
      n++;
    }
    taken.add(candidate);
    slugs.push(candidate);
  }
  return slugs;
}

async function publishSet(client: GitHubClient, draftId: string) {
  const draft = await readDraft(client, 'set', draftId);
  if (draft.kind !== 'set') throw new Error(`Draft ${draftId} is not a set draft`);

  if (!draft.name.trim() || !draft.startDate || draft.products.length === 0) {
    throw new Error('Set drafts need a name, start date, and at least one product before publishing.');
  }

  const setSlug = slugify(draft.name);
  const productSlugs = await uniqueProductSlugs(client, draft.products.map((p) => p.name));

  const newSet = { name: draft.name, startDate: draft.startDate, endDate: '9999-12-31' };
  const parsedSet = setSchema.safeParse(newSet);
  if (!parsedSet.success) {
    throw new Error(`Set does not match the site's set schema: ${parsedSet.error.message}`);
  }

  const newProducts = draft.products.map((product, i) => ({
    name: product.name,
    priceCents: product.priceCents,
    image: product.image,
    imageAlt: product.imageAlt,
    vendorUrl: product.vendorUrl,
    setId: setSlug,
  }));
  for (const product of newProducts) {
    const parsedProduct = productSchema.safeParse(product);
    if (!parsedProduct.success) {
      throw new Error(`Product "${product.name}" does not match the site's product schema: ${parsedProduct.error.message}`);
    }
  }

  const files: FileWrite[] = [
    { path: `src/content/sets/${setSlug}.json`, content: JSON.stringify(newSet, null, 2) },
    ...newProducts.map((product, i) => ({
      path: `src/content/products/${productSlugs[i]}.json`,
      content: JSON.stringify(product, null, 2),
    })),
  ];

  const existingSets = await readCollection<ExistingSetData>(client, 'src/content/sets');
  const startDate = new Date(draft.startDate);
  // The "previously active" set is the one with the most recent startDate that precedes the
  // new set's startDate. We don't gate on the prior set's endDate: in steady-state operation the
  // active set's endDate is the far-future placeholder (see the 9999-12-31 note above), so
  // comparing against it would be fragile — recency of startDate alone identifies it reliably.
  const activeSet = existingSets
    .filter((s) => new Date(s.data.startDate) < startDate)
    .sort((a, b) => new Date(b.data.startDate).getTime() - new Date(a.data.startDate).getTime())[0];
  if (activeSet) {
    files.push({
      path: `src/content/sets/${activeSet.id}.json`,
      content: JSON.stringify({ ...activeSet.data, endDate: dayBefore(draft.startDate) }, null, 2),
    });
  }

  await commitFilesToMain(client, files, `Rotate to new kitchenware set: ${draft.name}`);
  await deleteDraftBranch(client, 'set', draftId);

  return { content: [{ type: 'text' as const, text: `Published new set "${draft.name}" with ${draft.products.length} product(s).` }] };
}

export function registerConfirmAndPublish(server: McpServer, accessToken: string): void {
  server.registerTool(
    'confirm_and_publish',
    {
      title: 'Publish a confirmed draft',
      description: 'Validates, renders, and publishes a draft post or kitchenware set to the live site.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const kind = await findDraftKind(client, draftId);
      if (!kind) throw new Error(`No draft found with id ${draftId}`);
      if (kind === 'post') return publishPost(client, draftId);
      return publishSet(client, draftId);
    },
  );
}
