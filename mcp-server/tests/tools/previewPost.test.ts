import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const { registerPreviewPost } = await import('../../src/tools/previewPost');

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

describe('preview_post', () => {
  it('returns a text summary of the draft', async () => {
    draftsMock.readDraft.mockResolvedValue({
      kind: 'post',
      postType: 'recipe',
      title: 'Jerk Chicken',
      ingredients: [{ item: 'Chicken' }],
      steps: ['Grill it'],
      sections: [],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
    });
    const server = fakeServer();
    registerPreviewPost(server as never, 'token');

    const result = (await server.call('preview_post', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('Title: Jerk Chicken');
    expect(result.content[0].text).toContain('Ingredients: 1');
  });
});
