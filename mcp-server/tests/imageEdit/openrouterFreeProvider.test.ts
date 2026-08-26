import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/blob.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/blob.js')>('../../src/blob.js');
  return { ...actual, storeImageBuffer: vi.fn().mockResolvedValue('https://r2.example.com/posts/stored.jpg') };
});

import { storeImageBuffer } from '../../src/blob.js';
import { openrouterFreeProvider } from '../../src/imageEdit/openrouterFreeProvider';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.IMAGE_EDIT_MODEL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('openrouterFreeProvider.compositeProductIntoPhoto', () => {
  it('decodes the returned data-URI image and stores it, returning the stored URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
      }),
    }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ resultImageUrl: 'https://r2.example.com/posts/stored.jpg' });
    expect(vi.mocked(storeImageBuffer)).toHaveBeenCalledWith(Buffer.from('aGVsbG8=', 'base64'), 'image/png');
  });

  it('returns an error when OpenRouter responds with no image', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: 'OpenRouter response had no generated image' });
  });

  it('returns an error when the OpenRouter request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: 'OpenRouter request failed: 503' });
  });
});
