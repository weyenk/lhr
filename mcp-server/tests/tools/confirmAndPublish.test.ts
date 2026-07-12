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

const githubMock = { commitFilesToMain: vi.fn() };
vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  commitFilesToMain: (...args: unknown[]) => githubMock.commitFilesToMain(...args),
}));

const catalogMock = { uniqueSlug: vi.fn() };
vi.mock('../../src/catalog', () => ({ uniqueSlug: (...args: unknown[]) => catalogMock.uniqueSlug(...args) }));

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
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [{ id: 'sauce-ab12', label: 'Sauce', url: 'https://vendor.example.com/sauce', tag: 'sauce' }],
};

beforeEach(() => {
  vi.clearAllMocks();
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
      ]),
      expect.stringContaining('Jerk Chicken'),
    );
    expect(draftsMock.deleteDraftBranch).toHaveBeenCalledWith(expect.anything(), 'post', 'abc1');
    expect(result.content[0].text).toContain('jerk-chicken');
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

  it('throws when no draft matches the given id', async () => {
    draftsMock.findDraftKind.mockResolvedValue(null);
    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'nope' })).rejects.toThrow(/No draft found/);
  });
});
