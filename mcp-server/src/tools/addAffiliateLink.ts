import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft, writeDraft } from '../drafts.js';
import { readCollection } from '../catalog.js';
import { normalizeIngredient } from '../normalizeIngredient.js';

interface AffiliateLinkData {
  label: string;
  url: string;
  tag: string;
}

interface IngredientLinkData {
  ingredient: string;
  affiliateLinkId: string;
}

export function registerAddAffiliateLink(server: McpServer, accessToken: string): void {
  server.registerTool(
    'add_affiliate_link',
    {
      title: 'Add an affiliate link to a draft',
      description:
        'Adds a label + URL + tag, reusing an existing catalog entry when the URL already exists. Optionally pass the ingredient it corresponds to, so future recipes with the same ingredient match it automatically.',
      inputSchema: {
        draftId: z.string(),
        label: z.string(),
        url: z.string().url(),
        tag: z.string(),
        ingredient: z.string().optional(),
      },
    },
    async ({ draftId, label, url, tag, ingredient }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const existing = await readCollection<AffiliateLinkData>(client, 'src/content/affiliate-links');
      const match = existing.find((entry) => entry.data.url === url);

      let resolvedAffiliateLinkId: string;
      let baseMessage: string;
      if (match) {
        draft.affiliateLinkIds = Array.from(new Set([...draft.affiliateLinkIds, match.id]));
        resolvedAffiliateLinkId = match.id;
        baseMessage = `Reused existing affiliate link "${match.data.label}".`;
      } else {
        const id = `${tag}-${randomBytes(2).toString('hex')}`;
        draft.pendingAffiliateLinks = [...draft.pendingAffiliateLinks, { id, label, url, tag }];
        resolvedAffiliateLinkId = id;
        baseMessage = `Added new affiliate link "${label}" (created on publish).`;
      }

      let ingredientMessage = '';
      if (ingredient) {
        const normalized = normalizeIngredient(ingredient);
        const existingLinks = await readCollection<IngredientLinkData>(client, 'src/content/ingredient-links');
        const existingEntry = existingLinks.find((e) => e.data.ingredient === normalized);

        if (existingEntry && existingEntry.data.affiliateLinkId !== resolvedAffiliateLinkId) {
          ingredientMessage = ` Note: "${normalized}" is already linked to a different affiliate link (${existingEntry.data.affiliateLinkId}); not overwriting.`;
        } else if (!existingEntry) {
          const alreadyPending = draft.pendingIngredientLinks.some((p) => p.ingredient === normalized);
          if (!alreadyPending) {
            draft.pendingIngredientLinks = [
              ...draft.pendingIngredientLinks,
              { ingredient: normalized, affiliateLinkId: resolvedAffiliateLinkId },
            ];
          }
          ingredientMessage = ` Will remember "${normalized}" → this link for future recipes.`;
        }
      }

      await writeDraft(client, 'post', draftId, draft, `Update affiliate links on draft ${draftId}`);
      return { content: [{ type: 'text' as const, text: baseMessage + ingredientMessage }] };
    },
  );
}
