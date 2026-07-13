import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft, writeDraft } from '../drafts.js';
import { readCollection } from '../catalog.js';

interface AffiliateLinkData {
  label: string;
  url: string;
  tag: string;
}

export function registerAddAffiliateLink(server: McpServer, accessToken: string): void {
  server.registerTool(
    'add_affiliate_link',
    {
      title: 'Add an affiliate link to a draft',
      description: 'Adds a label + URL + tag, reusing an existing catalog entry when the URL already exists.',
      inputSchema: {
        draftId: z.string(),
        label: z.string(),
        url: z.string().url(),
        tag: z.string(),
      },
    },
    async ({ draftId, label, url, tag }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const existing = await readCollection<AffiliateLinkData>(client, 'src/content/affiliate-links');
      const match = existing.find((entry) => entry.data.url === url);

      if (match) {
        draft.affiliateLinkIds = Array.from(new Set([...draft.affiliateLinkIds, match.id]));
        await writeDraft(client, 'post', draftId, draft, `Link existing affiliate link ${match.id} to draft ${draftId}`);
        return { content: [{ type: 'text' as const, text: `Reused existing affiliate link "${match.data.label}".` }] };
      }

      const id = `${tag}-${randomBytes(2).toString('hex')}`;
      draft.pendingAffiliateLinks = [...draft.pendingAffiliateLinks, { id, label, url, tag }];
      await writeDraft(client, 'post', draftId, draft, `Add pending affiliate link ${id} to draft ${draftId}`);
      return { content: [{ type: 'text' as const, text: `Added new affiliate link "${label}" (created on publish).` }] };
    },
  );
}
