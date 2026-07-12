import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { createDraft, listDrafts, type DraftPost } from '../drafts';

export function registerStartPost(server: McpServer, accessToken: string): void {
  server.registerTool(
    'start_post',
    {
      title: 'Start or resume a post',
      description: 'Lists any unfinished draft posts of the given type and offers to resume one, or starts a new draft.',
      inputSchema: {
        type: z.enum(['recipe', 'article']).describe('Which kind of post to start'),
      },
    },
    async ({ type }: { type: 'recipe' | 'article' }) => {
      const client = createGitHubClient(accessToken);
      const openDrafts = await listDrafts(client, 'post');

      if (openDrafts.length > 0) {
        const list = openDrafts.map((d) => `- ${d.id}: "${d.title || '(untitled)'}"`).join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `You have unfinished drafts:\n${list}\n\nTell me the id of the one to resume, or say "start new" to begin a new ${type} draft.`,
            },
          ],
        };
      }

      const initial: DraftPost = {
        kind: 'post',
        postType: type,
        title: '',
        ingredients: [],
        steps: [],
        sections: [],
        photos: [],
        kitchenwareIds: [],
        affiliateLinkIds: [],
        pendingAffiliateLinks: [],
      };
      const { id } = await createDraft(client, 'post', initial);
      return {
        content: [{ type: 'text' as const, text: `Started a new ${type} draft. Draft id: ${id}. What's the title?` }],
      };
    },
  );
}
