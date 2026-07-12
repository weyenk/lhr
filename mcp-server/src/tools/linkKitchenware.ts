import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { readDraft, writeDraft } from '../drafts';
import { readCollection } from '../catalog';

interface ProductData {
  name: string;
  priceCents: number;
  setId: string;
}
interface SetData {
  name: string;
  startDate: string;
  endDate: string;
}

export function registerLinkKitchenware(server: McpServer, accessToken: string): void {
  server.registerTool(
    'link_kitchenware',
    {
      title: 'Link kitchenware to a draft',
      description: "Suggests the currently-active kitchenware set's products, or links the given product ids to the draft.",
      inputSchema: {
        draftId: z.string(),
        productIds: z.array(z.string()).optional(),
      },
    },
    async ({ draftId, productIds }) => {
      const client = createGitHubClient(accessToken);

      if (!productIds) {
        const sets = await readCollection<SetData>(client, 'src/content/sets');
        const products = await readCollection<ProductData>(client, 'src/content/products');
        const now = new Date();
        const activeSet = sets.find((s) => new Date(s.data.startDate) <= now && now <= new Date(s.data.endDate));
        const activeProducts = activeSet ? products.filter((p) => p.data.setId === activeSet.id) : [];
        const list = activeProducts.map((p) => `- ${p.id}: ${p.data.name}`).join('\n') || '(no active set configured)';
        return {
          content: [
            { type: 'text' as const, text: `Active set products:\n${list}\n\nCall again with productIds to link some.` },
          ],
        };
      }

      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);
      draft.kitchenwareIds = Array.from(new Set([...draft.kitchenwareIds, ...productIds]));
      await writeDraft(client, 'post', draftId, draft, `Link kitchenware to draft ${draftId}`);
      return { content: [{ type: 'text' as const, text: `Linked ${productIds.length} product(s) to the draft.` }] };
    },
  );
}
