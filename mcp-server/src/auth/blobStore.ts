import { del, list, put } from '@vercel/blob';

// The MCP SDK's OAuth route handlers catch any thrown error and replace it
// with a generic "Internal Server Error" before responding, so without this
// logging a blob store failure here is otherwise invisible in Vercel logs.
export async function putJson<T>(path: string, value: T): Promise<void> {
  try {
    await put(path, JSON.stringify(value), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
  } catch (err) {
    console.error(`putJson(${path}) failed:`, err);
    throw err;
  }
}

export async function getJson<T>(path: string): Promise<T | null> {
  try {
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
  } catch (err) {
    console.error(`getJson(${path}) failed:`, err);
    throw err;
  }
}

export async function deleteJson(path: string): Promise<void> {
  await del(path);
}
