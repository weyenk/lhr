import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft } from '../drafts.js';
import { signUploadLink } from '../uploadLink.js';
import { requireEnv } from '../blob.js';

export function registerGetPhotoUploadLink(server: McpServer, accessToken: string): void {
  server.registerTool(
    'get_photo_upload_link',
    {
      title: 'Get a mobile photo upload link',
      description:
        'Generates a one-hour signed link to a mobile-friendly page for uploading photos directly from a phone camera roll, attaching them to the draft. Use this instead of attach_photo when the author wants to add a photo from their phone rather than an already-hosted URL.',
      inputSchema: {
        draftId: z.string(),
      },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const { token, expiresAt } = signUploadLink(draftId);
      const baseUrl = requireEnv('MCP_SERVER_URL').replace(/\/$/, '');
      const url = `${baseUrl}/upload/${draftId}?exp=${expiresAt}&token=${token}`;

      return {
        content: [
          {
            type: 'text' as const,
            text: `Open this link on your phone to upload photos (expires in 1 hour): ${url}`,
          },
        ],
      };
    },
  );
}
