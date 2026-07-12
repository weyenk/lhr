import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { createDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, createDraft: draftsMock.createDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const { registerStartNewSet } = await import('../../src/tools/startNewSet');

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

describe('start_new_set', () => {
  it('creates a set draft with the given name, start date, and products', async () => {
    draftsMock.createDraft.mockResolvedValue({ id: 'set1', branch: 'draft/set-set1' });
    const server = fakeServer();
    registerStartNewSet(server as never, 'token');

    const result = (await server.call('start_new_set', {
      name: 'Sunset Terracotta',
      startDate: '2027-01-01',
      products: [
        {
          name: 'Terracotta Bowl',
          priceCents: 3200,
          image: 'https://example.com/bowl.jpg',
          imageAlt: 'A terracotta bowl',
          vendorUrl: 'https://vendor.example.com/terracotta-bowl',
        },
      ],
    })) as { content: { text: string }[] };

    expect(draftsMock.createDraft).toHaveBeenCalledWith(
      expect.anything(),
      'set',
      expect.objectContaining({ kind: 'set', name: 'Sunset Terracotta', startDate: '2027-01-01' }),
    );
    expect(result.content[0].text).toContain('set1');
  });
});
