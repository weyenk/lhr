import { describe, expect, it, afterEach } from 'vitest';
import { getImageEditProvider, type ImageEditProvider } from '../../src/imageEdit/index';
import { openrouterFreeProvider } from '../../src/imageEdit/openrouterFreeProvider';

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getImageEditProvider', () => {
  it('defaults to the OpenRouter free provider', () => {
    delete process.env.IMAGE_EDIT_PROVIDER;
    expect(getImageEditProvider()).toBe(openrouterFreeProvider);
  });

  it('throws a clear error for an unknown provider key', () => {
    process.env.IMAGE_EDIT_PROVIDER = 'not-a-real-provider';
    expect(() => getImageEditProvider()).toThrow(/Unknown IMAGE_EDIT_PROVIDER/);
  });
});

describe('ImageEditProvider interface swap', () => {
  it('a fake provider satisfying the interface works with the same calling code as the real one', async () => {
    async function callProvider(provider: ImageEditProvider) {
      return provider.compositeProductIntoPhoto({
        sourceImageUrl: 'https://example.com/source.jpg',
        productImageUrl: 'https://example.com/product.jpg',
        productName: 'Test Product',
      });
    }

    const fakeProvider: ImageEditProvider = {
      async compositeProductIntoPhoto() {
        return { resultImageUrl: 'https://example.com/fake-result.jpg' };
      },
    };

    const result = await callProvider(fakeProvider);
    expect(result).toEqual({ resultImageUrl: 'https://example.com/fake-result.jpg' });
  });
});
