import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const mockSignUploadLink = vi.fn();
vi.mock('../../src/uploadLink', () => ({ signUploadLink: (...args: unknown[]) => mockSignUploadLink(...args) }));

const { registerGetPhotoUploadLink } = await import('../../src/tools/getPhotoUploadLink');

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
  process.env.MCP_SERVER_URL = 'https://lhr-authoring.vercel.app';
});

describe('get_photo_upload_link', () => {
  it('returns a link containing the signed token and expiry', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    mockSignUploadLink.mockReturnValue({ token: 'abc123', expiresAt: 1234567890 });
    const server = fakeServer();
    registerGetPhotoUploadLink(server as never, 'token');

    const result = (await server.call('get_photo_upload_link', { draftId: 'abc1' })) as {
      content: { text: string }[];
    };

    expect(mockSignUploadLink).toHaveBeenCalledWith('abc1');
    expect(result.content[0].text).toBe(
      'Open this link on your phone to upload photos (expires in 1 hour): https://lhr-authoring.vercel.app/upload/abc1?exp=1234567890&token=abc123',
    );
  });

  it('rejects a draft that is not a post draft', async () => {
    draftsMock.readDraft.mockResolvedValue({ kind: 'set', name: 'Spring set', products: [] });
    const server = fakeServer();
    registerGetPhotoUploadLink(server as never, 'token');

    await expect(server.call('get_photo_upload_link', { draftId: 'abc1' })).rejects.toThrow(/not a post draft/);
  });
});
