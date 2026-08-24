import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), findDraftKind: vi.fn(), deleteDraftBranch: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return {
    ...actual,
    readDraft: draftsMock.readDraft,
    findDraftKind: draftsMock.findDraftKind,
    deleteDraftBranch: draftsMock.deleteDraftBranch,
  };
});

const githubMock = { commitFilesToMain: vi.fn(), listFiles: vi.fn() };
vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  commitFilesToMain: (...args: unknown[]) => githubMock.commitFilesToMain(...args),
  listFiles: (...args: unknown[]) => githubMock.listFiles(...args),
}));

const catalogMock = { uniqueSlug: vi.fn() };
const catalogMock2 = { readCollection: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return {
    ...actual,
    uniqueSlug: (...args: unknown[]) => catalogMock.uniqueSlug(...args),
    readCollection: catalogMock2.readCollection,
    // slugify is intentionally left as the real implementation (via ...actual): the set-rotation
    // test below needs distinct slugs for the set name and each product name, which a single
    // fixed mock return value can't produce.
  };
});

const { registerConfirmAndPublish } = await import('../../src/tools/confirmAndPublish');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const validRecipeDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [{ item: 'Chicken' }],
  steps: ['Grill it'],
  sections: [],
  photos: [{ url: 'https://blob.vercel-storage.com/posts/jerk-chicken.jpg', caption: 'Jerk chicken on a platter' }],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [{ id: 'sauce-ab12', label: 'Sauce', url: 'https://vendor.example.com/sauce', tag: 'sauce' }],
  pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' }],
  variants: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  githubMock.listFiles.mockResolvedValue([]);
  catalogMock2.readCollection.mockResolvedValue([]);
});

describe('confirm_and_publish (post)', () => {
  it('commits the rendered post and pending catalog entries, then deletes the draft branch', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue(validRecipeDraft);
    catalogMock.uniqueSlug.mockResolvedValue('jerk-chicken');
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    const result = (await server.call('confirm_and_publish', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/content/posts/jerk-chicken.mdx' }),
        expect.objectContaining({ path: 'src/content/affiliate-links/sauce-ab12.json' }),
        expect.objectContaining({
          path: 'src/content/ingredient-links/jerk-seasoning.json',
          content: JSON.stringify({ ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' }, null, 2),
        }),
      ]),
      expect.stringContaining('Jerk Chicken'),
    );
    expect(draftsMock.deleteDraftBranch).toHaveBeenCalledWith(expect.anything(), 'post', 'abc1');
    expect(result.content[0].text).toContain('jerk-chicken');
  });

  it('commits no ingredient-links files when none are pending', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({ ...validRecipeDraft, pendingIngredientLinks: [] });
    catalogMock.uniqueSlug.mockResolvedValue('jerk-chicken');
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await server.call('confirm_and_publish', { draftId: 'abc1' });

    const [, files] = githubMock.commitFilesToMain.mock.calls[0] as [unknown, { path: string }[]];
    expect(files.some((f) => f.path.startsWith('src/content/ingredient-links/'))).toBe(false);
  });

  it('skips a pending ingredient-link that conflicts with an existing mapping to a different affiliate link, and notes it in the response', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({
      ...validRecipeDraft,
      pendingIngredientLinks: [
        { ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' },
        { ingredient: 'garlic', affiliateLinkId: 'garlic-xy99' },
      ],
    });
    catalogMock.uniqueSlug.mockResolvedValue('jerk-chicken');
    catalogMock2.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/ingredient-links'
        ? [{ id: 'garlic', data: { ingredient: 'garlic', affiliateLinkId: 'other-garlic-link' } }]
        : [],
    );
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    const result = (await server.call('confirm_and_publish', { draftId: 'abc1' })) as { content: { text: string }[] };

    const [, files] = githubMock.commitFilesToMain.mock.calls[0] as [unknown, { path: string }[]];
    expect(files.some((f) => f.path === 'src/content/ingredient-links/garlic.json')).toBe(false);
    expect(files.some((f) => f.path === 'src/content/ingredient-links/jerk-seasoning.json')).toBe(true);
    expect(result.content[0].text).toContain('skipped');
    expect(result.content[0].text).toContain('garlic');
  });

  it('commits a pending ingredient-link that matches an existing mapping to the same affiliate link', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue(validRecipeDraft);
    catalogMock.uniqueSlug.mockResolvedValue('jerk-chicken');
    catalogMock2.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/ingredient-links'
        ? [{ id: 'jerk-seasoning', data: { ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' } }]
        : [],
    );
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    const result = (await server.call('confirm_and_publish', { draftId: 'abc1' })) as { content: { text: string }[] };

    const [, files] = githubMock.commitFilesToMain.mock.calls[0] as [unknown, { path: string }[]];
    expect(files.some((f) => f.path === 'src/content/ingredient-links/jerk-seasoning.json')).toBe(true);
    expect(result.content[0].text).not.toContain('skipped');
  });

  it('rejects a recipe draft with no ingredients without committing anything', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({ ...validRecipeDraft, ingredients: [] });

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'abc1' })).rejects.toThrow(/ingredient/);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(draftsMock.deleteDraftBranch).not.toHaveBeenCalled();
  });

  it('rejects a draft with no title without committing anything', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({ ...validRecipeDraft, title: '' });

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'abc1' })).rejects.toThrow(/title/);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(draftsMock.deleteDraftBranch).not.toHaveBeenCalled();
  });

  it('rejects an article draft with no sections without committing anything', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({
      ...validRecipeDraft,
      postType: 'article' as const,
      sections: [],
    });

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'abc1' })).rejects.toThrow(/section/);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(draftsMock.deleteDraftBranch).not.toHaveBeenCalled();
  });

  it('rejects a draft with no photos without committing anything', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({ ...validRecipeDraft, photos: [] });

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'abc1' })).rejects.toThrow(/photo/);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(draftsMock.deleteDraftBranch).not.toHaveBeenCalled();
  });

  it('throws when no draft matches the given id', async () => {
    draftsMock.findDraftKind.mockResolvedValue(null);
    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'nope' })).rejects.toThrow(/No draft found/);
  });
});

