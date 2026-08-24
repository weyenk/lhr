# Recipe Variant Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly, unattended pipeline that pulls a recipe from TheMealDB, generates 8
dietary variants (original + 7 substitutions) via a curated table + LLM fallback, drafts an
LLM-written narrative intro, and lands the whole bundle as a draft post through the existing
draft/preview/publish flow — plus the `RecipeVariantTabs` UI to browse the 8 variants on a
published post.

**Architecture:** New pure-logic `src/` modules in `mcp-server` (`themealdb.ts`,
`dietSubstitutions.ts`, `narrative.ts`, `openrouter.ts`, `generateWeeklyVariantRecipe.ts`) are
unit/integration tested in isolation, then wired together by a thin, untested CLI script
(`scripts/generate-weekly-variant-recipe.ts`) — mirroring the existing
`backfillIngredientLinks.ts` (tested logic) / `scripts/backfill-ingredient-links.ts` (thin
wrapper) split. Schema changes flow from `packages/schemas` (published post) into
`mcp-server/src/drafts.ts` (draft mirror) exactly as today's `ingredients`/`steps` fields do. A
new Astro component renders the variant tabs; `RecipeLayout.astro` swaps to it only when
`data.variants` is present, leaving the no-variants render path byte-for-byte unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, Astro 5 (Container API for component/layout tests),
Octokit (existing `github.ts`), OpenRouter free-tier chat completions API via native `fetch`
(Node 24), TheMealDB free JSON API via native `fetch`.

**Spec:** [docs/superpowers/specs/active/2026-08-24-recipe-variant-generator-design.md](../specs/active/2026-08-24-recipe-variant-generator-design.md)

## Global Constraints

- Constitution rule 1: a post never goes live without the author's explicit confirmation — this
  pipeline only ever creates a **draft** via the existing `createDraft`/`confirm_and_publish`
  path; nothing here auto-publishes.
- Constitution rule 4: in-progress drafts/runs are never silently discarded on error — a failed
  variant is flagged in the draft (`notes: "couldn't generate — needs manual pass"`), never
  dropped; a failed run logs and exits without a partial draft.
- The 8 diet values, exact strings: `original`, `gluten-free`, `vegan`, `vegetarian`,
  `pescatarian`, `low-carb`, `low-salt`, `low-fat`.
- No nutritional computation — substitutions are heuristic (table + LLM), never macro/calorie/mg
  calculations.
- TheMealDB free shared test key (`1`) only — no paid tier.
- No re-hosting of TheMealDB's `strMealThumb` — the draft's photo is the direct source URL.
- No on-demand single-recipe MCP tool and no shared orchestrator/scheduler runner — this phase is
  the standalone weekly script only, invoked by the user's own `cron`/`launchd` entry.
