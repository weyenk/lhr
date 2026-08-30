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

vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  createBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.set(branch, 'base');
    state.files.set(branch, new Map());
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
  deleteBranch: vi.fn(async () => {}),
}));

const pickUnusedSourceRecipe = vi.fn();
vi.mock('../../src/themealdb', () => ({
  pickUnusedSourceRecipe: (...args: unknown[]) => pickUnusedSourceRecipe(...args),
}));

const generateAllVariants = vi.fn();
vi.mock('../../src/dietSubstitutions', () => ({
  generateAllVariants: (...args: unknown[]) => generateAllVariants(...args),
}));

const generateNarrative = vi.fn();
vi.mock('../../src/narrative', () => ({
  generateNarrative: (...args: unknown[]) => generateNarrative(...args),
}));

const { runWeeklyVariantRecipeGeneration } = await import('../../src/generateWeeklyVariantRecipe');

const client = {} as import('../../src/github').GitHubClient;

const sourceRecipe = {
  idMeal: '52772',
  title: 'Teriyaki Chicken Casserole',
  cuisine: 'Japanese',
  category: 'Chicken',
  thumbnail: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
  ingredients: [{ item: 'Soy sauce', amount: '3/4 cup' }],
  steps: ['Preheat oven to 350F.'],
};

const diets = ['gluten-free', 'vegan', 'vegetarian', 'pescatarian', 'low-carb', 'low-salt', 'low-fat'] as const;
const eightVariants = [
  { diet: 'original' as const, ingredients: sourceRecipe.ingredients, steps: sourceRecipe.steps },
  ...diets.map((diet) => ({ diet, ingredients: sourceRecipe.ingredients, steps: sourceRecipe.steps })),
];

beforeEach(() => {
  state = makeFakeGitHub();
  vi.clearAllMocks();
  pickUnusedSourceRecipe.mockResolvedValue(sourceRecipe);
  generateAllVariants.mockResolvedValue({ variants: eightVariants, flaggedDiets: [] });
  generateNarrative.mockResolvedValue('Once upon a weeknight...');
});

describe('runWeeklyVariantRecipeGeneration', () => {
  it('creates a draft with 8 variants, the narrative, and the source id', async () => {
    const result = await runWeeklyVariantRecipeGeneration(client);

    expect(result.skipped).toBe(false);
    expect(result.draftId).toBeDefined();
    expect(result.sourceMealDbId).toBe('52772');

    const branchFiles = state.files.get(`draft/post-${result.draftId}`)!;
    const draftPath = Array.from(branchFiles.keys())[0];
    const draft = JSON.parse(branchFiles.get(draftPath)!);
    expect(draft.variants).toHaveLength(8);
    expect(draft.narrativeBody).toBe('Once upon a weeknight...');
    expect(draft.sourceMealDbId).toBe('52772');
    expect(draft.photos).toEqual([{ url: sourceRecipe.thumbnail, caption: sourceRecipe.title }]);
  });

  it('skips a recipe whose sourceMealDbId already exists on an existing post', async () => {
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

    await runWeeklyVariantRecipeGeneration(client);

    expect(pickUnusedSourceRecipe).toHaveBeenCalledWith(new Set(['52772']));
  });

  it('flags a diet that could not be generated instead of dropping it or crashing the run', async () => {
    generateAllVariants.mockResolvedValue({
      variants: eightVariants.map((v) =>
        v.diet === 'low-fat' ? { ...v, notes: "couldn't generate — needs manual pass" } : v,
      ),
      flaggedDiets: ['low-fat'],
    });

    const result = await runWeeklyVariantRecipeGeneration(client);

    expect(result.skipped).toBe(false);
    expect(result.flaggedDiets).toEqual(['low-fat']);
  });

  it('excludes a sourceMealDbId present only in an open (unpublished) draft branch from the used-id pool', async () => {
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

    await runWeeklyVariantRecipeGeneration(client);

    expect(pickUnusedSourceRecipe).toHaveBeenCalledWith(new Set(['99999']));
  });

  it('skips the run without creating a draft when no unused recipe can be found', async () => {
    pickUnusedSourceRecipe.mockResolvedValue(null);

    const result = await runWeeklyVariantRecipeGeneration(client);

    expect(result.skipped).toBe(true);
    expect(state.branches.size).toBe(0);
  });
});