describe('confirm_and_publish (set)', () => {
  it('publishes the new set, its products, and auto-closes the immediately-preceding set among 3+ candidates', async () => {
    draftsMock.findDraftKind.mockResolvedValue('set');
    draftsMock.readDraft.mockResolvedValue({
      kind: 'set',
      name: 'Sunset Terracotta',
      startDate: '2027-02-15',
      products: [
        { name: 'Terracotta Bowl', priceCents: 3200, image: 'https://example.com/bowl.jpg', imageAlt: 'A terracotta bowl', vendorUrl: 'https://vendor.example.com/terracotta-bowl' },
      ],
    });
    // Three prior sets, deliberately out of order in the mocked collection, so a
    // selection bug (e.g. picking the oldest, or the first in list order) would be
    // caught: "even-older" and "ancient" must NOT be selected — only "coastal-blue"
    // (the one with the latest startDate still before the new set's startDate).
    catalogMock2.readCollection.mockResolvedValue([
      { id: 'even-older', data: { name: 'Even Older', startDate: '2025-01-01', endDate: '2026-06-30' } },
      { id: 'coastal-blue', data: { name: 'Coastal Blue', startDate: '2026-07-01', endDate: '9999-12-31' } },
      { id: 'ancient', data: { name: 'Ancient', startDate: '2024-01-01', endDate: '2024-12-31' } },
    ]);
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await server.call('confirm_and_publish', { draftId: 'set1' });

    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/content/sets/sunset-terracotta.json',
          content: expect.not.stringContaining('productIds'),
        }),
        expect.objectContaining({ path: 'src/content/products/terracotta-bowl.json' }),
        expect.objectContaining({
          path: 'src/content/sets/coastal-blue.json',
          content: expect.stringContaining('"endDate": "2027-02-14"'),
        }),
      ]),
      expect.stringContaining('Sunset Terracotta'),
    );
    const [, files] = githubMock.commitFilesToMain.mock.calls[0] as [unknown, { path: string }[]];
    expect(files.some((f) => f.path === 'src/content/sets/even-older.json')).toBe(false);
    expect(files.some((f) => f.path === 'src/content/sets/ancient.json')).toBe(false);
    expect(draftsMock.deleteDraftBranch).toHaveBeenCalledWith(expect.anything(), 'set', 'set1');
  });

  it('avoids a product filename collision with an existing catalog file', async () => {
    draftsMock.findDraftKind.mockResolvedValue('set');
    draftsMock.readDraft.mockResolvedValue({
      kind: 'set',
      name: 'Sunset Terracotta',
      startDate: '2027-02-15',
      products: [
        { name: 'Serving Platter', priceCents: 4800, image: 'https://example.com/platter.jpg', imageAlt: 'A serving platter', vendorUrl: 'https://vendor.example.com/serving-platter' },
      ],
    });
    catalogMock2.readCollection.mockResolvedValue([]);
    githubMock.listFiles.mockResolvedValue(['serving-platter.json']);
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await server.call('confirm_and_publish', { draftId: 'set1' });

    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ path: 'src/content/products/serving-platter-2.json' })]),
      expect.any(String),
    );
  });
});
