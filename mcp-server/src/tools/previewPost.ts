import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft, summarizeDraftPost } from '../drafts.js';

export function registerPreviewPost(server: McpServer, accessToken: string): void {
  server.registerTool(
    'preview_post',
    {
      title: 'Preview a draft post',
      description: 'Renders a summary of the draft for review before publishing.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);
      return { content: [{ type: 'text' as const, text: summarizeDraftPost(draft) }] };
    },
  );
}
