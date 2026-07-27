import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

const { fetchAndStorePhoto, storeImageBuffer } = await import('../src/blob');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
  mockSend.mockResolvedValue({});
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('storeImageBuffer', () => {
  it('uploads the buffer to R2 and returns the public URL', async () => {
    const result = await storeImageBuffer(Buffer.from([1, 2, 3, 4]), 'image/png');

    expect(result).toMatch(/^https:\/\/cdn\.example\.com\/posts\/.+\.png$/);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: expect.stringMatching(/^posts\/.+\.png$/),
          Body: expect.any(Buffer),
          ContentType: 'image/png',
        }),
      }),
    );
  });

  it('rejects a non-image content type', async () => {
    await expect(storeImageBuffer(Buffer.from([1]), 'text/html')).rejects.toThrow(/image/);
  });

  it('rejects a buffer larger than the size cap', async () => {
    const big = Buffer.alloc(26 * 1024 * 1024);
    await expect(storeImageBuffer(big, 'image/jpeg')).rejects.toThrow(/too large/);
  });
});

describe('fetchAndStorePhoto', () => {
  it('fetches the URL and uploads the bytes to R2', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }) as unknown as typeof fetch;

    const result = await fetchAndStorePhoto('https://icloud.com/share/abc');

    expect(global.fetch).toHaveBeenCalledWith('https://icloud.com/share/abc');
    expect(result).toMatch(/^https:\/\/cdn\.example\.com\/posts\/.+\.jpeg$/);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: expect.stringMatching(/^posts\/.+\.jpeg$/),
          Body: expect.any(Buffer),
          ContentType: 'image/jpeg',
        }),
      }),
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
