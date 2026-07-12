import { list, put } from '@vercel/blob';

export interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
}

function blobPath(clientId: string): string {
  return `oauth-clients/${clientId}.json`;
}

export async function saveClient(client: RegisteredClient): Promise<void> {
  await put(blobPath(client.client_id), JSON.stringify(client), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export async function loadClient(clientId: string): Promise<RegisteredClient | null> {
  const path = blobPath(clientId);
  const { blobs } = await list({ prefix: path });
  const match = blobs.find((blob) => blob.pathname === path);
  if (!match) {
    return null;
  }
  const response = await fetch(match.url);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as RegisteredClient;
}
