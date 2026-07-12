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

const { registerLinkKitchenware } = await import('../../src/tools/linkKitchenware');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const baseDraft = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('link_kitchenware', () => {
  it('suggests only the active set products when no productIds are given', async () => {
    catalogMock.readCollection.mockImplementation(async (_client: unknown, dir: string) => {
      if (dir === 'src/content/sets') {
        return [
          { id: 'coastal-blue', data: { name: 'Coastal Blue', startDate: '2026-01-01', endDate: '2026-12-31' } },
          { id: 'sunset-terracotta', data: { name: 'Sunset Terracotta', startDate: '2020-01-01', endDate: '2020-12-31' } },
        ];
      }
      return [
        { id: 'coastal-blue-platter', data: { name: 'Coastal Blue Serving Platter', priceCents: 4800, setId: 'coastal-blue' } },
        { id: 'terracotta-bowl', data: { name: 'Terracotta Bowl', priceCents: 3200, setId: 'sunset-terracotta' } },
      ];
    });
    const server = fakeServer();
    registerLinkKitchenware(server as never, 'token');

    const result = (await server.call('link_kitchenware', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('coastal-blue-platter');
    expect(result.content[0].text).not.toContain('terracotta-bowl');
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });

  it('links the given product ids to the draft', async () => {
    catalogMock.readCollection.mockResolvedValue([]);
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    const server = fakeServer();
    registerLinkKitchenware(server as never, 'token');

    await server.call('link_kitchenware', { draftId: 'abc1', productIds: ['coastal-blue-platter'] });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ kitchenwareIds: ['coastal-blue-platter'] }),
      expect.any(String),
    );
  });
});
