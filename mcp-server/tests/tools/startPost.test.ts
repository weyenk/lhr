import { describe, expect, it, vi, beforeEach } from 'vitest';

const drafts = {
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
};

vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, listDrafts: drafts.listDrafts, createDraft: drafts.createDraft };
});
vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
}));

const { registerStartPost } = await import('../../src/tools/startPost');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('start_post', () => {
  it('lists open drafts instead of creating a new one when drafts exist', async () => {
    drafts.listDrafts.mockResolvedValue([{ id: 'abc1', branch: 'draft/post-abc1', title: 'Jerk Chicken' }]);
    const server = fakeServer();
    registerStartPost(server as never, 'token');

    const result = (await server.call('start_post', { type: 'recipe' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('abc1');
    expect(result.content[0].text).toContain('Jerk Chicken');
    expect(drafts.createDraft).not.toHaveBeenCalled();
  });

  it('creates a new draft when none are open', async () => {
    drafts.listDrafts.mockResolvedValue([]);
    drafts.createDraft.mockResolvedValue({ id: 'new1', branch: 'draft/post-new1' });
    const server = fakeServer();
    registerStartPost(server as never, 'token');

    const result = (await server.call('start_post', { type: 'article' })) as { content: { text: string }[] };

    expect(drafts.createDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      expect.objectContaining({ kind: 'post', postType: 'article', pendingAffiliateLinks: [], pendingIngredientLinks: [] }),
    );
    expect(result.content[0].text).toContain('new1');
  });
});
