import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';
import { registerLinkKitchenware } from './linkKitchenware';
import { registerAddAffiliateLink } from './addAffiliateLink';
import { registerPreviewPost } from './previewPost';
import { registerConfirmAndPublish } from './confirmAndPublish';
import { registerStartNewSet } from './startNewSet';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
  registerAddAffiliateLink(server, accessToken);
  registerPreviewPost(server, accessToken);
  registerConfirmAndPublish(server, accessToken);
  registerStartNewSet(server, accessToken);
}
