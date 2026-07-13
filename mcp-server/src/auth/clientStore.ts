import { getJson, putJson } from './blobStore.js';

export interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
}

function blobPath(clientId: string): string {
  return `oauth-clients/${clientId}.json`;
}

export async function saveClient(client: RegisteredClient): Promise<void> {
  await putJson(blobPath(client.client_id), client);
}

export async function loadClient(clientId: string): Promise<RegisteredClient | null> {
  return getJson<RegisteredClient>(blobPath(clientId));
}
