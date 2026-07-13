import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost.js';
import { registerAddContentStep } from './addContentStep.js';
import { registerAttachPhoto } from './attachPhoto.js';
import { registerLinkKitchenware } from './linkKitchenware.js';
import { registerAddAffiliateLink } from './addAffiliateLink.js';
import { registerPreviewPost } from './previewPost.js';
import { registerConfirmAndPublish } from './confirmAndPublish.js';
import { registerStartNewSet } from './startNewSet.js';

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
