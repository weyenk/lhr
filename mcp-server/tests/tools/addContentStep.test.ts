import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const { registerAddContentStep } = await import('../../src/tools/addContentStep');

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

describe('add_content_step', () => {
  it('appends an ingredient and step to a recipe draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', {
      draftId: 'abc1',
      ingredient: { item: 'Chicken thighs', amount: '2 lbs' },
      step: 'Marinate overnight.',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
        steps: ['Marinate overnight.'],
      }),
      expect.any(String),
    );
  });

  it('appends a section to an article draft', async () => {
    draftsMock.readDraft.mockResolvedValue({ ...baseDraft, postType: 'article' });
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', {
      draftId: 'abc1',
      section: { heading: 'Why blue', body: 'It photographs beautifully.' },
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ sections: [{ heading: 'Why blue', body: 'It photographs beautifully.' }] }),
      expect.any(String),
    );
  });

  it('sets the title when provided', async () => {
    draftsMock.readDraft.mockResolvedValue({ ...baseDraft, title: '' });
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', { draftId: 'abc1', title: 'Jerk Chicken for a Crowd' });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ title: 'Jerk Chicken for a Crowd' }),
      expect.any(String),
    );
  });

  it('appends onto existing ingredients, steps, and sections rather than replacing them', async () => {
    draftsMock.readDraft.mockResolvedValue({
      ...baseDraft,
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Marinate overnight.'],
      sections: [{ heading: 'Why blue', body: 'It photographs beautifully.' }],
    });
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', {
      draftId: 'abc1',
      ingredient: { item: 'Jerk seasoning', amount: '3 tbsp' },
      step: 'Grill over indirect heat.',
      section: { heading: 'Care instructions', body: 'Hand wash only.' },
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        ingredients: [
          { item: 'Chicken thighs', amount: '2 lbs' },
          { item: 'Jerk seasoning', amount: '3 tbsp' },
        ],
        steps: ['Marinate overnight.', 'Grill over indirect heat.'],
        sections: [
          { heading: 'Why blue', body: 'It photographs beautifully.' },
          { heading: 'Care instructions', body: 'Hand wash only.' },
        ],
      }),
      expect.any(String),
    );
  });
});
