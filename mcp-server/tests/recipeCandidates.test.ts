import { describe, expect, it, vi, beforeEach } from 'vitest';

interface FakeRepoState {
  branches: Map<string, string>;
  files: Map<string, Map<string, string>>;
  main: Map<string, string>;
}

function makeFakeGitHub(): FakeRepoState {
  return { branches: new Map(), files: new Map(), main: new Map() };
}

let state: FakeRepoState;

vi.mock('../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  createBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.set(branch, 'base');
    state.files.set(branch, new Map());
  }),
  deleteBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.delete(branch);
    state.files.delete(branch);
  }),
  getFile: vi.fn(async (_client: unknown, path: string, ref: string) => {
    const store = ref === 'main' ? state.main : state.files.get(ref);
    const content = store?.get(path);
    return content === undefined ? null : { content, sha: 'sha' };
  }),
  putFile: vi.fn(async (_client: unknown, params: { path: string; content: string; branch: string }) => {
    state.files.get(params.branch)!.set(params.path, params.content);
  }),
  listFiles: vi.fn(async (_client: unknown, dirPath: string) =>
    Array.from(state.main.keys())
      .filter((p) => p.startsWith(`${dirPath}/`))
      .map((p) => p.slice(dirPath.length + 1)),
  ),
  listBranches: vi.fn(async (_client: unknown, prefix: string) =>
    Array.from(state.branches.keys()).filter((b) => b.startsWith(prefix)),
  ),
}));

const pickUnusedSourceRecipe = vi.fn();
vi.mock('../src/themealdb', () => ({
  pickUnusedSourceRecipe: (...args: unknown[]) => pickUnusedSourceRecipe(...args),
}));

const generateNarrative = vi.fn();
vi.mock('../src/narrative', () => ({
  generateNarrative: (...args: unknown[]) => generateNarrative(...args),
}));

const { pickNewCandidate, getPendingCandidate, rerollCandidate, approveCandidate } = await import(
  '../src/recipeCandidates'
);

const client = {} as import('../src/github').GitHubClient;

const sourceRecipe = {
  idMeal: '52772',
  title: 'Teriyaki Chicken Casserole',
  cuisine: 'Japanese',
  category: 'Chicken',
  thumbnail: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
  ingredients: [{ item: 'Soy sauce', amount: '3/4 cup' }],
  steps: ['Preheat oven to 350F.'],
};

beforeEach(() => {
  state = makeFakeGitHub();
  vi.clearAllMocks();
  pickUnusedSourceRecipe.mockResolvedValue(sourceRecipe);
  generateNarrative.mockResolvedValue('Once upon a weeknight...');
});

describe('pickNewCandidate', () => {
  it('saves a pending candidate branch for an unused recipe', async () => {
    const candidate = await pickNewCandidate(client);

    expect(candidate).not.toBeNull();
    expect(candidate?.record.status).toBe('pending');
    expect(candidate?.record.source).toEqual(sourceRecipe);

    const branch = `candidate/${candidate!.id}`;
    expect(state.branches.has(branch)).toBe(true);
  });

  it('returns null without creating a branch when no unused recipe is found', async () => {
    pickUnusedSourceRecipe.mockResolvedValue(null);

    const candidate = await pickNewCandidate(client);

    expect(candidate).toBeNull();
    expect(state.branches.size).toBe(0);
  });

  it('excludes ids already used by a pending candidate branch, not just posts/drafts', async () => {
    await pickNewCandidate(client); // seeds a pending candidate for idMeal 52772

    await pickNewCandidate(client);

    expect(pickUnusedSourceRecipe).toHaveBeenLastCalledWith(new Set(['52772']));
  });

  it('excludes a sourceMealDbId already used by an existing published post', async () => {
    state.main.set(
      'src/content/posts/teriyaki-chicken.mdx',
      [
        '---',
        'type: recipe',
        'title: Teriyaki Chicken',
        'date: 2026-01-01',
        'coverPhoto: "https://example.com/a.jpg"',
        'coverPhotoAlt: "alt"',
        'kitchenwareIds: []',
        'affiliateLinkIds: []',
        'ingredients:',
        '  - item: chicken',
        'steps:',
        '  - cook it',
        'sourceMealDbId: "52772"',
        '---',
        '',
      ].join('\n'),
    );

    await pickNewCandidate(client);

    expect(pickUnusedSourceRecipe).toHaveBeenCalledWith(new Set(['52772']));
  });

  it('excludes a sourceMealDbId present only in an open (unpublished) draft branch', async () => {
    const draftId = 'existing1';
    const draftBranch = `draft/post-${draftId}`;
    state.branches.set(draftBranch, 'base');
    state.files.set(
      draftBranch,
      new Map([
        [
          `.drafts/${draftId}.json`,
          JSON.stringify({
            kind: 'post',
            postType: 'recipe',
            title: 'A Draft Recipe Awaiting Review',
            ingredients: [{ item: 'Chicken' }],
            steps: ['Cook it.'],
            sections: [],
            photos: [],
            kitchenwareIds: [],
            affiliateLinkIds: [],
            pendingAffiliateLinks: [],
            pendingIngredientLinks: [],
            variants: [],
            sourceMealDbId: '99999',
          }),
        ],
      ]),
    );

    await pickNewCandidate(client);

    expect(pickUnusedSourceRecipe).toHaveBeenCalledWith(new Set(['99999']));
  });
});

