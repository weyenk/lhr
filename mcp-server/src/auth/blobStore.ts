import { del, list, put } from '@vercel/blob';

export async function putJson<T>(path: string, value: T): Promise<void> {
  await put(path, JSON.stringify(value), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export async function getJson<T>(path: string): Promise<T | null> {
  const { blobs } = await list({ prefix: path });
  const match = blobs.find((blob) => blob.pathname === path);
  if (!match) {
    return null;
  }
  const response = await fetch(match.url);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

export async function deleteJson(path: string): Promise<void> {
  await del(path);
}
