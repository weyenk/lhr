import { kv } from '@vercel/kv';

export interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
}

export async function saveClient(client: RegisteredClient): Promise<void> {
  await kv.set(`oauth:client:${client.client_id}`, client);
}

export async function loadClient(clientId: string): Promise<RegisteredClient | null> {
  const client = await kv.get<RegisteredClient>(`oauth:client:${clientId}`);
  return client ?? null;
}
