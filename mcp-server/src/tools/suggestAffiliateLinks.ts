import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft } from '../drafts.js';
import { readCollection } from '../catalog.js';
import { normalizeIngredient } from '../normalizeIngredient.js';

interface IngredientLinkData {
  ingredient: string;
  affiliateLinkId: string;
}

interface AffiliateLinkData {
  label: string;
  url: string;
  tag: string;
}

interface Match {
  ingredient: string;
  label: string;
  url: string;
}

function buildSummary(matched: Match[], unmatched: string[]): string {
  if (matched.length === 0 && unmatched.length === 0) {
    return 'No ingredients to match (only recipe drafts with ingredients are checked).';
  }

  const lines: string[] = [];
  if (matched.length > 0) {
    lines.push('Ingredient matches found:');
    for (const m of matched) lines.push(`- "${m.ingredient}" → ${m.label} (${m.url})`);
  } else {
    lines.push('No existing affiliate link matches found for these ingredients.');
  }

  if (unmatched.length > 0) {
    lines.push('', 'No existing link yet for:');
    for (const u of unmatched) lines.push(`- "${u}"`);
  }

  return lines.join('\n');
}

export function registerSuggestAffiliateLinks(server: McpServer, accessToken: string): void {
  server.registerTool(
    'suggest_affiliate_links',
    {
      title: "Suggest affiliate links for a draft's ingredients",
      description:
        'Matches a recipe draft\'s ingredients against the ingredient-links library and reports matches/unmatches for the author to confirm in chat. Never writes anything.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      if (draft.postType !== 'recipe' || draft.ingredients.length === 0) {
        return { content: [{ type: 'text' as const, text: buildSummary([], []) }] };
      }

      const ingredientLinks = await readCollection<IngredientLinkData>(client, 'src/content/ingredient-links');
      const affiliateLinks = await readCollection<AffiliateLinkData>(client, 'src/content/affiliate-links');

      const matched: Match[] = [];
      const unmatched: string[] = [];

      for (const { item } of draft.ingredients) {
        const normalized = normalizeIngredient(item);
        const linkEntry = ingredientLinks.find((e) => e.data.ingredient === normalized);
        const affiliateLink = linkEntry ? affiliateLinks.find((a) => a.id === linkEntry.data.affiliateLinkId) : undefined;
        if (linkEntry && affiliateLink) {
          matched.push({ ingredient: item, label: affiliateLink.data.label, url: affiliateLink.data.url });
        } else {
          unmatched.push(item);
        }
      }

      return { content: [{ type: 'text' as const, text: buildSummary(matched, unmatched) }] };
    },
  );
}
