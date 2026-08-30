import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MANUAL_PASS_SENTINEL } from '../src/drafts';

interface FakeRepoState {
  branches: Map<string, string>;
  files: Map<string, Map<string, string>>;
}

function makeFakeGitHub(): FakeRepoState {
  return { branches: new Map(), files: new Map() };
}

let state: FakeRepoState;

vi.mock('../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(async (_client: unknown, path: string, ref: string) => {
    const content = state.files.get(ref)?.get(path);
    return content === undefined ? null : { content, sha: 'sha' };
  }),
  putFile: vi.fn(async (_client: unknown, params: { path: string; content: string; branch: string }) => {
    state.files.get(params.branch)!.set(params.path, params.content);
  }),
  listBranches: vi.fn(async (_client: unknown, prefix: string) =>
    Array.from(state.branches.keys()).filter((b) => b.startsWith(prefix)),
  ),
}));

const generateVariant = vi.fn();
vi.mock('../src/dietSubstitutions', async () => {
  const actual = await vi.importActual<typeof import('../src/dietSubstitutions')>('../src/dietSubstitutions');
  return {
    ...actual,
    generateVariant: (...args: unknown[]) => generateVariant(...args),
  };
});

const {
  pendingDiets,
  findIncompleteRecipeDraft,
  finishPendingRecipeVariants,
} = await import('../src/finishRecipeVariants');
const { ALL_SUBSTITUTABLE_DIETS } = await import('../src/dietSubstitutions');

const client = {} as import('../src/github').GitHubClient;

function seedDraft(id: string, draft: Record<string, unknown>): void {
  const branch = `draft/post-${id}`;
  state.branches.set(branch, 'base');
  state.files.set(branch, new Map([[`.drafts/${id}.json`, JSON.stringify(draft)]]));
}

const baseIngredients = [{ item: 'Ground beef', amount: '1 lb' }];
const baseSteps = ['Brown the beef.'];

function recipeDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'post',
    postType: 'recipe',
    title: 'Weeknight Casserole',
    ingredients: baseIngredients,
    steps: baseSteps,
    sections: [],
    photos: [],
    kitchenwareIds: [],
    affiliateLinkIds: [],
    pendingAffiliateLinks: [],
    pendingIngredientLinks: [],
    variants: [{ diet: 'original', ingredients: baseIngredients, steps: baseSteps }],
    sourceMealDbId: '12345',
    ...overrides,
  };
}

beforeEach(() => {
  state = makeFakeGitHub();
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.OPENROUTER_API_KEY = 'test-key';
});

describe('pendingDiets', () => {
  it('returns every substitutable diet when only the original variant exists', () => {
    expect(pendingDiets([{ diet: 'original', ingredients: baseIngredients, steps: baseSteps }])).toEqual(
      ALL_SUBSTITUTABLE_DIETS,
    );
  });

  it('excludes diets that already have a resolved variant', () => {
    const variants = [
      { diet: 'original' as const, ingredients: baseIngredients, steps: baseSteps },
      { diet: 'vegan' as const, ingredients: [{ item: 'Plant-based ground meat' }], steps: baseSteps },
    ];
    expect(pendingDiets(variants)).not.toContain('vegan');
    expect(pendingDiets(variants)).toHaveLength(ALL_SUBSTITUTABLE_DIETS.length - 1);
  });

  it('includes a diet flagged as needing a manual pass, so it gets retried', () => {
    const variants = [
      { diet: 'original' as const, ingredients: baseIngredients, steps: baseSteps },
      { diet: 'vegan' as const, ingredients: baseIngredients, steps: baseSteps, notes: MANUAL_PASS_SENTINEL },
    ];
    expect(pendingDiets(variants)).toContain('vegan');
  });
});

