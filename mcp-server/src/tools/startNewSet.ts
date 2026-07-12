import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { createDraft, type DraftSet } from '../drafts';

export function registerStartNewSet(server: McpServer, accessToken: string): void {
  server.registerTool(
    'start_new_set',
    {
      title: 'Start a new kitchenware set',
      description: 'Starts a draft for rotating to a new kitchenware set, with its product lineup.',
      inputSchema: {
        name: z.string(),
        startDate: z.string().describe('ISO date, e.g. 2027-01-01'),
        products: z.array(
          z.object({
            name: z.string(),
            priceCents: z.number().int().positive(),
            image: z.string().url(),
            imageAlt: z.string(),
            vendorUrl: z.string().url(),
          }),
        ),
      },
    },
    async ({ name, startDate, products }) => {
      const client = createGitHubClient(accessToken);
      const initial: DraftSet = { kind: 'set', name, startDate, products };
      const { id } = await createDraft(client, 'set', initial);
      return {
        content: [
          { type: 'text' as const, text: `Started a new set draft "${name}" with ${products.length} product(s). Draft id: ${id}.` },
        ],
      };
    },
  );
}
