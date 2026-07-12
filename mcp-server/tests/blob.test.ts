import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockPut = vi.fn();
vi.mock('@vercel/blob', () => ({ put: (...args: unknown[]) => mockPut(...args) }));

const { fetchAndStorePhoto } = await import('../src/blob');

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchAndStorePhoto', () => {
  it('fetches the URL and uploads the bytes to Blob storage', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }) as unknown as typeof fetch;
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/posts/abc.jpeg' });

    const result = await fetchAndStorePhoto('https://icloud.com/share/abc');

    expect(result).toBe('https://blob.vercel-storage.com/posts/abc.jpeg');
    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^posts\/.+\.jpeg$/),
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', contentType: 'image/jpeg' }),
    );
  });

  it('rejects a non-image response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as typeof fetch;

    await expect(fetchAndStorePhoto('https://icloud.com/share/not-an-image')).rejects.toThrow(/image/);
  });

  it('rejects a failed fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(fetchAndStorePhoto('https://icloud.com/share/missing')).rejects.toThrow(/404/);
  });

  it('rejects a photo larger than the size cap', async () => {
    const bigBuffer = new ArrayBuffer(26 * 1024 * 1024);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bigBuffer,
    }) as unknown as typeof fetch;

    await expect(fetchAndStorePhoto('https://icloud.com/share/huge')).rejects.toThrow(/too large/);
  });
});
