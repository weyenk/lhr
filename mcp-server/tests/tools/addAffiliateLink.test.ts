import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const catalogMock = { readCollection: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { registerAddAffiliateLink } = await import('../../src/tools/addAffiliateLink');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

function createBaseDraft() {
  return {
    kind: 'post' as const,
    postType: 'recipe' as const,
    title: 'Jerk Chicken',
    ingredients: [],
    steps: [],
    sections: [],
    photos: [],
    kitchenwareIds: [],
    affiliateLinkIds: [],
    pendingAffiliateLinks: [],
    pendingIngredientLinks: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('add_affiliate_link', () => {
  it('reuses an existing catalog entry matched by URL', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ affiliateLinkIds: ['jerk-seasoning'], pendingAffiliateLinks: [] }),
      expect.any(String),
    );
  });

  it('stages a new pending entry when no URL match exists', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links' ? [] : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'New sauce',
      url: 'https://vendor.example.com/new-sauce',
      tag: 'new-sauce',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        affiliateLinkIds: [],
        pendingAffiliateLinks: [expect.objectContaining({ label: 'New sauce', url: 'https://vendor.example.com/new-sauce', tag: 'new-sauce' })],
      }),
      expect.any(String),
    );
  });

  it('appends onto existing affiliateLinkIds rather than replacing them (match branch)', async () => {
    draftsMock.readDraft.mockResolvedValue({
      ...createBaseDraft(),
      affiliateLinkIds: ['existing-link'],
      pendingAffiliateLinks: [{ id: 'first-pending-ab12', label: 'First pending', url: 'https://vendor.example.com/first', tag: 'first' }],
    });
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        affiliateLinkIds: ['existing-link', 'jerk-seasoning'],
        pendingAffiliateLinks: [{ id: 'first-pending-ab12', label: 'First pending', url: 'https://vendor.example.com/first', tag: 'first' }],
      }),
      expect.any(String),
    );
  });

  it('appends onto existing pendingAffiliateLinks rather than replacing them (no-match branch)', async () => {
    draftsMock.readDraft.mockResolvedValue({
      ...createBaseDraft(),
      affiliateLinkIds: ['existing-link'],
      pendingAffiliateLinks: [{ id: 'first-pending-ab12', label: 'First pending', url: 'https://vendor.example.com/first', tag: 'first' }],
    });
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links' ? [] : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Second pending',
      url: 'https://vendor.example.com/second',
      tag: 'second',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        affiliateLinkIds: ['existing-link'],
        pendingAffiliateLinks: [
          { id: 'first-pending-ab12', label: 'First pending', url: 'https://vendor.example.com/first', tag: 'first' },
          expect.objectContaining({ label: 'Second pending', url: 'https://vendor.example.com/second', tag: 'second' }),
        ],
      }),
      expect.any(String),
    );
  });

  it('stages a new ingredient-link entry when the ingredient has no existing mapping (URL match branch)', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
      ingredient: '2 tbsp jerk seasoning',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        affiliateLinkIds: ['jerk-seasoning'],
        pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }],
      }),
      expect.any(String),
    );
  });

  it('stages a new ingredient-link entry pointing at a newly-pending affiliate link (no URL match branch)', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockResolvedValue([]);
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'New sauce',
      url: 'https://vendor.example.com/new-sauce',
      tag: 'new-sauce',
      ingredient: '1 cup new sauce',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        pendingAffiliateLinks: [expect.objectContaining({ label: 'New sauce', tag: 'new-sauce' })],
        pendingIngredientLinks: [expect.objectContaining({ ingredient: 'new sauce' })],
      }),
      expect.any(String),
    );
    const [, , , writtenDraft] = draftsMock.writeDraft.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { pendingAffiliateLinks: { id: string }[]; pendingIngredientLinks: { affiliateLinkId: string }[] },
    ];
    expect(writtenDraft.pendingIngredientLinks[0].affiliateLinkId).toBe(writtenDraft.pendingAffiliateLinks[0].id);
  });

  it('returns a conflict message and does not modify pendingIngredientLinks when the ingredient already maps elsewhere', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : dirPath === 'src/content/ingredient-links'
          ? [{ id: 'jerk-seasoning', data: { ingredient: 'jerk seasoning', affiliateLinkId: 'some-other-link' } }]
          : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    const result = (await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
      ingredient: 'jerk seasoning',
    })) as { content: { text: string }[] };

    expect(result.content[0].text.toLowerCase()).toContain('already linked');
    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ pendingIngredientLinks: [] }),
      expect.any(String),
    );
  });

  it('warns without overwriting when the ingredient is already staged for a different affiliate link in this same draft', async () => {
    draftsMock.readDraft.mockResolvedValue({
      ...createBaseDraft(),
      pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'first-pending-ab12' }],
    });
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    const result = (await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
      ingredient: 'jerk seasoning',
    })) as { content: { text: string }[] };

    expect(result.content[0].text.toLowerCase()).toContain('already staged');
    expect(result.content[0].text.toLowerCase()).not.toContain('will remember');
    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'first-pending-ab12' }],
      }),
      expect.any(String),
    );
  });

  it('does not touch pendingIngredientLinks when the ingredient param is omitted', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ pendingIngredientLinks: [] }),
      expect.any(String),
    );
  });

  it('ignores the ingredient param for article drafts and leaves pendingIngredientLinks untouched', async () => {
    draftsMock.readDraft.mockResolvedValue({ ...createBaseDraft(), postType: 'article' as const });
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/affiliate-links'
        ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
        : [],
    );
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
      ingredient: 'jerk seasoning',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ pendingIngredientLinks: [] }),
      expect.any(String),
    );
  });
});
