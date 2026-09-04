import { describe, expect, it, vi, beforeEach } from 'vitest';

const github = {
  getFile: vi.fn(),
  putFile: vi.fn(),
  createBranch: vi.fn(),
  listBranches: vi.fn(),
  deleteBranch: vi.fn(),
};

vi.mock('../src/github', () => ({
  getFile: (...args: unknown[]) => github.getFile(...args),
  putFile: (...args: unknown[]) => github.putFile(...args),
  createBranch: (...args: unknown[]) => github.createBranch(...args),
  listBranches: (...args: unknown[]) => github.listBranches(...args),
  deleteBranch: (...args: unknown[]) => github.deleteBranch(...args),
}));

const {
  createDraft,
  readDraft,
  writeDraft,
  listDrafts,
  deleteDraftBranch,
  findDraftKind,
  summarizeDraftPost,
  draftSchema,
} = await import('../src/drafts');

const client = {} as import('../src/github').GitHubClient;

const emptyRecipeDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: '',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
  pendingIngredientLinks: [],
  variants: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createDraft', () => {
  it('creates a branch and writes the initial draft JSON', async () => {
    const { id, branch } = await createDraft(client, 'post', emptyRecipeDraft);
    expect(branch).toBe(`draft/post-${id}`);
    expect(github.createBranch).toHaveBeenCalledWith(client, branch);
    expect(github.putFile).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ path: `.drafts/${id}.json`, branch }),
    );
  });
});

describe('readDraft', () => {
  it('parses the draft JSON from the branch', async () => {
    github.getFile.mockResolvedValue({ content: JSON.stringify(emptyRecipeDraft), sha: 'sha1' });
    const draft = await readDraft(client, 'post', 'abc1');
    expect(draft).toEqual(emptyRecipeDraft);
    expect(github.getFile).toHaveBeenCalledWith(client, '.drafts/abc1.json', 'draft/post-abc1');
  });

  it('throws if the draft does not exist', async () => {
    github.getFile.mockResolvedValue(null);
    await expect(readDraft(client, 'post', 'missing')).rejects.toThrow();
  });
});

describe('writeDraft', () => {
  it('writes updated draft JSON using the existing file sha', async () => {
    github.getFile.mockResolvedValue({ content: JSON.stringify(emptyRecipeDraft), sha: 'sha1' });
    const updated = { ...emptyRecipeDraft, title: 'Jerk Chicken' };
    await writeDraft(client, 'post', 'abc1', updated, 'Set title');
    expect(github.putFile).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ path: '.drafts/abc1.json', branch: 'draft/post-abc1', sha: 'sha1', message: 'Set title' }),
    );
  });
});

describe('listDrafts', () => {
  it('summarizes each open draft branch', async () => {
    github.listBranches.mockResolvedValue(['draft/post-abc1', 'draft/post-def2']);
    github.getFile.mockImplementation(async (_client: unknown, path: string) => {
      if (path === '.drafts/abc1.json') return { content: JSON.stringify({ ...emptyRecipeDraft, title: 'Jerk Chicken' }), sha: 's1' };
      if (path === '.drafts/def2.json') return { content: JSON.stringify(emptyRecipeDraft), sha: 's2' };
      return null;
    });
    const result = await listDrafts(client, 'post');
    expect(result).toEqual([
      { id: 'abc1', branch: 'draft/post-abc1', title: 'Jerk Chicken' },
      { id: 'def2', branch: 'draft/post-def2', title: '' },
    ]);
  });
});

describe('deleteDraftBranch', () => {
  it('deletes the branch for the given kind and id', async () => {
    await deleteDraftBranch(client, 'post', 'abc1');
    expect(github.deleteBranch).toHaveBeenCalledWith(client, 'draft/post-abc1');
  });
});

describe('findDraftKind', () => {
  it('returns "post" when a post draft branch exists', async () => {
    github.listBranches.mockImplementation(async (_client: unknown, prefix: string) =>
      prefix === 'draft/post-abc1' ? ['draft/post-abc1'] : [],
    );
    expect(await findDraftKind(client, 'abc1')).toBe('post');
  });

  it('returns "set" when a set draft branch exists', async () => {
    github.listBranches.mockImplementation(async (_client: unknown, prefix: string) =>
      prefix === 'draft/set-xyz9' ? ['draft/set-xyz9'] : [],
    );
    expect(await findDraftKind(client, 'xyz9')).toBe('set');
  });

  it('returns null when no matching branch exists', async () => {
    github.listBranches.mockResolvedValue([]);
    expect(await findDraftKind(client, 'nope')).toBeNull();
  });

  it('does not false-positive when a branch only shares a prefix with the requested id', async () => {
    // listBranches is a startsWith match under the hood — a branch named
    // draft/post-abc12345 must not count as a match for id "abc1".
    github.listBranches.mockImplementation(async (_client: unknown, prefix: string) =>
      prefix === 'draft/post-abc1' ? ['draft/post-abc12345'] : [],
    );
    expect(await findDraftKind(client, 'abc1')).toBeNull();
  });
});

