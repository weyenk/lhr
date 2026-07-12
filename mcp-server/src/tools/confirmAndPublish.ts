import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient, commitFilesToMain, type FileWrite } from '../github';
import { readDraft, findDraftKind, deleteDraftBranch, type DraftPost } from '../drafts';
import { uniqueSlug } from '../catalog';
import { renderPostMdx } from '../render';

async function publishPost(client: ReturnType<typeof createGitHubClient>, draftId: string) {
  const draft = await readDraft(client, 'post', draftId);
  if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

  if (!draft.title.trim()) throw new Error('Draft has no title; cannot publish.');
  if (draft.postType === 'recipe' && (draft.ingredients.length === 0 || draft.steps.length === 0)) {
    throw new Error('Recipe drafts need at least one ingredient and one step before publishing.');
  }
  if (draft.postType === 'article' && draft.sections.length === 0) {
    throw new Error('Article drafts need at least one section before publishing.');
  }

  const slug = await uniqueSlug(client, draft.title);
  const files: FileWrite[] = [
    { path: `src/content/posts/${slug}.mdx`, content: renderPostMdx(draft) },
    ...draft.pendingAffiliateLinks.map((link) => ({
      path: `src/content/affiliate-links/${link.id}.json`,
      content: JSON.stringify({ label: link.label, url: link.url, tag: link.tag }, null, 2),
    })),
  ];

  await commitFilesToMain(client, files, `Publish post: ${draft.title}`);
  await deleteDraftBranch(client, 'post', draftId);

  return { content: [{ type: 'text' as const, text: `Published "${draft.title}" at /posts/${slug}/` }] };
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
      throw new Error(`Draft ${draftId} is a kitchenware set draft; set publishing isn't wired up yet`);
    },
  );
}
