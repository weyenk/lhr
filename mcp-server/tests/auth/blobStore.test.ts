import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'test-blob-token');

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
const mockDel = vi.fn(async (pathname: string) => {
  blobStore.delete(pathname);
});
vi.mock('@vercel/blob', () => ({
  put: (...args: [string, string]) => mockPut(...args),
  list: (...args: [{ prefix: string }]) => mockList(...args),
  del: (...args: [string]) => mockDel(...args),
}));

const { deleteJson, getJson, putJson } = await import('../../src/auth/blobStore');

const originalFetch = global.fetch;

beforeEach(() => {
  blobStore.clear();
  vi.clearAllMocks();
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.headers).toEqual({ Authorization: 'Bearer test-blob-token' });
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

describe('blobStore', () => {
  it('round-trips a value through Blob storage', async () => {
    await putJson('some/path.json', { hello: 'world' });
    expect(mockPut).toHaveBeenCalledWith(
      'some/path.json',
      JSON.stringify({ hello: 'world' }),
      expect.objectContaining({ access: 'private', addRandomSuffix: false }),
    );
    const loaded = await getJson('some/path.json');
    expect(loaded).toEqual({ hello: 'world' });
  });

  it('returns null for a missing path', async () => {
    const loaded = await getJson('missing/path.json');
    expect(loaded).toBeNull();
  });

  it('removes a value so it can no longer be loaded', async () => {
    await putJson('some/path.json', { hello: 'world' });
    await deleteJson('some/path.json');
    expect(mockDel).toHaveBeenCalledWith('some/path.json');
    const loaded = await getJson('some/path.json');
    expect(loaded).toBeNull();
  });
});
