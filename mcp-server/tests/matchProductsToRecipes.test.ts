import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn() }));
vi.mock('@lhr/db', () => ({
  insertProductPlacementProposal: vi.fn().mockResolvedValue(1),
  getPendingAffiliateLinkIds: vi.fn().mockResolvedValue(new Set()),
}));

import { listFiles, getFile } from '../src/github.js';
import { insertProductPlacementProposal } from '@lhr/db';
import { matchProductsToRecipes } from '../src/matchProductsToRecipes';

const recipeMdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
ingredients:
  - item: "Mozzarella"
affiliateLinkIds: []
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "A whole deep dish pizza"
---

Body text.

![Slicing the pizza](https://example.com/slice.jpg)
`;

const affiliateLinkJson = JSON.stringify({
  label: 'Wooden Pizza Server',
  url: 'https://amazon.com/x',
  tag: 'x',
  image: 'https://example.com/product.jpg',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFiles).mockImplementation(async (_client, dirPath: string) => {
    if (dirPath === 'src/content/posts') return ['pizza.mdx'];
    if (dirPath === 'src/content/affiliate-links') return ['wooden-pizza-server-1234.json'];
    return [];
  });
  vi.mocked(getFile).mockImplementation(async (_client, path: string) => {
    if (path === 'src/content/posts/pizza.mdx') return { content: recipeMdx, sha: 'a' };
    if (path === 'src/content/affiliate-links/wooden-pizza-server-1234.json') {
      return { content: affiliateLinkJson, sha: 'b' };
    }
    return null;
  });
});

describe('matchProductsToRecipes', () => {
  it('creates a pending proposal with the composited image when the LLM finds a good match and the image edit succeeds', async () => {
    const callLlm = vi.fn().mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    const imageEditProvider = {
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ resultImageUrl: 'https://example.com/composited.jpg' }),
    };

    const result = await matchProductsToRecipes({
      githubClient: {} as never,
      pool: {} as never,
      callLlm,
      imageEditProvider,
    });

    expect(result.proposalsCreated).toBe(1);
    expect(imageEditProvider.compositeProductIntoPhoto).toHaveBeenCalledWith({
      sourceImageUrl: 'https://example.com/slice.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Wooden Pizza Server',
    });
    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        affiliateLinkId: 'wooden-pizza-server-1234',
        postSlug: 'pizza',
        targetImageKind: 'body',
        targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'pending',
      }),
    );
  });

  it('creates no proposal when the LLM finds no good match', async () => {
    const callLlm = vi.fn().mockResolvedValue(JSON.stringify({ match: null }));
    const imageEditProvider = { compositeProductIntoPhoto: vi.fn() };

    const result = await matchProductsToRecipes({ githubClient: {} as never, pool: {} as never, callLlm, imageEditProvider });

    expect(result.proposalsCreated).toBe(0);
    expect(imageEditProvider.compositeProductIntoPhoto).not.toHaveBeenCalled();
    expect(insertProductPlacementProposal).not.toHaveBeenCalled();
  });

  it('creates an edit_failed proposal when the match succeeds but the image edit fails', async () => {
    const callLlm = vi.fn().mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    const imageEditProvider = {
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ error: 'model unavailable' }),
    };

    await matchProductsToRecipes({ githubClient: {} as never, pool: {} as never, callLlm, imageEditProvider });

    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'edit_failed', compositedImageUrl: null }),
    );
  });

  it('creates an edit_failed proposal without calling the image-edit provider when the candidate has no product image', async () => {
    const affiliateLinkNoImageJson = JSON.stringify({
      label: 'Wooden Pizza Server',
      url: 'https://amazon.com/x',
      tag: 'x',
    });
    vi.mocked(getFile).mockImplementation(async (_client, path: string) => {
      if (path === 'src/content/posts/pizza.mdx') return { content: recipeMdx, sha: 'a' };
      if (path === 'src/content/affiliate-links/wooden-pizza-server-1234.json') {
        return { content: affiliateLinkNoImageJson, sha: 'b' };
      }
      return null;
    });

    const callLlm = vi.fn().mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    const imageEditProvider = { compositeProductIntoPhoto: vi.fn() };

    const result = await matchProductsToRecipes({
      githubClient: {} as never,
      pool: {} as never,
      callLlm,
      imageEditProvider,
    });

    expect(imageEditProvider.compositeProductIntoPhoto).not.toHaveBeenCalled();
    expect(result.proposalsCreated).toBe(1);
    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'edit_failed', compositedImageUrl: null }),
    );
  });

  it("continues processing remaining candidates when one candidate's LLM call rejects", async () => {
    const badProductJson = JSON.stringify({
      label: 'Bad Product',
      url: 'https://amazon.com/bad',
      tag: 'bad',
      image: 'https://example.com/bad-product.jpg',
    });

    vi.mocked(listFiles).mockImplementation(async (_client, dirPath: string) => {
      if (dirPath === 'src/content/posts') return ['pizza.mdx'];
      if (dirPath === 'src/content/affiliate-links') {
        return ['bad-product-9999.json', 'wooden-pizza-server-1234.json'];
      }
      return [];
    });
    vi.mocked(getFile).mockImplementation(async (_client, path: string) => {
      if (path === 'src/content/posts/pizza.mdx') return { content: recipeMdx, sha: 'a' };
      if (path === 'src/content/affiliate-links/bad-product-9999.json') {
        return { content: badProductJson, sha: 'c' };
      }
      if (path === 'src/content/affiliate-links/wooden-pizza-server-1234.json') {
        return { content: affiliateLinkJson, sha: 'b' };
      }
      return null;
    });

    const callLlm = vi
      .fn()
      .mockRejectedValueOnce(new Error('LLM unavailable'))
      .mockResolvedValueOnce(
        JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
      );
    const imageEditProvider = {
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ resultImageUrl: 'https://example.com/composited.jpg' }),
    };

    const result = await matchProductsToRecipes({
      githubClient: {} as never,
      pool: {} as never,
      callLlm,
      imageEditProvider,
    });

    expect(callLlm).toHaveBeenCalledTimes(2);
    expect(result.proposalsCreated).toBe(1);
    expect(insertProductPlacementProposal).toHaveBeenCalledTimes(1);
    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ affiliateLinkId: 'wooden-pizza-server-1234', status: 'pending' }),
    );
  });
});
