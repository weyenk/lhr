import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft, writeDraft } from '../drafts.js';

export function registerAddContentStep(server: McpServer, accessToken: string): void {
  server.registerTool(
    'add_content_step',
    {
      title: 'Add content to a draft',
      description:
        'Sets the title, and/or appends one ingredient+step (for recipes) or one named section (for articles) to the draft.',
      inputSchema: {
        draftId: z.string(),
        title: z.string().optional(),
        ingredient: z.object({ item: z.string(), amount: z.string().optional() }).optional(),
        step: z.string().optional(),
        section: z.object({ heading: z.string(), body: z.string() }).optional(),
      },
    },
    async ({ draftId, title, ingredient, step, section }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      if ((ingredient !== undefined || step !== undefined) && draft.postType !== 'recipe') {
        throw new Error(`Draft ${draftId} is an article draft; ingredient/step only apply to recipes.`);
      }
      if (section !== undefined && draft.postType !== 'article') {
        throw new Error(`Draft ${draftId} is a recipe draft; section only applies to articles.`);
      }

      if (title !== undefined) draft.title = title;
      if (ingredient !== undefined) draft.ingredients = [...draft.ingredients, ingredient];
      if (step !== undefined) draft.steps = [...draft.steps, step];
      if (section !== undefined) draft.sections = [...draft.sections, section];

      await writeDraft(client, 'post', draftId, draft, `Update draft ${draftId} content`);

      return { content: [{ type: 'text' as const, text: 'Updated.' }] };
    },
  );
}