describe('findIncompleteRecipeDraft', () => {
  it('returns null when there are no draft branches', async () => {
    expect(await findIncompleteRecipeDraft(client)).toBeNull();
  });

  it('returns null when every recipe draft already has all 8 variants resolved', async () => {
    const complete = [
      { diet: 'original', ingredients: baseIngredients, steps: baseSteps },
      ...ALL_SUBSTITUTABLE_DIETS.map((diet) => ({ diet, ingredients: baseIngredients, steps: baseSteps })),
    ];
    seedDraft('done1', recipeDraft({ variants: complete }));

    expect(await findIncompleteRecipeDraft(client)).toBeNull();
  });

  it('skips article drafts and returns the first incomplete recipe draft', async () => {
    seedDraft('article1', {
      kind: 'post',
      postType: 'article',
      title: 'A Travel Story',
      ingredients: [],
      steps: [],
      sections: [{ heading: 'Intro', body: 'Once upon a time.' }],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [],
    });
    seedDraft('recipe1', recipeDraft());

    const found = await findIncompleteRecipeDraft(client);
    expect(found?.id).toBe('recipe1');
    expect(found?.draft.title).toBe('Weeknight Casserole');
  });
});

describe('finishPendingRecipeVariants', () => {
  it('reports a clean no-op when there is nothing incomplete to work on', async () => {
    const result = await finishPendingRecipeVariants();
    expect(result.status).toBe('success');
    expect(result.summary).toContain('No incomplete recipe drafts');
    expect(generateVariant).not.toHaveBeenCalled();
  });

  it('fills in every pending diet and writes the completed draft back', async () => {
    seedDraft('recipe1', recipeDraft());
    generateVariant.mockImplementation(async (diet: string) => ({
      diet,
      ingredients: [{ item: `${diet} substitute` }],
      steps: baseSteps,
      rejected: false,
    }));

    const result = await finishPendingRecipeVariants();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('Weeknight Casserole');
    expect(generateVariant).toHaveBeenCalledTimes(ALL_SUBSTITUTABLE_DIETS.length);

    const written = JSON.parse(state.files.get('draft/post-recipe1')!.get('.drafts/recipe1.json')!);
    expect(written.variants).toHaveLength(1 + ALL_SUBSTITUTABLE_DIETS.length);
    expect(written.variants.map((v: { diet: string }) => v.diet)).toEqual(['original', ...ALL_SUBSTITUTABLE_DIETS]);
    const vegan = written.variants.find((v: { diet: string }) => v.diet === 'vegan');
    expect(vegan.ingredients).toEqual([{ item: 'vegan substitute' }]);
  });

  it('reports partial when some diets are still flagged after retrying, and preserves already-resolved diets from a prior tick', async () => {
    seedDraft(
      'recipe1',
      recipeDraft({
        variants: [
          { diet: 'original', ingredients: baseIngredients, steps: baseSteps },
          { diet: 'gluten-free', ingredients: [{ item: 'already resolved' }], steps: baseSteps },
        ],
      }),
    );
    generateVariant.mockImplementation(async (diet: string) =>
      diet === 'vegan'
        ? { diet, ingredients: baseIngredients, steps: baseSteps, notes: MANUAL_PASS_SENTINEL, rejected: true }
        : { diet, ingredients: [{ item: `${diet} substitute` }], steps: baseSteps, rejected: false },
    );

    const result = await finishPendingRecipeVariants();

    expect(result.status).toBe('partial');
    expect(result.summary).toContain('vegan');
    // gluten-free was already resolved before this tick, so it should not have been re-attempted
    expect(generateVariant).not.toHaveBeenCalledWith('gluten-free', expect.anything(), expect.anything(), expect.anything());

    const written = JSON.parse(state.files.get('draft/post-recipe1')!.get('.drafts/recipe1.json')!);
    const glutenFree = written.variants.find((v: { diet: string }) => v.diet === 'gluten-free');
    expect(glutenFree.ingredients).toEqual([{ item: 'already resolved' }]);
    const vegan = written.variants.find((v: { diet: string }) => v.diet === 'vegan');
    expect(vegan.notes).toBe(MANUAL_PASS_SENTINEL);
  });
});
