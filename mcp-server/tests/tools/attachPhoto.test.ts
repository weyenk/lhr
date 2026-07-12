import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const mockFetchAndStorePhoto = vi.fn();
vi.mock('../../src/blob', () => ({ fetchAndStorePhoto: (...args: unknown[]) => mockFetchAndStorePhoto(...args) }));

const { registerAttachPhoto } = await import('../../src/tools/attachPhoto');

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

describe('attach_photo', () => {
  it('stores the fetched blob URL and caption on the draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    mockFetchAndStorePhoto.mockResolvedValue('https://blob.vercel-storage.com/posts/abc.jpeg');
    const server = fakeServer();
    registerAttachPhoto(server as never, 'token');

    const result = (await server.call('attach_photo', {
      draftId: 'abc1',
      photoUrl: 'https://icloud.com/share/xyz',
      caption: 'Chicken on the platter',
    })) as { content: { text: string }[] };

    expect(mockFetchAndStorePhoto).toHaveBeenCalledWith('https://icloud.com/share/xyz');
    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        photos: [{ url: 'https://blob.vercel-storage.com/posts/abc.jpeg', caption: 'Chicken on the platter' }],
      }),
      expect.any(String),
    );
    expect(result.content[0].text).toContain('added');
  });

  it('reports a fetch failure without touching the draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    mockFetchAndStorePhoto.mockRejectedValue(new Error('Failed to fetch photo from https://icloud.com/share/bad: 404'));
    const server = fakeServer();
    registerAttachPhoto(server as never, 'token');

    await expect(
      server.call('attach_photo', { draftId: 'abc1', photoUrl: 'https://icloud.com/share/bad' }),
    ).rejects.toThrow(/404/);
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });
});
