import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn(), commitFilesToMain: vi.fn() }));
vi.mock('@lhr/db', () => ({
  insertProductPlacementProposal: vi.fn().mockResolvedValue(1),
  getPendingAffiliateLinkIds: vi.fn().mockResolvedValue(new Set()),
  getApprovedProposals: vi.fn().mockResolvedValue([]),
  markProposalStatus: vi.fn(),
}));

import { listFiles, getFile, commitFilesToMain } from '../src/github.js';
import { insertProductPlacementProposal, getApprovedProposals, markProposalStatus } from '@lhr/db';
import { matchProductsToRecipes, reconcileApprovedProposals } from '../src/matchProductsToRecipes';

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

  it('reconciles approved proposals (calls getApprovedProposals) before doing discovery', async () => {
    const callLlm = vi.fn().mockResolvedValue(JSON.stringify({ match: null }));
    const imageEditProvider = { compositeProductIntoPhoto: vi.fn() };

    await matchProductsToRecipes({ githubClient: {} as never, pool: {} as never, callLlm, imageEditProvider });

    expect(getApprovedProposals).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileApprovedProposals', () => {
  it('retries the commit for an approved proposal the live post does not yet reflect', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([
      {
        id: 5, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
    ]);
    vi.mocked(getFile).mockResolvedValue({ content: recipeMdx, sha: 'a' });

    await reconcileApprovedProposals({ githubClient: {} as never, pool: {} as never });

    expect(commitFilesToMain).toHaveBeenCalledWith(
      {},
      [expect.objectContaining({ path: 'src/content/posts/pizza.mdx' })],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
  });

  it('does nothing when the live post already reflects the approved proposal', async () => {
    const alreadyUpdated = recipeMdx
      .replace('https://example.com/slice.jpg', 'https://example.com/composited.jpg')
      .replace('affiliateLinkIds: []', 'affiliateLinkIds:\n  - wooden-pizza-server-1234');
    vi.mocked(getApprovedProposals).mockResolvedValue([
      {
        id: 5, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
    ]);
    vi.mocked(getFile).mockResolvedValue({ content: alreadyUpdated, sha: 'b' });

    await reconcileApprovedProposals({ githubClient: {} as never, pool: {} as never });

    expect(commitFilesToMain).not.toHaveBeenCalled();
  });

  it('isolates a getFile failure to one proposal so a later proposal in the same batch still commits', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([
      {
        id: 5, cycleId: '2026-08-25', affiliateLinkId: 'bad-product-9999', postSlug: 'gone-post',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
      {
        id: 6, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
    ]);
    vi.mocked(getFile).mockImplementation(async (_client, path: string) => {
      if (path === 'src/content/posts/gone-post.mdx') throw new Error('GitHub rate limited');
      if (path === 'src/content/posts/pizza.mdx') return { content: recipeMdx, sha: 'a' };
      return null;
    });

    await expect(
      reconcileApprovedProposals({ githubClient: {} as never, pool: {} as never }),
    ).resolves.toBeUndefined();

    expect(commitFilesToMain).toHaveBeenCalledTimes(1);
    expect(commitFilesToMain).toHaveBeenCalledWith(
      {},
      [expect.objectContaining({ path: 'src/content/posts/pizza.mdx' })],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
  });

  it('marks a proposal stale when applying the placement finds the target image has changed', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([
      {
        id: 7, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: null, // no matching line in the body -> StaleImageTargetError
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
    ]);
    vi.mocked(getFile).mockResolvedValue({ content: recipeMdx, sha: 'a' });

    await reconcileApprovedProposals({ githubClient: {} as never, pool: {} as never });

    expect(markProposalStatus).toHaveBeenCalledWith({}, 7, 'stale');
    expect(commitFilesToMain).not.toHaveBeenCalled();
  });
});
