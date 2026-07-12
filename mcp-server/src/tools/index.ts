import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
}