describe('summarizeDraftPost', () => {
  it('includes recipe-specific counts', () => {
    const summary = summarizeDraftPost({ ...emptyRecipeDraft, title: 'Jerk Chicken', ingredients: [{ item: 'Chicken' }], steps: ['Grill it'] });
    expect(summary).toContain('Title: Jerk Chicken');
    expect(summary).toContain('Ingredients: 1');
    expect(summary).toContain('Steps: 1');
  });

  it('includes the count of pending ingredient links', () => {
    const summary = summarizeDraftPost({
      ...emptyRecipeDraft,
      title: 'Jerk Chicken',
      ingredients: [{ item: 'Chicken' }],
      steps: ['Grill it'],
      pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' }],
    });
    expect(summary).toContain('Ingredient links to remember: 1');
  });

  it('includes article-specific section count', () => {
    const summary = summarizeDraftPost({
      ...emptyRecipeDraft,
      postType: 'article',
      title: 'Why We Chose Coastal Blue',
      sections: [{ heading: 'Why blue', body: 'It photographs beautifully.' }],
    });
    expect(summary).toContain('Title: Why We Chose Coastal Blue');
    expect(summary).toContain('Sections: 1');
    expect(summary).not.toContain('Ingredients:');
  });

  it('lists variant diets in array order when the draft has variants', () => {
    const summary = summarizeDraftPost({
      ...emptyRecipeDraft,
      title: 'Jerk Chicken',
      variants: [
        { diet: 'original', ingredients: [{ item: 'Chicken' }], steps: ['Grill it'] },
        { diet: 'gluten-free', ingredients: [{ item: 'Chicken' }], steps: ['Grill it'] },
        { diet: 'vegan', ingredients: [{ item: 'Plant-based chicken' }], steps: ['Grill it'] },
      ],
    });
    expect(summary).toContain('Variants: original, gluten-free, vegan');
  });

  it('reports the count of variants needing a manual pass', () => {
    const summary = summarizeDraftPost({
      ...emptyRecipeDraft,
      title: 'Jerk Chicken',
      variants: [
        { diet: 'original', ingredients: [{ item: 'Chicken' }], steps: ['Grill it'] },
        {
          diet: 'low-fat',
          ingredients: [{ item: 'Chicken' }],
          steps: ['Grill it'],
          notes: "couldn't generate — needs manual pass",
        },
        {
          diet: 'vegan',
          ingredients: [{ item: 'Plant-based chicken' }],
          steps: ['Grill it'],
          notes: "couldn't generate — needs manual pass",
        },
      ],
    });
    expect(summary).toContain('Diets needing a manual pass: 2');
  });

  it('shows a truncated narrative line when the draft has a narrative body', () => {
    const longNarrative =
      'This jerk chicken recipe has been in the family for generations, passed down through countless Sunday dinners.';
    const summary = summarizeDraftPost({
      ...emptyRecipeDraft,
      title: 'Jerk Chicken',
      narrativeBody: longNarrative,
    });
    expect(summary).toContain(`Narrative: ${longNarrative.slice(0, 80)}...`);
  });

  it('omits variant, manual-pass, and narrative lines for a hand-authored post with none of those fields', () => {
    const summary = summarizeDraftPost({
      ...emptyRecipeDraft,
      title: 'Jerk Chicken',
      ingredients: [{ item: 'Chicken' }],
      steps: ['Grill it'],
    });
    expect(summary).not.toContain('Variants:');
    expect(summary).not.toContain('Diets needing a manual pass:');
    expect(summary).not.toContain('Narrative:');
  });
});

describe('draftPostSchema variants/sourceMealDbId/narrativeBody', () => {
  it('defaults variants to an empty array and leaves sourceMealDbId/narrativeBody undefined', () => {
    const parsed = draftSchema.parse(emptyRecipeDraft);
    if (parsed.kind !== 'post') throw new Error('expected a post draft');
    expect(parsed.variants).toEqual([]);
    expect(parsed.sourceMealDbId).toBeUndefined();
    expect(parsed.narrativeBody).toBeUndefined();
  });

  it('accepts a draft with variants, a sourceMealDbId, and a narrativeBody', () => {
    const draft = {
      ...emptyRecipeDraft,
      variants: [
        { diet: 'original' as const, ingredients: [{ item: 'Chicken' }], steps: ['Cook it.'] },
        { diet: 'vegan' as const, ingredients: [{ item: 'Plant-based chicken' }], steps: ['Cook it.'] },
      ],
      sourceMealDbId: '52772',
      narrativeBody: 'A short story about a weeknight dinner.',
    };
    const parsed = draftSchema.parse(draft);
    if (parsed.kind !== 'post') throw new Error('expected a post draft');
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.sourceMealDbId).toBe('52772');
    expect(parsed.narrativeBody).toBe('A short story about a weeknight dinner.');
  });
});