describe('getPendingCandidate', () => {
  it('returns null when there are no candidate branches', async () => {
    expect(await getPendingCandidate(client)).toBeNull();
  });

  it('returns null when every candidate branch has already been rerolled and none remain', async () => {
    const candidate = await pickNewCandidate(client);
    pickUnusedSourceRecipe.mockResolvedValueOnce(null); // nothing left to suggest this time
    await rerollCandidate(client, candidate!.id);

    expect(await getPendingCandidate(client)).toBeNull();
  });

  it('returns the pending candidate when one exists', async () => {
    const candidate = await pickNewCandidate(client);

    const found = await getPendingCandidate(client);
    expect(found?.id).toBe(candidate?.id);
    expect(found?.record.status).toBe('pending');
  });
});

describe('rerollCandidate', () => {
  it('marks the old candidate rerolled (kept, not deleted) and returns a freshly picked one', async () => {
    const original = await pickNewCandidate(client);
    pickUnusedSourceRecipe.mockResolvedValue({ ...sourceRecipe, idMeal: '99999', title: 'Lasagne' });

    const next = await rerollCandidate(client, original!.id);

    expect(next?.record.source.idMeal).toBe('99999');
    expect(next?.id).not.toBe(original?.id);

    const oldBranch = JSON.parse(state.files.get(`candidate/${original!.id}`)!.get(`.candidates/${original!.id}.json`)!);
    expect(oldBranch.status).toBe('rerolled');
    expect(state.branches.has(`candidate/${original!.id}`)).toBe(true);
  });

  it('never re-suggests a rerolled recipe', async () => {
    const original = await pickNewCandidate(client);
    await rerollCandidate(client, original!.id);

    expect(pickUnusedSourceRecipe).toHaveBeenLastCalledWith(new Set(['52772']));
  });
});

describe('approveCandidate', () => {
  it('generates the narrative, creates a real draft with the original variant, and removes the candidate branch', async () => {
    const candidate = await pickNewCandidate(client);

    const result = await approveCandidate(client, candidate!.id);

    expect(result.title).toBe('Teriyaki Chicken Casserole');
    expect(result.sourceMealDbId).toBe('52772');
    expect(state.branches.has(`candidate/${candidate!.id}`)).toBe(false);

    const draftBranch = `draft/post-${result.draftId}`;
    const draftFile = Array.from(state.files.get(draftBranch)!.keys())[0];
    const draft = JSON.parse(state.files.get(draftBranch)!.get(draftFile)!);
    expect(draft.variants).toEqual([{ diet: 'original', ingredients: sourceRecipe.ingredients, steps: sourceRecipe.steps }]);
    expect(draft.narrativeBody).toBe('Once upon a weeknight...');
    expect(draft.sourceMealDbId).toBe('52772');
  });

  it('throws for an unknown candidate id', async () => {
    await expect(approveCandidate(client, 'nope')).rejects.toThrow(/not found/);
  });
});
