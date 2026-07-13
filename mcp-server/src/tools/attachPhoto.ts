import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft, writeDraft } from '../drafts.js';
import { fetchAndStorePhoto } from '../blob.js';

export function registerAttachPhoto(server: McpServer, accessToken: string): void {
  server.registerTool(
    'attach_photo',
    {
      title: 'Attach a photo to a draft',
      description:
        'Fetches a shared photo URL (e.g. an iCloud link) server-side and stores it permanently, attaching it to the draft.',
      inputSchema: {
        draftId: z.string(),
        photoUrl: z.string().url(),
        caption: z.string().optional(),
      },
    },
    async ({ draftId, photoUrl, caption }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const blobUrl = await fetchAndStorePhoto(photoUrl);

      draft.photos = [...draft.photos, { url: blobUrl, caption }];
      await writeDraft(client, 'post', draftId, draft, `Attach photo to draft ${draftId}`);

      return { content: [{ type: 'text' as const, text: `Photo added (${draft.photos.length} total).` }] };
    },
  );
}
