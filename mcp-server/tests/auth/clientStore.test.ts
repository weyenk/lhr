import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

const blobStore = new Map<string, string>();
const mockPut = vi.fn(async (pathname: string, body: string) => {
  blobStore.set(pathname, body);
  return { url: `https://example.private.blob.vercel-storage.com/${pathname}` };
});
const mockList = vi.fn(async ({ prefix }: { prefix: string }) => ({
  blobs: blobStore.has(prefix)
    ? [{ pathname: prefix, url: `https://example.private.blob.vercel-storage.com/${prefix}` }]
    : [],
}));
vi.mock('@vercel/blob', () => ({
  put: (...args: [string, string]) => mockPut(...args),
  list: (...args: [{ prefix: string }]) => mockList(...args),
}));

const { saveClient, loadClient } = await import('../../src/auth/clientStore');

const originalFetch = global.fetch;

beforeEach(() => {
  blobStore.clear();
  vi.clearAllMocks();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const pathname = url.replace('https://example.private.blob.vercel-storage.com/', '');
    const body = blobStore.get(pathname);
    return body
      ? ({ ok: true, json: async () => JSON.parse(body) } as Response)
      : ({ ok: false, status: 404 } as Response);
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('clientStore', () => {
  it('round-trips a client through Blob storage', async () => {
    await saveClient({ client_id: 'client-abc', redirect_uris: ['https://claude.ai/api/mcp/callback'] });

    expect(mockPut).toHaveBeenCalledWith(
      'oauth-clients/client-abc.json',
      expect.any(String),
      expect.objectContaining({ access: 'private', addRandomSuffix: false }),
    );

    const loaded = await loadClient('client-abc');
    expect(loaded).toEqual({ client_id: 'client-abc', redirect_uris: ['https://claude.ai/api/mcp/callback'] });
  });

  it('returns null for an unregistered client', async () => {
    const loaded = await loadClient('does-not-exist');
    expect(loaded).toBeNull();
  });
});
