import { getFile, type GitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';

export async function loadAgentPersona(client: GitHubClient, relativePath: string): Promise<string> {
  const file = await getFile(client, relativePath, 'main');
  const body = file?.content?.trim();
  if (!body) {
    throw new Error(`Missing ${relativePath} for product-sourcing LLM persona`);
  }
  return body;
}
