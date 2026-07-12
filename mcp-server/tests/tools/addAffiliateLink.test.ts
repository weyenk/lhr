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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('add_affiliate_link', () => {
  it('reuses an existing catalog entry matched by URL', async () => {
    draftsMock.readDraft.mockResolvedValue(createBaseDraft());
    catalogMock.readCollection.mockResolvedValue([
      { id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } },
    ]);
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
    catalogMock.readCollection.mockResolvedValue([]);
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

  it('appends onto existing affiliateLinkIds and pendingAffiliateLinks rather than replacing them', async () => {
    draftsMock.readDraft.mockResolvedValue({
      ...createBaseDraft(),
      affiliateLinkIds: ['existing-link'],
      pendingAffiliateLinks: [{ id: 'first-pending-ab12', label: 'First pending', url: 'https://vendor.example.com/first', tag: 'first' }],
    });
    catalogMock.readCollection.mockResolvedValue([
      { id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } },
    ]);
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
});