- Default OpenRouter model: `meta-llama/llama-3.3-70b-instruct:free`, overridable via
  `OPENROUTER_MODEL` env var; `OPENROUTER_API_KEY` is required (via `requireEnv`, matching
  `src/blob.ts`'s existing pattern — never silently defaulted).
- MCP tool names/contracts are the established interface (RULES.md #3) — this plan adds no new
  MCP tool; the pipeline is a standalone script reusing `drafts.ts` directly.

---

## Task 1: `recipeVariantSchema` and post-schema fields

**Files:**
- Modify: `packages/schemas/src/index.ts`
- Test: `mcp-server/tests/schemas.test.ts` (new — see note below)

**Note on test location:** `packages/schemas` has no Vitest setup of its own (no `test` script,
no `vitest` devDependency, no existing test files). `mcp-server` already depends on
`@lhr/schemas` and has Vitest configured, and its `tests/integration/fullFlow.test.ts` already
imports `postSchema` from `@lhr/schemas` directly. Adding a new test runner just for this one
schema file isn't worth it — the tests live in `mcp-server/tests/schemas.test.ts` instead,
importing from `@lhr/schemas`, consistent with that existing precedent.

**Interfaces:**
- Produces: `recipeVariantSchema: ZodObject` — `{ diet: 'original'|'gluten-free'|'vegan'|'vegetarian'|'pescatarian'|'low-carb'|'low-salt'|'low-fat', ingredients: {item: string, amount?: string}[] (min 1), steps: string[] (min 1), notes?: string }`. `RecipeVariantData = z.infer<typeof recipeVariantSchema>`. `recipePostSchema` gains `variants?: RecipeVariantData[]` and `sourceMealDbId?: string`. Every later task that touches variants imports `recipeVariantSchema`/`RecipeVariantData` from `@lhr/schemas`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp-server/tests/schemas.test.ts
import { describe, expect, it } from 'vitest';
import { recipeVariantSchema, postSchema } from '@lhr/schemas';

describe('recipeVariantSchema', () => {
  it('accepts a valid variant', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'vegan',
      ingredients: [{ item: 'Plant-based ground meat', amount: '1 lb' }],
      steps: ['Brown the plant-based meat.'],
      notes: 'Swapped ground beef for plant-based ground meat',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a variant with no ingredients', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'vegan',
      ingredients: [],
      steps: ['Brown the plant-based meat.'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variant with no steps', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'vegan',
      ingredients: [{ item: 'Plant-based ground meat' }],
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid diet enum value', () => {
    const result = recipeVariantSchema.safeParse({
      diet: 'keto',
      ingredients: [{ item: 'Plant-based ground meat' }],
      steps: ['Brown it.'],
    });
    expect(result.success).toBe(false);
  });
});

describe('recipePostSchema variants/sourceMealDbId', () => {
  const baseRecipe = {
    type: 'recipe' as const,
    title: 'Teriyaki Chicken Casserole',
    date: '2026-01-01',
    coverPhoto: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
    coverPhotoAlt: 'Teriyaki chicken casserole',
    kitchenwareIds: [],
    affiliateLinkIds: [],
    ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
    steps: ['Preheat oven to 350F.'],
  };

  it('accepts a recipe post with variants and a sourceMealDbId', () => {
    const result = postSchema.safeParse({
      ...baseRecipe,
      sourceMealDbId: '52772',
      variants: [
        { diet: 'original', ingredients: baseRecipe.ingredients, steps: baseRecipe.steps },
        { diet: 'vegan', ingredients: [{ item: 'Plant-based chicken', amount: '2 lbs' }], steps: ['Preheat oven to 350F.'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a recipe post with neither field (hand-authored posts keep working)', () => {
    const result = postSchema.safeParse(baseRecipe);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/schemas.test.ts`
Expected: FAIL — `recipeVariantSchema` is not exported from `@lhr/schemas` yet (or the
`variants`/`sourceMealDbId` cases fail because Zod strips/rejects the unknown keys' expectations).

- [ ] **Step 3: Implement the schema changes**

```ts
// packages/schemas/src/index.ts
// ... existing basePostFields unchanged ...

export const recipeVariantSchema = z.object({
  diet: z.enum([
    'original', 'gluten-free', 'vegan', 'vegetarian',
    'pescatarian', 'low-carb', 'low-salt', 'low-fat',
  ]),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).min(1),
  steps: z.array(z.string()).min(1),
  notes: z.string().optional(),
});

export const recipePostSchema = z.object({
  type: z.literal('recipe'),
  ...basePostFields,
  yields: z.number().int().positive().optional(),
  yieldsUnit: z.string().optional(),
  prepMinutes: z.number().int().positive().optional(),
  cookMinutes: z.number().int().positive().optional(),
  ingredients: z
    .array(
      z.object({
        item: z.string(),
        amount: z.string().optional(),
      }),
    )
    .min(1),
  steps: z.array(z.string()).min(1),
  variants: z.array(recipeVariantSchema).optional(),
  sourceMealDbId: z.string().optional(),
});

// ... articlePostSchema, postSchema, productSchema, affiliateLinkSchema,
//     ingredientLinkSchema, setSchema unchanged ...

export type PostData = z.infer<typeof postSchema>;
export type ProductData = z.infer<typeof productSchema>;
export type AffiliateLinkData = z.infer<typeof affiliateLinkSchema>;
export type IngredientLinkData = z.infer<typeof ingredientLinkSchema>;
export type SetData = z.infer<typeof setSchema>;
export type RecipeVariantData = z.infer<typeof recipeVariantSchema>;
```

- [ ] **Step 4: Rebuild `@lhr/schemas` so the workspace symlink picks up the new export**

Run: `npm run build --workspace=@lhr/schemas`
Expected: succeeds with no output (writes `packages/schemas/dist/`, which is gitignored and
rebuilt by every environment via the root `postinstall` script — nothing to commit here beyond
`src/index.ts`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/schemas.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/index.ts mcp-server/tests/schemas.test.ts
git commit -m "Add recipeVariantSchema and variants/sourceMealDbId fields to recipePostSchema"
```

---

## Task 2: Draft schema mirror + narrative body / variants frontmatter plumbing

**Files:**
- Modify: `mcp-server/src/drafts.ts`
- Modify: `mcp-server/src/render.ts`
- Test: `mcp-server/tests/drafts.test.ts` (extend)
- Test: `mcp-server/tests/render.test.ts` (extend)

**Interfaces:**
- Consumes: `recipeVariantSchema` from `@lhr/schemas` (Task 1).
- Produces: `draftPostSchema` gains `variants: RecipeVariantData[]` (default `[]`),
  `sourceMealDbId?: string`, `narrativeBody?: string`. `buildPostFrontmatter(draft: DraftPost): Record<string, unknown>` includes `variants`/`sourceMealDbId` in the frontmatter object when
  present (recipe posts only). `renderPostMdx(draft: DraftPost): string` appends `narrativeBody`
  as MDX body prose below the frontmatter fence when present. These are the exact names later
  tasks (the pipeline script) construct a `DraftPost` against.

- [ ] **Step 1: Write the failing tests**

Add to `mcp-server/tests/drafts.test.ts` (new `describe` block; keep existing tests as-is —
`emptyRecipeDraft` doesn't need the new optional fields added since they're all optional/defaulted):

```ts
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
```

You'll need `draftSchema` imported in that test file already — it isn't currently. Add it to the
existing destructured import at the top:

```ts
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
```

Add to `mcp-server/tests/render.test.ts` (new `it` blocks inside the existing `describe('renderPostMdx', ...)`):

```ts
  it('appends narrativeBody as MDX body prose below the frontmatter fence when present', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Teriyaki Chicken Casserole',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven to 350F.'],
      sections: [],
      photos: [{ url: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg' }],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [],
      narrativeBody: 'Once upon a weeknight, dinner needed to be easy.',
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toMatch(/---\n\nOnce upon a weeknight, dinner needed to be easy\.\n$/);
  });

  it('writes variants and sourceMealDbId into recipe frontmatter when present', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Teriyaki Chicken Casserole',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven to 350F.'],
      sections: [],
      photos: [{ url: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg' }],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [
        { diet: 'original', ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }], steps: ['Preheat oven to 350F.'] },
      ],
      sourceMealDbId: '52772',
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('sourceMealDbId: \'52772\'');
    expect(mdx).toContain('diet: original');
  });

  it('omits variants/sourceMealDbId/narrativeBody from output when absent (unchanged behavior)', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Marinate overnight.'],
      sections: [],
      photos: [{ url: 'https://blob.vercel-storage.com/posts/a.jpg', caption: 'Jerk chicken' }],
      kitchenwareIds: ['coastal-blue-platter'],
      affiliateLinkIds: ['jerk-seasoning'],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
      variants: [],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).not.toContain('variants:');
    expect(mdx).not.toContain('sourceMealDbId:');
    expect(mdx.endsWith('---\n')).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run tests/drafts.test.ts tests/render.test.ts`
Expected: FAIL — `draftSchema` parse throws or the new fields/frontmatter/body assertions don't
match (draft schema doesn't have the fields yet; `renderPostMdx` doesn't append a body).

- [ ] **Step 3: Implement the draft schema mirror**

```ts
// mcp-server/src/drafts.ts
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { recipeVariantSchema } from '@lhr/schemas';
import { createBranch, deleteBranch, getFile, listBranches, putFile, type GitHubClient } from './github.js';

export const draftPostSchema = z.object({
  kind: z.literal('post'),
  postType: z.enum(['recipe', 'article']),
  title: z.string().default(''),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).default([]),
  steps: z.array(z.string()).default([]),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
  photos: z.array(z.object({ url: z.string().url(), caption: z.string().optional() })).default([]),
  kitchenwareIds: z.array(z.string()).default([]),
  affiliateLinkIds: z.array(z.string()).default([]),
  pendingAffiliateLinks: z
    .array(z.object({ id: z.string(), label: z.string(), url: z.string().url(), tag: z.string() }))
    .default([]),
  pendingIngredientLinks: z.array(z.object({ ingredient: z.string(), affiliateLinkId: z.string() })).default([]),
  variants: z.array(recipeVariantSchema).default([]),
  sourceMealDbId: z.string().optional(),
  narrativeBody: z.string().optional(),
});

// ... rest of drafts.ts unchanged (draftSetSchema, draftSchema, generateDraftId,
//     createDraft, readDraft, writeDraft, listDrafts, deleteDraftBranch, findDraftKind,
//     summarizeDraftPost) ...
```

- [ ] **Step 4: Implement the frontmatter/body plumbing**

```ts
// mcp-server/src/render.ts
import yaml from 'js-yaml';
import type { DraftPost } from './drafts.js';

export function buildPostFrontmatter(draft: DraftPost): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    type: draft.postType,
    title: draft.title,
    date: new Date().toISOString().slice(0, 10),
    coverPhoto: draft.photos[0]?.url ?? '',
    coverPhotoAlt: draft.photos[0]?.caption ?? draft.title,
    kitchenwareIds: draft.kitchenwareIds,
    affiliateLinkIds: [...draft.affiliateLinkIds, ...draft.pendingAffiliateLinks.map((p) => p.id)],
  };

  if (draft.postType === 'recipe') {
    frontmatter.ingredients = draft.ingredients;
    frontmatter.steps = draft.steps;
    if (draft.variants.length > 0) frontmatter.variants = draft.variants;
    if (draft.sourceMealDbId) frontmatter.sourceMealDbId = draft.sourceMealDbId;
  } else {
    frontmatter.sections = draft.sections;
  }

  return frontmatter;
}

export function renderFrontmatterYaml(frontmatter: Record<string, unknown>): string {
  return `---\n${yaml.dump(frontmatter)}---\n`;
}

export function renderPostMdx(draft: DraftPost): string {
  const frontmatterBlock = renderFrontmatterYaml(buildPostFrontmatter(draft));
  return draft.narrativeBody ? `${frontmatterBlock}\n${draft.narrativeBody}\n` : frontmatterBlock;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run tests/drafts.test.ts tests/render.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/drafts.ts mcp-server/src/render.ts mcp-server/tests/drafts.test.ts mcp-server/tests/render.test.ts
git commit -m "Mirror variants/sourceMealDbId/narrativeBody onto draftPostSchema and render.ts"
```

---

## Task 3: OpenRouter LLM helper

**Files:**
- Create: `mcp-server/src/openrouter.ts`
- Test: `mcp-server/tests/openrouter.test.ts`

**Interfaces:**
- Consumes: `requireEnv` from `./blob.js` (existing).
- Produces: `callOpenRouter(messages: OpenRouterMessage[]): Promise<string>` and
  `OpenRouterMessage = { role: 'system' | 'user'; content: string }`. Tasks 4 and 5 both call
  this and mock it in their tests via `vi.mock('../src/openrouter', ...)`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp-server/tests/openrouter.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callOpenRouter } from '../src/openrouter';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_MODEL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('callOpenRouter', () => {
  it('posts the messages to OpenRouter and returns the reply content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'roasted beet slices' } }] }),
    }) as unknown as typeof fetch;

    const result = await callOpenRouter([{ role: 'user', content: 'Substitute: bacon' }]);

    expect(result).toBe('roasted beet slices');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(body.messages).toEqual([{ role: 'user', content: 'Substitute: bacon' }]);
  });

  it('uses OPENROUTER_MODEL when set instead of the default', async () => {
    process.env.OPENROUTER_MODEL = 'some/other-model:free';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    }) as unknown as typeof fetch;

    await callOpenRouter([{ role: 'user', content: 'hi' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('some/other-model:free');
  });

  it('throws when OPENROUTER_API_KEY is not set', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws when the request is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/429/);
  });

  it('throws when the response has no message content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    }) as unknown as typeof fetch;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no message content/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/openrouter.test.ts`
Expected: FAIL — `../src/openrouter` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// mcp-server/src/openrouter.ts
import { requireEnv } from './blob.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

export async function callOpenRouter(messages: OpenRouterMessage[]): Promise<string> {
  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter response had no message content');
  }
  return content;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/openrouter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/openrouter.ts mcp-server/tests/openrouter.test.ts
git commit -m "Add shared OpenRouter chat-completions helper"
```

---

## Task 4: Diet substitution engine

**Files:**
- Create: `mcp-server/src/dietSubstitutions.ts`
- Test: `mcp-server/tests/dietSubstitutions.test.ts`

**Interfaces:**
- Consumes: `normalizeIngredient(item: string): string` from `./normalizeIngredient.js`
  (existing); `callOpenRouter` from `./openrouter.js` (Task 3); `RecipeVariantData` from
  `@lhr/schemas` (Task 1).
- Produces: `ALL_SUBSTITUTABLE_DIETS: SubstitutableDiet[]` (the 7 non-`'original'` diets),
  `generateAllVariants(originalIngredients: RecipeIngredient[], originalSteps: string[]): Promise<{ variants: RecipeVariantData[]; flaggedDiets: SubstitutableDiet[] }>` — `variants` always
  has exactly 8 entries (`'original'` first, then the 7 in `ALL_SUBSTITUTABLE_DIETS` order).
  This is the function Task 7's pipeline script calls directly.

- [ ] **Step 1: Write the failing tests**

```ts
// mcp-server/tests/dietSubstitutions.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const callOpenRouter = vi.fn();
vi.mock('../src/openrouter', () => ({
  callOpenRouter: (...args: unknown[]) => callOpenRouter(...args),
}));

const {
  substituteIngredient,
  rewriteSteps,
  generateVariant,
  generateAllVariants,
  ALL_SUBSTITUTABLE_DIETS,
} = await import('../src/dietSubstitutions');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('substituteIngredient', () => {
  it('uses the substitution table for a known ingredient without calling the LLM', async () => {
    const result = await substituteIngredient({ item: 'All-purpose flour', amount: '2 cups' }, 'gluten-free');
    expect(result).toEqual({
      item: '1:1 gluten-free flour blend',
      amount: '2 cups',
      changed: true,
      note: 'Swapped all-purpose flour for 1:1 gluten-free flour blend',
    });
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('matches the spec examples: butter/vegan, heavy cream/low-fat, soy sauce/low-salt', async () => {
    expect((await substituteIngredient({ item: 'Butter' }, 'vegan')).item).toBe('vegan butter or coconut oil');
    expect((await substituteIngredient({ item: 'Heavy cream' }, 'low-fat')).item).toBe('evaporated skim milk');
    expect((await substituteIngredient({ item: 'Soy sauce' }, 'low-salt')).item).toBe(
      'low-sodium soy sauce or coconut aminos',
    );
  });

  it('falls back to an LLM call for an ingredient not in the table', async () => {
    callOpenRouter.mockResolvedValue('roasted beet slices');
    const result = await substituteIngredient({ item: 'Smoked salmon' }, 'vegan');
    expect(result).toEqual({
      item: 'roasted beet slices',
      amount: undefined,
      changed: true,
      note: 'Swapped smoked salmon for roasted beet slices',
    });
    expect(callOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('returns the ingredient unchanged when the LLM says no substitution is needed', async () => {
    callOpenRouter.mockResolvedValue('no substitution needed');
    const result = await substituteIngredient({ item: 'Salt' }, 'vegan');
    expect(result).toEqual({ item: 'Salt', amount: undefined, changed: false });
  });
});

describe('rewriteSteps', () => {
  it('parses a valid JSON array response into rewritten steps', async () => {
    callOpenRouter.mockResolvedValue('["Brown the plant-based meat.", "Simmer for 10 minutes."]');
    const result = await rewriteSteps(
      ['Brown the beef.', 'Simmer for 10 minutes.'],
      [{ from: 'beef', to: 'plant-based meat' }],
      'vegan',
    );
    expect(result).toEqual(['Brown the plant-based meat.', 'Simmer for 10 minutes.']);
  });

  it('returns the original steps unchanged and skips the LLM call when there are no substitutions', async () => {
    const result = await rewriteSteps(['Bake at 350F.'], [], 'vegan');
    expect(result).toEqual(['Bake at 350F.']);
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('throws when the LLM response is not valid JSON (sanity guard)', async () => {
    callOpenRouter.mockResolvedValue('not json');
    await expect(
      rewriteSteps(['Bake it.'], [{ from: 'a', to: 'b' }], 'vegan'),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the LLM returns an empty array (sanity guard)', async () => {
    callOpenRouter.mockResolvedValue('[]');
    await expect(
      rewriteSteps(['Bake it.'], [{ from: 'a', to: 'b' }], 'vegan'),
    ).rejects.toThrow(/non-empty array/);
  });
});

describe('generateVariant', () => {
  it('retries once on an LLM failure and succeeds on the second attempt', async () => {
    callOpenRouter.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('["Mix the flour differently."]');

    const result = await generateVariant(
      'gluten-free',
      [{ item: 'All-purpose flour', amount: '2 cups' }],
      ['Mix the flour.'],
    );

    expect(result.rejected).toBe(false);
    expect(result.steps).toEqual(['Mix the flour differently.']);
    expect(callOpenRouter).toHaveBeenCalledTimes(2);
  });

  it('rejects the variant and falls back to the original ingredients/steps after two failed attempts', async () => {
    callOpenRouter.mockRejectedValue(new Error('timeout'));
    const original = [{ item: 'Smoked salmon' }];
    const originalSteps = ['Grill the salmon.'];

    const result = await generateVariant('vegan', original, originalSteps);

    expect(result.rejected).toBe(true);
    expect(result.ingredients).toEqual(original);
    expect(result.steps).toEqual(originalSteps);
    expect(result.notes).toBe("couldn't generate — needs manual pass");
  });
});

describe('generateAllVariants', () => {
  it('produces 8 variants (original + 7 diets) and flags any diet whose step-rewrite fails', async () => {
    callOpenRouter.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const systemPrompt = messages[0].content;
      const userPrompt = messages[messages.length - 1].content;
      if (systemPrompt.startsWith('You rewrite recipe steps')) {
        if (userPrompt.includes('Diet: low-fat')) throw new Error('simulated failure');
        return JSON.stringify(['Brown the beef.']);
      }
      return 'no substitution needed';
    });

    const { variants, flaggedDiets } = await generateAllVariants(
      [{ item: 'Ground beef', amount: '1 lb' }],
      ['Brown the beef.'],
    );

    expect(variants).toHaveLength(8);
    expect(variants.map((v) => v.diet)).toEqual(['original', ...ALL_SUBSTITUTABLE_DIETS]);
    expect(flaggedDiets).toEqual(['low-fat']);
    const lowFatVariant = variants.find((v) => v.diet === 'low-fat')!;
    expect(lowFatVariant.notes).toBe("couldn't generate — needs manual pass");
    const veganVariant = variants.find((v) => v.diet === 'vegan')!;
    expect(veganVariant.notes).not.toBe("couldn't generate — needs manual pass");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run tests/dietSubstitutions.test.ts`
Expected: FAIL — `../src/dietSubstitutions` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// mcp-server/src/dietSubstitutions.ts
import { normalizeIngredient } from './normalizeIngredient.js';
import { callOpenRouter } from './openrouter.js';
import type { RecipeVariantData } from '@lhr/schemas';

export type SubstitutableDiet = Exclude<RecipeVariantData['diet'], 'original'>;

export interface RecipeIngredient {
  item: string;
  amount?: string;
}

export const ALL_SUBSTITUTABLE_DIETS: SubstitutableDiet[] = [
  'gluten-free',
  'vegan',
  'vegetarian',
  'pescatarian',
  'low-carb',
  'low-salt',
  'low-fat',
];

const SUBSTITUTION_TABLE: Record<SubstitutableDiet, Record<string, string>> = {
  'gluten-free': {
    'all-purpose flour': '1:1 gluten-free flour blend',
    'soy sauce': 'tamari or gluten-free soy sauce',
  },
  vegan: {
    butter: 'vegan butter or coconut oil',
    'heavy cream': 'full-fat coconut cream',
    milk: 'unsweetened oat milk',
    egg: 'flax egg (1 tbsp ground flaxseed + 3 tbsp water)',
    'ground beef': 'plant-based ground meat',
    'cheddar cheese': 'dairy-free cheddar-style shred',
  },
  vegetarian: {
    'ground beef': 'plant-based ground meat',
    'beef broth': 'vegetable broth',
    bacon: 'smoky tempeh strips',
  },
  pescatarian: {
    'ground beef': 'flaked white fish or plant-based ground meat',
    bacon: 'smoked salmon strips',
  },
  'low-carb': {
    'all-purpose flour': 'almond flour',
    potato: 'cauliflower',
    rice: 'cauliflower rice',
  },
  'low-salt': {
    'soy sauce': 'low-sodium soy sauce or coconut aminos',
    'beef broth': 'low-sodium beef broth',
    salt: 'a pinch of salt, to taste',
  },
  'low-fat': {
    'heavy cream': 'evaporated skim milk',
    butter: 'unsweetened applesauce (baking) or a light cooking spray (sautéing)',
    'ground beef': 'extra-lean ground beef or ground turkey breast',
  },
};

export interface SubstitutedIngredient extends RecipeIngredient {
  changed: boolean;
  note?: string;
}

export async function substituteIngredient(
  ingredient: RecipeIngredient,
  diet: SubstitutableDiet,
): Promise<SubstitutedIngredient> {
  const normalized = normalizeIngredient(ingredient.item);
  const tableMatch = SUBSTITUTION_TABLE[diet][normalized];
  if (tableMatch) {
    return {
      item: tableMatch,
      amount: ingredient.amount,
      changed: true,
      note: `Swapped ${normalized} for ${tableMatch}`,
    };
  }

  const content = await callOpenRouter([
    {
      role: 'system',
      content:
        'You substitute recipe ingredients for a specific diet. Reply with ONLY the substitute ' +
        'ingredient name, or the exact text "no substitution needed" if the ingredient is already ' +
        'fine for that diet. No punctuation, no explanation.',
    },
    { role: 'user', content: `Ingredient: "${normalized}"\nDiet: ${diet}` },
  ]);

  const suggestion = content.trim();
  if (!suggestion || suggestion.toLowerCase() === 'no substitution needed') {
    return { item: ingredient.item, amount: ingredient.amount, changed: false };
  }
  return {
    item: suggestion,
    amount: ingredient.amount,
    changed: true,
    note: `Swapped ${normalized} for ${suggestion}`,
  };
}

export async function rewriteSteps(
  originalSteps: string[],
  changes: { from: string; to: string }[],
  diet: SubstitutableDiet,
): Promise<string[]> {
  if (changes.length === 0) return originalSteps;

  const changeList = changes.map((c) => `- "${c.from}" -> "${c.to}"`).join('\n');
  const content = await callOpenRouter([
    {
      role: 'system',
      content:
        'You rewrite recipe steps so they reflect ingredient substitutions. Reply with ONLY a JSON ' +
        'array of strings, one per input step, in the same order, with no other text.',
    },
    {
      role: 'user',
      content: `Diet: ${diet}\nSubstitutions:\n${changeList}\n\nSteps:\n${JSON.stringify(originalSteps)}`,
    },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('rewriteSteps: LLM response was not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((s) => typeof s === 'string')) {
    throw new Error('rewriteSteps: LLM response was not a non-empty array of strings');
  }
  return parsed;
}

export interface RecipeVariantResult {
  diet: SubstitutableDiet;
  ingredients: RecipeIngredient[];
  steps: string[];
  notes?: string;
  rejected: boolean;
}

async function buildVariantOnce(
  diet: SubstitutableDiet,
  originalIngredients: RecipeIngredient[],
  originalSteps: string[],
): Promise<{ ingredients: RecipeIngredient[]; steps: string[]; notes?: string }> {
  const substituted = await Promise.all(originalIngredients.map((ing) => substituteIngredient(ing, diet)));

  const changes = originalIngredients
    .map((original, i) => ({ from: original.item, to: substituted[i].item, changed: substituted[i].changed }))
    .filter((c) => c.changed);

  const steps = await rewriteSteps(originalSteps, changes, diet);
  if (steps.length === 0) throw new Error('buildVariantOnce: rewriteSteps returned no steps');

  const ingredients = substituted.map(({ item, amount }) => ({ item, amount }));
  if (ingredients.length === 0) throw new Error('buildVariantOnce: no ingredients produced');

  const notes = changes.length > 0 ? changes.map((c) => `Swapped ${c.from} for ${c.to}`).join('; ') : undefined;

  return { ingredients, steps, notes };
}

export async function generateVariant(
  diet: SubstitutableDiet,
  originalIngredients: RecipeIngredient[],
  originalSteps: string[],
): Promise<RecipeVariantResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const built = await buildVariantOnce(diet, originalIngredients, originalSteps);
      return { diet, ...built, rejected: false };
    } catch {
      if (attempt === 1) {
        return {
          diet,
          ingredients: originalIngredients,
          steps: originalSteps,
          notes: "couldn't generate — needs manual pass",
          rejected: true,
        };
      }
    }
  }
  throw new Error('unreachable');
}

export interface DietPipelineResult {
  variants: RecipeVariantData[];
  flaggedDiets: SubstitutableDiet[];
}

export async function generateAllVariants(
  originalIngredients: RecipeIngredient[],
  originalSteps: string[],
): Promise<DietPipelineResult> {
  const original: RecipeVariantData = {
    diet: 'original',
    ingredients: originalIngredients,
    steps: originalSteps,
  };

  const results = await Promise.all(
    ALL_SUBSTITUTABLE_DIETS.map((diet) => generateVariant(diet, originalIngredients, originalSteps)),
  );

  const variants: RecipeVariantData[] = [
    original,
    ...results.map(({ rejected: _rejected, ...rest }) => rest),
  ];
  const flaggedDiets = results.filter((r) => r.rejected).map((r) => r.diet);

  return { variants, flaggedDiets };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run tests/dietSubstitutions.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/dietSubstitutions.ts mcp-server/tests/dietSubstitutions.test.ts
git commit -m "Add diet substitution engine with table lookup, LLM fallback, and sanity guard"
```

---

## Task 5: Narrative generation

**Files:**
- Create: `mcp-server/src/narrative.ts`
- Test: `mcp-server/tests/narrative.test.ts`

**Interfaces:**
- Consumes: `callOpenRouter` from `./openrouter.js` (Task 3).
- Produces: `generateNarrative(source: { title: string; cuisine: string; category: string }): Promise<string>` — never throws; on any failure or empty response returns the fixed fallback
  string `"[Narrative draft pending — auto-generation failed]"`. Task 7's pipeline script calls
  this directly and assigns the result to `narrativeBody`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp-server/tests/narrative.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const callOpenRouter = vi.fn();
vi.mock('../src/openrouter', () => ({
  callOpenRouter: (...args: unknown[]) => callOpenRouter(...args),
}));

const { generateNarrative } = await import('../src/narrative');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateNarrative', () => {
  it('returns the trimmed LLM narrative on success', async () => {
    callOpenRouter.mockResolvedValue('  Once upon a weeknight, dinner needed to be easy.  ');
    const result = await generateNarrative({ title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' });
    expect(result).toBe('Once upon a weeknight, dinner needed to be easy.');
  });

  it('passes the recipe title/cuisine/category to the LLM call', async () => {
    callOpenRouter.mockResolvedValue('A story.');
    await generateNarrative({ title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' });
    const userMessage = callOpenRouter.mock.calls[0][0][1].content;
    expect(userMessage).toContain('Teriyaki Chicken Casserole');
    expect(userMessage).toContain('Japanese');
    expect(userMessage).toContain('Chicken');
  });

  it('falls back to the placeholder narrative when the LLM call fails', async () => {
    callOpenRouter.mockRejectedValue(new Error('timeout'));
    const result = await generateNarrative({ title: 'x', cuisine: 'y', category: 'z' });
    expect(result).toBe('[Narrative draft pending — auto-generation failed]');
  });

  it('falls back to the placeholder narrative when the LLM returns only whitespace', async () => {
    callOpenRouter.mockResolvedValue('   ');
    const result = await generateNarrative({ title: 'x', cuisine: 'y', category: 'z' });
    expect(result).toBe('[Narrative draft pending — auto-generation failed]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/narrative.test.ts`
Expected: FAIL — `../src/narrative` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// mcp-server/src/narrative.ts
import { callOpenRouter } from './openrouter.js';

export interface NarrativeSource {
  title: string;
  cuisine: string;
  category: string;
}

const FALLBACK_NARRATIVE = '[Narrative draft pending — auto-generation failed]';

export async function generateNarrative(source: NarrativeSource): Promise<string> {
  try {
    const content = await callOpenRouter([
      {
        role: 'system',
        content:
          'You write a short, story-style intro (2-4 paragraphs) for a recipe blog post, in a warm, ' +
          'personal, first-person voice. Do not include a title or headings, just the narrative prose.',
      },
      {
        role: 'user',
        content: `Recipe: "${source.title}"\nCuisine/region: ${source.cuisine}\nCategory: ${source.category}`,
      },
    ]);
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : FALLBACK_NARRATIVE;
  } catch {
    return FALLBACK_NARRATIVE;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/narrative.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/narrative.ts mcp-server/tests/narrative.test.ts
git commit -m "Add LLM narrative generation with a placeholder fallback on failure"
```

---

## Task 6: TheMealDB source module

**Files:**
- Create: `mcp-server/src/themealdb.ts`
- Test: `mcp-server/tests/themealdb.test.ts`

**Interfaces:**
- Produces: `SourceRecipe = { idMeal: string; title: string; cuisine: string; category: string; thumbnail: string; ingredients: RecipeIngredient[]; steps: string[] }`,
  `parseIngredients(meal: RawMealDbMeal): RecipeIngredient[]`,
  `splitInstructionsIntoSteps(instructions: string): string[]`,
  `rotationIndexForDate(date: Date): number`,
  `pickUnusedSourceRecipe(usedMealDbIds: Set<string>, options?: { rotation?: string[]; weekIndex?: number; maxCategoryAttempts?: number }): Promise<SourceRecipe | null>`. Task 7's pipeline
  module calls `pickUnusedSourceRecipe` directly and mocks the whole module in its own test.

- [ ] **Step 1: Write the failing tests**

```ts
// mcp-server/tests/themealdb.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseIngredients,
  splitInstructionsIntoSteps,
  rotationIndexForDate,
  pickUnusedSourceRecipe,
  CATEGORY_ROTATION,
} from '../src/themealdb';

describe('parseIngredients', () => {
  it('collects non-empty strIngredientN/strMeasureN pairs and stops at the first gap in neither', () => {
    const meal = {
      idMeal: '1',
      strMeal: 'Test',
      strCategory: 'Chicken',
      strArea: 'Japanese',
      strInstructions: 'Do it.',
      strMealThumb: 'https://example.com/x.jpg',
      strIngredient1: 'Chicken thighs',
      strMeasure1: '2 lbs',
      strIngredient2: 'Salt',
      strMeasure2: '',
      strIngredient3: '',
      strMeasure3: '1 tsp',
    } as Record<string, string>;

    expect(parseIngredients(meal)).toEqual([
      { item: 'Chicken thighs', amount: '2 lbs' },
      { item: 'Salt' },
    ]);
  });
});

describe('splitInstructionsIntoSteps', () => {
  it('splits on newlines when the instructions are already multi-line', () => {
    const steps = splitInstructionsIntoSteps('Preheat oven.\nBrown the beef.\n\nServe hot.');
    expect(steps).toEqual(['Preheat oven.', 'Brown the beef.', 'Serve hot.']);
  });

  it('strips a leading "STEP 1." style numbering prefix from each line', () => {
    const steps = splitInstructionsIntoSteps('STEP 1. Preheat oven.\nSTEP 2. Brown the beef.');
    expect(steps).toEqual(['Preheat oven.', 'Brown the beef.']);
  });

  it('falls back to sentence-splitting for a single unbroken paragraph', () => {
    const steps = splitInstructionsIntoSteps('Preheat the oven. Brown the beef. Serve hot.');
    expect(steps).toEqual(['Preheat the oven.', 'Brown the beef.', 'Serve hot.']);
  });
});

describe('rotationIndexForDate', () => {
  it('is stable within the same week and advances week over week', () => {
    const a = rotationIndexForDate(new Date('2026-08-24T10:00:00Z'));
    const b = rotationIndexForDate(new Date('2026-08-25T10:00:00Z'));
    const c = rotationIndexForDate(new Date('2026-08-31T10:00:00Z'));
    expect(a).toBe(b);
    expect(c).toBeGreaterThan(a);
  });
});

describe('pickUnusedSourceRecipe', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchSequence(responses: { url: RegExp; body: unknown }[]) {
    global.fetch = vi.fn(async (url: string) => {
      const match = responses.find((r) => r.url.test(url));
      if (!match) throw new Error(`Unexpected fetch to ${url}`);
      return { ok: true, json: async () => match.body } as Response;
    }) as unknown as typeof fetch;
  }

  it('returns a full SourceRecipe for the first unused candidate in the rotation category', async () => {
    mockFetchSequence([
      { url: /filter\.php\?c=Beef/, body: { meals: [{ idMeal: '52772', strMeal: 'Teriyaki Chicken Casserole' }] } },
      {
        url: /lookup\.php\?i=52772/,
        body: {
          meals: [
            {
              idMeal: '52772',
              strMeal: 'Teriyaki Chicken Casserole',
              strCategory: 'Chicken',
              strArea: 'Japanese',
              strInstructions: 'Preheat oven.\nBake it.',
              strMealThumb: 'https://example.com/x.jpg',
              strIngredient1: 'Chicken thighs',
              strMeasure1: '2 lbs',
            },
          ],
        },
      },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(), { rotation: ['Beef'], weekIndex: 0 });

    expect(result).toEqual({
      idMeal: '52772',
      title: 'Teriyaki Chicken Casserole',
      cuisine: 'Japanese',
      category: 'Chicken',
      thumbnail: 'https://example.com/x.jpg',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven.', 'Bake it.'],
    });
  });

  it('skips a candidate whose idMeal is already used and picks a different one', async () => {
    mockFetchSequence([
      {
        url: /filter\.php\?c=Beef/,
        body: { meals: [{ idMeal: '1', strMeal: 'Used' }, { idMeal: '2', strMeal: 'Unused' }] },
      },
      {
        url: /lookup\.php\?i=2/,
        body: {
          meals: [
            {
              idMeal: '2',
              strMeal: 'Unused',
              strCategory: 'Beef',
              strArea: 'American',
              strInstructions: 'Cook it.',
              strMealThumb: 'https://example.com/y.jpg',
              strIngredient1: 'Beef',
            },
          ],
        },
      },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(['1']), { rotation: ['Beef'], weekIndex: 0 });

    expect(result?.idMeal).toBe('2');
  });

  it('moves on to the next category when every candidate in the first is already used', async () => {
    mockFetchSequence([
      { url: /filter\.php\?c=Beef/, body: { meals: [{ idMeal: '1', strMeal: 'Used' }] } },
      { url: /filter\.php\?c=Chicken/, body: { meals: [{ idMeal: '2', strMeal: 'Fresh' }] } },
      {
        url: /lookup\.php\?i=2/,
        body: {
          meals: [
            {
              idMeal: '2',
              strMeal: 'Fresh',
              strCategory: 'Chicken',
              strArea: 'American',
              strInstructions: 'Cook it.',
              strMealThumb: 'https://example.com/z.jpg',
              strIngredient1: 'Chicken',
            },
          ],
        },
      },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(['1']), { rotation: ['Beef', 'Chicken'], weekIndex: 0 });

    expect(result?.idMeal).toBe('2');
  });

  it('returns null after exhausting all categories with no unused candidate', async () => {
    mockFetchSequence([
      { url: /filter\.php\?c=Beef/, body: { meals: [{ idMeal: '1', strMeal: 'Used' }] } },
      { url: /filter\.php\?c=Chicken/, body: { meals: [{ idMeal: '1', strMeal: 'Used' }] } },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(['1']), { rotation: ['Beef', 'Chicken'], weekIndex: 0 });

    expect(result).toBeNull();
  });

  it('exposes a non-empty default CATEGORY_ROTATION', () => {
    expect(CATEGORY_ROTATION.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npx vitest run tests/themealdb.test.ts`
Expected: FAIL — `../src/themealdb` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// mcp-server/src/themealdb.ts
export interface RecipeIngredient {
  item: string;
  amount?: string;
}

export interface SourceRecipe {
  idMeal: string;
  title: string;
  cuisine: string;
  category: string;
  thumbnail: string;
  ingredients: RecipeIngredient[];
  steps: string[];
}

export type RawMealDbMeal = Record<string, string | null | undefined> & {
  idMeal: string;
  strMeal: string;
  strCategory: string;
  strArea: string;
  strInstructions: string;
  strMealThumb: string;
};

const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';

export const CATEGORY_ROTATION = ['Beef', 'Chicken', 'Seafood', 'Vegetarian', 'Pasta', 'Vegan', 'Pork', 'Dessert'];

export function parseIngredients(meal: RawMealDbMeal): RecipeIngredient[] {
  const ingredients: RecipeIngredient[] = [];
  for (let i = 1; i <= 20; i++) {
    const item = meal[`strIngredient${i}`]?.trim();
    const amount = meal[`strMeasure${i}`]?.trim();
    if (!item) continue;
    ingredients.push(amount ? { item, amount } : { item });
  }
  return ingredients;
}

export function splitInstructionsIntoSteps(instructions: string): string[] {
  const byLine = instructions
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:STEP\s*)?\d+[.):]\s*/i, '').trim())
    .filter((line) => line.length > 0);
  if (byLine.length > 1) return byLine;

  return instructions
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toSourceRecipe(meal: RawMealDbMeal): SourceRecipe {
  return {
    idMeal: meal.idMeal,
    title: meal.strMeal,
    cuisine: meal.strArea,
    category: meal.strCategory,
    thumbnail: meal.strMealThumb,
    ingredients: parseIngredients(meal),
    steps: splitInstructionsIntoSteps(meal.strInstructions),
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MEALDB_BASE}${path}`);
  if (!response.ok) throw new Error(`TheMealDB request failed: ${response.status}`);
  return (await response.json()) as T;
}

export async function listCategoryMealIds(category: string): Promise<{ idMeal: string; strMeal: string }[]> {
  const data = await fetchJson<{ meals: { idMeal: string; strMeal: string }[] | null }>(
    `/filter.php?c=${encodeURIComponent(category)}`,
  );
  return data.meals ?? [];
}

export async function lookupMeal(idMeal: string): Promise<SourceRecipe> {
  const data = await fetchJson<{ meals: RawMealDbMeal[] | null }>(`/lookup.php?i=${encodeURIComponent(idMeal)}`);
  const meal = data.meals?.[0];
  if (!meal) throw new Error(`TheMealDB lookup found no meal for id ${idMeal}`);
  return toSourceRecipe(meal);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function rotationIndexForDate(date: Date): number {
  return Math.floor(date.getTime() / WEEK_MS);
}

export async function pickUnusedSourceRecipe(
  usedMealDbIds: Set<string>,
  options: { rotation?: string[]; weekIndex?: number; maxCategoryAttempts?: number } = {},
): Promise<SourceRecipe | null> {
  const rotation = options.rotation ?? CATEGORY_ROTATION;
  const weekIndex = options.weekIndex ?? rotationIndexForDate(new Date());
  const maxCategoryAttempts = options.maxCategoryAttempts ?? rotation.length;
  const start = weekIndex % rotation.length;

  for (let attempt = 0; attempt < maxCategoryAttempts; attempt++) {
    const category = rotation[(start + attempt) % rotation.length];
    const candidates = await listCategoryMealIds(category);
    const unused = candidates.filter((c) => !usedMealDbIds.has(c.idMeal));
    if (unused.length === 0) continue;
    const pick = unused[Math.floor(Math.random() * unused.length)];
    return lookupMeal(pick.idMeal);
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npx vitest run tests/themealdb.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/themealdb.ts mcp-server/tests/themealdb.test.ts
git commit -m "Add TheMealDB source module with category-rotated dedup pick"
```

---

## Task 7: Weekly pipeline orchestration + CLI script

**Files:**
- Create: `mcp-server/src/generateWeeklyVariantRecipe.ts`
- Create: `mcp-server/scripts/generate-weekly-variant-recipe.ts`
- Modify: `mcp-server/package.json` (add npm script)
- Modify: `.env.example`
- Modify: `docs/AUTHORING-SETUP.md`
- Test: `mcp-server/tests/integration/generateWeeklyVariantRecipe.test.ts`

**Interfaces:**
- Consumes: `listFiles`/`getFile` from `./github.js`, `parsePostFrontmatter` from
  `./backfillIngredientLinks.js`, `createDraft`/`DraftPost` from `./drafts.js`,
  `pickUnusedSourceRecipe` from `./themealdb.js` (Task 6), `generateAllVariants` from
  `./dietSubstitutions.js` (Task 4), `generateNarrative` from `./narrative.js` (Task 5),
  `postSchema` from `@lhr/schemas`.
- Produces: `loadExistingSourceMealDbIds(client: GitHubClient): Promise<Set<string>>` and
  `runWeeklyVariantRecipeGeneration(client: GitHubClient): Promise<WeeklyRunResult>` where
  `WeeklyRunResult = { skipped: boolean; draftId?: string; title?: string; sourceMealDbId?: string; flaggedDiets?: string[] }`. The CLI script is a thin, untested wrapper around
  `runWeeklyVariantRecipeGeneration`, matching `backfill-ingredient-links.ts`'s existing split of
  tested logic (`src/`) from an untested I/O entrypoint (`scripts/`).

- [ ] **Step 1: Write the failing integration test**

```ts
// mcp-server/tests/integration/generateWeeklyVariantRecipe.test.ts
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
  listBranches: vi.fn(async () => []),
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

  it('skips the run without creating a draft when no unused recipe can be found', async () => {
    pickUnusedSourceRecipe.mockResolvedValue(null);

    const result = await runWeeklyVariantRecipeGeneration(client);

    expect(result.skipped).toBe(true);
    expect(state.branches.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/integration/generateWeeklyVariantRecipe.test.ts`
Expected: FAIL — `../../src/generateWeeklyVariantRecipe` doesn't exist yet.

- [ ] **Step 3: Write the orchestration module**

```ts
// mcp-server/src/generateWeeklyVariantRecipe.ts
import { listFiles, getFile, type GitHubClient } from './github.js';
import { parsePostFrontmatter } from './backfillIngredientLinks.js';
import { createDraft, type DraftPost } from './drafts.js';
import { pickUnusedSourceRecipe } from './themealdb.js';
import { generateAllVariants } from './dietSubstitutions.js';
import { generateNarrative } from './narrative.js';
import { postSchema } from '@lhr/schemas';

export interface WeeklyRunResult {
  skipped: boolean;
  draftId?: string;
  title?: string;
  sourceMealDbId?: string;
  flaggedDiets?: string[];
}

export async function loadExistingSourceMealDbIds(client: GitHubClient): Promise<Set<string>> {
  const filenames = await listFiles(client, 'src/content/posts', 'main');
  const ids = new Set<string>();
  for (const filename of filenames.filter((f) => f.endsWith('.mdx'))) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;
    const frontmatter = parsePostFrontmatter(file.content);
    const parsed = postSchema.safeParse(frontmatter);
    if (parsed.success && parsed.data.type === 'recipe' && parsed.data.sourceMealDbId) {
      ids.add(parsed.data.sourceMealDbId);
    }
  }
  return ids;
}

export async function runWeeklyVariantRecipeGeneration(client: GitHubClient): Promise<WeeklyRunResult> {
  const usedIds = await loadExistingSourceMealDbIds(client);
  const source = await pickUnusedSourceRecipe(usedIds);
  if (!source) {
    return { skipped: true };
  }

  const { variants, flaggedDiets } = await generateAllVariants(source.ingredients, source.steps);
  const narrativeBody = await generateNarrative({
    title: source.title,
    cuisine: source.cuisine,
    category: source.category,
  });

  const initial: DraftPost = {
    kind: 'post',
    postType: 'recipe',
    title: source.title,
    ingredients: source.ingredients,
    steps: source.steps,
    sections: [],
    photos: [{ url: source.thumbnail, caption: source.title }],
    kitchenwareIds: [],
    affiliateLinkIds: [],
    pendingAffiliateLinks: [],
    pendingIngredientLinks: [],
    variants,
    sourceMealDbId: source.idMeal,
    narrativeBody,
  };

  const { id } = await createDraft(client, 'post', initial);

  return {
    skipped: false,
    draftId: id,
    title: source.title,
    sourceMealDbId: source.idMeal,
    flaggedDiets,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/integration/generateWeeklyVariantRecipe.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the thin CLI script (no test — matches `scripts/backfill-ingredient-links.ts`, which is also untested; the logic it wires together is fully covered above)**

```ts
// mcp-server/scripts/generate-weekly-variant-recipe.ts
import { createGitHubClient } from '../src/github.js';
import { runWeeklyVariantRecipeGeneration } from '../src/generateWeeklyVariantRecipe.js';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN env var is required (a GitHub personal access token with repo write access).');
    process.exit(1);
  }
  const client = createGitHubClient(token);

  const result = await runWeeklyVariantRecipeGeneration(client);

  if (result.skipped) {
    console.log('No unused TheMealDB recipe found this week after retrying across categories; skipping this run.');
    return;
  }

  console.log(`Created draft ${result.draftId}: "${result.title}" (source idMeal ${result.sourceMealDbId})`);
  if (result.flaggedDiets && result.flaggedDiets.length > 0) {
    console.log(`Diets needing a manual pass: ${result.flaggedDiets.join(', ')}`);
  } else {
    console.log('All 7 diet variants generated cleanly.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Add the npm script**

In `mcp-server/package.json`, add alongside the existing `backfill:ingredient-links` script:

```json
    "test": "vitest run",
    "backfill:ingredient-links": "tsx scripts/backfill-ingredient-links.ts",
    "generate:weekly-recipe": "tsx scripts/generate-weekly-variant-recipe.ts"
```

- [ ] **Step 7: Document the required env vars and the cron setup**

In `.env.example`, add:

```
GITHUB_TOKEN=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
```

In `docs/AUTHORING-SETUP.md`, append a new section at the end of the file:

```markdown

## Weekly recipe-variant generator (local cron)

`mcp-server/scripts/generate-weekly-variant-recipe.ts` runs standalone, outside the deployed
Vercel project — invoked by your own `cron`/`launchd` entry, not a hosted service. It needs two
env vars, set in a local `.env` file (or your shell) alongside the `mcp-server/` checkout:

- `GITHUB_TOKEN` — a GitHub personal access token with repo write access (same token used by
  `npm run backfill:ingredient-links`).
- `OPENROUTER_API_KEY` — an OpenRouter API key (free tier is sufficient; the default model is
  `meta-llama/llama-3.3-70b-instruct:free`). Override the model with `OPENROUTER_MODEL`.

Run it manually with:

```bash
cd mcp-server && npm run generate:weekly-recipe
```

Example weekly `crontab -e` entry (Sunday 6am, loading env vars from a local `.env` file):

```cron
0 6 * * 0 cd /path/to/lhr/mcp-server && env $(cat ../.env | xargs) npx tsx scripts/generate-weekly-variant-recipe.ts >> /tmp/weekly-recipe.log 2>&1
```

The script only ever creates a draft (via the same `createDraft` the manual authoring flow uses)
— it never publishes. Review and publish it like any other draft through the normal chat-based
authoring flow.
```

- [ ] **Step 8: Run the full mcp-server test suite to confirm nothing else broke**

Run: `cd mcp-server && npx vitest run`
Expected: PASS (all test files)

- [ ] **Step 9: Commit**

```bash
git add mcp-server/src/generateWeeklyVariantRecipe.ts mcp-server/scripts/generate-weekly-variant-recipe.ts mcp-server/package.json mcp-server/tests/integration/generateWeeklyVariantRecipe.test.ts .env.example docs/AUTHORING-SETUP.md
git commit -m "Add weekly recipe-variant generation pipeline (script + tested orchestration module)"
```

---

## Task 8: `RecipeVariantTabs` component + `RecipeLayout` wiring

**Files:**
- Create: `src/components/RecipeVariantTabs.astro`
- Modify: `src/layouts/RecipeLayout.astro`
- Test: `tests/components/recipe-variant-tabs.test.ts`
- Test: `tests/layouts/recipe-layout.test.ts`

**Interfaces:**
- Consumes: `data.variants` from `CollectionEntry<'posts'>` (Task 1's `recipePostSchema.variants`).
- Produces: `RecipeVariantTabs` Astro component with `Props = { variants: RecipeVariant[]; recipeMeta: string }` where `RecipeVariant = { diet: string; ingredients: { item: string; amount?: string }[]; steps: string[]; notes?: string }`. `RecipeLayout.astro` renders it in place of the
  plain ingredients/steps grid only when `data.variants` is a non-empty array; the no-variants
  path is byte-identical to today.

- [ ] **Step 1: Write the failing component test**

```ts
// tests/components/recipe-variant-tabs.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import RecipeVariantTabs from '../../src/components/RecipeVariantTabs.astro';

const variants = [
  { diet: 'original', ingredients: [{ item: 'Ground beef', amount: '1 lb' }], steps: ['Brown the beef.'] },
  {
    diet: 'vegan',
    ingredients: [{ item: 'Plant-based ground meat', amount: '1 lb' }],
    steps: ['Brown the plant-based meat.'],
    notes: 'Swapped ground beef for plant-based ground meat',
  },
];

describe('RecipeVariantTabs', () => {
  it('renders a tab button labeled for every variant', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeVariantTabs, { props: { variants, recipeMeta: '' } });
    expect(html).toContain('Original');
    expect(html).toContain('Vegan');
  });

  it('shows only the first variant panel by default and hides the rest', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeVariantTabs, { props: { variants, recipeMeta: '' } });

    const originalPanel = html.match(/<div[^>]*data-diet-panel="original"[^>]*>/)?.[0] ?? '';
    const veganPanel = html.match(/<div[^>]*data-diet-panel="vegan"[^>]*>/)?.[0] ?? '';
    expect(originalPanel).not.toContain('hidden');
    expect(veganPanel).toContain('hidden');
  });

  it('renders each panel with its own ingredients, steps, and notes', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeVariantTabs, { props: { variants, recipeMeta: '' } });
    expect(html).toContain('Brown the beef.');
    expect(html).toContain('Brown the plant-based meat.');
    expect(html).toContain('Swapped ground beef for plant-based ground meat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/recipe-variant-tabs.test.ts`
Expected: FAIL — `../../src/components/RecipeVariantTabs.astro` doesn't exist yet.

- [ ] **Step 3: Write the component**

```astro
---
// src/components/RecipeVariantTabs.astro
interface RecipeVariant {
  diet: string;
  ingredients: { item: string; amount?: string }[];
  steps: string[];
  notes?: string;
}

interface Props {
  variants: RecipeVariant[];
  recipeMeta: string;
}

const { variants, recipeMeta } = Astro.props;

const DIET_LABELS: Record<string, string> = {
  original: 'Original',
  'gluten-free': 'Gluten-Free',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  pescatarian: 'Pescatarian',
  'low-carb': 'Low-Carb',
  'low-salt': 'Low-Salt',
  'low-fat': 'Low-Fat',
};
---
<div class="recipe-variant-tabs">
  <div class="recipe-variant-tabs__tablist mb-4 flex flex-wrap gap-2" role="tablist">
    {variants.map((variant, i) => (
      <button
        type="button"
        class="recipe-variant-tabs__tab rounded-full border border-accent-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent-secondary aria-selected:bg-accent-secondary aria-selected:text-white"
        role="tab"
        data-diet={variant.diet}
        aria-selected={i === 0 ? 'true' : 'false'}
      >
        {DIET_LABELS[variant.diet] ?? variant.diet}
      </button>
    ))}
  </div>
  {variants.map((variant, i) => (
    <div
      class="recipe-variant-tabs__panel grid grid-cols-1 gap-6 md:grid-cols-12"
      data-diet-panel={variant.diet}
      hidden={i !== 0}
    >
      <div class="order-2 md:order-none md:col-span-8">
        <h2 class={`font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary ${recipeMeta ? 'mb-1' : 'mb-4'}`}>Recipe</h2>
        {recipeMeta && <p class="recipe-post__meta mb-4 text-sm italic text-text">{recipeMeta}</p>}
        {variant.notes && <p class="recipe-variant-tabs__notes mb-4 text-sm italic text-text">{variant.notes}</p>}
        <ol class="recipe-post__steps list-decimal space-y-2 pl-5 text-sm">
          {variant.steps.map((step) => <li>{step}</li>)}
        </ol>
      </div>
      <div class="order-1 md:order-none md:col-span-4">
        <h2 class="mb-1 font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary">Ingredients</h2>
        <ul class="recipe-post__ingredients rounded-lg bg-white p-4 text-sm shadow-md">
          {variant.ingredients.map((ingredient) => (
            <li class="mb-1">• {ingredient.amount ? `${ingredient.amount} ` : ''} {ingredient.item}</li>
          ))}
        </ul>
      </div>
    </div>
  ))}
</div>

<script>
  const tablist = document.querySelector('.recipe-variant-tabs__tablist');
  const tabs = document.querySelectorAll<HTMLButtonElement>('.recipe-variant-tabs__tab');
  const panels = document.querySelectorAll<HTMLElement>('[data-diet-panel]');

  tablist?.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('.recipe-variant-tabs__tab');
    if (!tab) return;
    const diet = tab.dataset.diet;
    tabs.forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.dietPanel !== diet;
    });
  });
</script>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/recipe-variant-tabs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing layout-wiring test**

```ts
// tests/layouts/recipe-layout.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import RecipeLayout from '../../src/layouts/RecipeLayout.astro';

const basePost = {
  data: {
    type: 'recipe' as const,
    title: 'Teriyaki Chicken Casserole',
    date: new Date('2026-01-01'),
    coverPhoto: 'https://placehold.co/1200x800?text=Teriyaki',
    coverPhotoAlt: 'A bowl of teriyaki chicken casserole',
    kitchenwareIds: [],
    affiliateLinkIds: [],
    ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
    steps: ['Preheat oven to 350F.'],
  },
};

describe('RecipeLayout variant tabs', () => {
  it('renders the plain ingredients/steps layout when there are no variants', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeLayout, {
      props: { post: basePost, products: [], affiliateLinks: [] },
    });
    expect(html).not.toContain('recipe-variant-tabs');
    expect(html).toContain('Chicken thighs');
  });

  it('renders RecipeVariantTabs when variants are present', async () => {
    const postWithVariants = {
      data: {
        ...basePost.data,
        variants: [
          { diet: 'original', ingredients: basePost.data.ingredients, steps: basePost.data.steps },
          { diet: 'vegan', ingredients: [{ item: 'Plant-based chicken', amount: '2 lbs' }], steps: ['Preheat oven to 350F.'] },
        ],
      },
    };
    const container = await AstroContainer.create();
    const html = await container.renderToString(RecipeLayout, {
      props: { post: postWithVariants, products: [], affiliateLinks: [] },
    });
    expect(html).toContain('recipe-variant-tabs');
    expect(html).toContain('Plant-based chicken');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/layouts/recipe-layout.test.ts`
Expected: FAIL — `RecipeLayout` doesn't render `RecipeVariantTabs` yet, so the second test's
assertions don't match.

- [ ] **Step 7: Wire the component into `RecipeLayout.astro`**

At the top, add the import alongside the existing ones:

```astro
import RecipeVariantTabs from '../components/RecipeVariantTabs.astro';
```

Replace the existing `<div class="recipe-post__layout ...">` block (the one containing the
"Recipe"/"Ingredients" two-column grid) with:

```astro
    {data.variants && data.variants.length > 0 ? (
      <RecipeVariantTabs variants={data.variants} recipeMeta={recipeMeta} />
    ) : (
      <div class="recipe-post__layout grid grid-cols-1 gap-6 md:grid-cols-12">
        <div class="order-2 md:order-none md:col-span-8">
          <h2 class={`font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary ${recipeMeta ? 'mb-1' : 'mb-4'}`}>Recipe</h2>
          {recipeMeta && <p class="recipe-post__meta mb-4 text-sm italic text-text">{recipeMeta}</p>}
          <ol class="recipe-post__steps list-decimal space-y-2 pl-5 text-sm">
            {data.steps.map((step) => <li>{step}</li>)}
          </ol>
        </div>
        <div class="order-1 md:order-none md:col-span-4">
          <h2 class="mb-1 font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary">Ingredients</h2>
          <ul class="recipe-post__ingredients rounded-lg bg-white p-4 text-sm shadow-md">
            {data.ingredients.map((ingredient) => (
              <li class="mb-1">• {ingredient.amount ? `${ingredient.amount} ` : ''} {ingredient.item}</li>
            ))}
          </ul>
        </div>
      </div>
    )}
```

Everything else in the file (the `<img>`, `<PostTag>`, disclosure banner, kitchenware/affiliate
strip, `formatMinutes`/`recipeMeta` computation) is unchanged.

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/layouts/recipe-layout.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Run the full site test suite to confirm nothing else broke**

Run: `npm run pretest && npx vitest run`
Expected: PASS (all test files)

- [ ] **Step 10: Commit**

```bash
git add src/components/RecipeVariantTabs.astro src/layouts/RecipeLayout.astro tests/components/recipe-variant-tabs.test.ts tests/layouts/recipe-layout.test.ts
git commit -m "Add RecipeVariantTabs component and wire it into RecipeLayout when variants are present"
```

---

## Self-Review Notes

**Spec coverage:**
- §1 (8 variants, weekly draft, `sourceMealDbId` dedup, no auto-publish) — Tasks 1, 7.
- §2 (schema changes, draft mirror, narrative body plumbing) — Tasks 1, 2.
- §3 (substitution table, LLM fallback, step rewriting, sanity guard) — Task 4.
- §4 (narrative generation) — Task 5.
- §5 (source + dedup, direct thumbnail URL) — Task 6, Task 7 (dedup wiring).
- §6 (standalone script, cron docs, `GITHUB_TOKEN` PAT auth) — Task 7.
- §7 (`RecipeVariantTabs`) — Task 8.
- §8 (error handling: fetch failure/dedup exhaustion → no draft; LLM failure per variant → one
  retry then flagged; narrative failure → placeholder; draft creation failure → nothing partial)
  — covered by `pickUnusedSourceRecipe` returning `null` (Task 6), `generateVariant`'s retry
  (Task 4), `generateNarrative`'s fallback (Task 5), and `main().catch()` in the CLI script plus
  `createDraft`'s existing all-or-throw semantics (Task 7) — no new code needed for the last one.
- §9 (testing approach) — every listed test file is covered: `dietSubstitutions.test.ts` (Task
  4), schema tests (Task 1), `render.test.ts` narrativeBody coverage (Task 2), the
  `generate-weekly-variant-recipe` integration test (Task 7), the `RecipeVariantTabs` test (Task
  8).

**Placeholder scan:** no TBDs; every step has real, runnable code and exact file paths.

**Type consistency:** `RecipeVariantData` (Task 1) flows unchanged through `draftPostSchema`
(Task 2, via direct import of `recipeVariantSchema`) and `dietSubstitutions.ts`'s
`generateAllVariants` return type (Task 4) into `DraftPost.variants` (Task 7) and
`RecipeVariantTabs`'s `Props.variants` (Task 8, structurally compatible local interface). Diet
enum values are identical across every task (`'original'`, `'gluten-free'`, `'vegan'`,
`'vegetarian'`, `'pescatarian'`, `'low-carb'`, `'low-salt'`, `'low-fat'`). `SourceRecipe` (Task 6)
field names (`idMeal`, `title`, `cuisine`, `category`, `thumbnail`, `ingredients`, `steps`) match
exactly what Task 7's `runWeeklyVariantRecipeGeneration` destructures.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-24-recipe-variant-generator.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between
   tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution
   with checkpoints.

Which approach?
