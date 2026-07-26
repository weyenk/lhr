import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const catalogMock = { readCollection: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { registerSuggestAffiliateLinks } = await import('../../src/tools/suggestAffiliateLinks');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

function createRecipeDraft(ingredients: Array<{ item: string; amount?: string }>) {
  return {
    kind: 'post' as const,
    postType: 'recipe' as const,
    title: 'Jerk Chicken',
    ingredients,
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

describe('suggest_affiliate_links', () => {
  it('reports a match for an ingredient with an existing library entry', async () => {
    draftsMock.readDraft.mockResolvedValue(createRecipeDraft([{ item: '2 tbsp jerk seasoning' }]));
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/ingredient-links'
        ? [{ id: 'jerk-seasoning', data: { ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' } }]
        : [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }],
    );
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('2 tbsp jerk seasoning');
    expect(result.content[0].text).toContain('The jerk seasoning we used');
    expect(result.content[0].text).toContain('https://vendor.example.com/jerk-seasoning');
  });

  it('reports an ingredient as unmatched when no library entry exists', async () => {
    draftsMock.readDraft.mockResolvedValue(createRecipeDraft([{ item: '3 green onions' }]));
    catalogMock.readCollection.mockResolvedValue([]);
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('3 green onions');
    expect(result.content[0].text.toLowerCase()).toContain('no existing link');
  });

  it('no-ops for article drafts', async () => {
    draftsMock.readDraft.mockResolvedValue({
      kind: 'post' as const,
      postType: 'article' as const,
      title: 'Why We Chose Coastal Blue',
      ingredients: [],
      steps: [],
      sections: [{ heading: 'Why blue', body: 'Text' }],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
    });
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(catalogMock.readCollection).not.toHaveBeenCalled();
    expect(result.content[0].text.toLowerCase()).toContain('no ingredients to match');
  });

  it('no-ops for a recipe draft with zero ingredients', async () => {
    draftsMock.readDraft.mockResolvedValue(createRecipeDraft([]));
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(catalogMock.readCollection).not.toHaveBeenCalled();
    expect(result.content[0].text.toLowerCase()).toContain('no ingredients to match');
  });
});
