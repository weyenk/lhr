import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
}
