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

    // Verify the request was made correctly
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const callBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(callBody).toMatchObject({
      model: 'google/gemini-2.0-flash-exp:free',
      messages: [
        {
          role: 'user',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('Bamboo Skewers'),
            }),
          ]),
        },
      ],
    });
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

  it('returns an error when fetch throws (network failure)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: expect.stringContaining('network error') });
  });

  it('returns an error when response.json() throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: expect.stringContaining('invalid json') });
  });

  it('returns an error when storeImageBuffer throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
      }),
    }) as unknown as typeof fetch;
    vi.mocked(storeImageBuffer).mockRejectedValueOnce(new Error('storage failed'));

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: expect.stringContaining('storage failed') });
  });

  it('uses IMAGE_EDIT_MODEL env variable when set', async () => {
    process.env.IMAGE_EDIT_MODEL = 'custom/model:free';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
      }),
    }) as unknown as typeof fetch;

    await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Test Product',
    });

    const callBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(callBody.model).toBe('custom/model:free');
  });
});
