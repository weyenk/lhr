# Ingredient → Affiliate Link Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While drafting a recipe through the existing `site-help`/MCP authoring flow, automatically cross-reference the recipe's ingredients against a reusable ingredient→affiliate-link library and let the author accept/reject matches conversationally, growing the library as she goes.

**Architecture:** A new `ingredient-links` content collection (mirroring the existing `products`/`affiliate-links` pattern) holds `{ ingredient, affiliateLinkId }` mappings. A new MCP tool `suggest_affiliate_links` reads a draft's ingredients, normalizes them via a pure `normalizeIngredient` function, and reports matched/unmatched against the library — read-only, never writes. The existing `add_affiliate_link` tool gains an optional `ingredient` param so accepting a suggestion (or supplying a link for an unmatched ingredient) stages a new library entry, committed to `src/content/ingredient-links/` at publish time alongside existing `pendingAffiliateLinks` staging. A one-time backfill script seeds the library from links already manually attached to existing posts.

**Tech Stack:** TypeScript, Zod, Astro content collections, `@modelcontextprotocol/sdk` (MCP tools), Vitest, `@octokit/rest` (GitHub-as-database), `js-yaml`, `tsx` (new devDependency, script runner only).

## Global Constraints

- No live external affiliate-program API — matching is entirely against the self-curated `ingredient-links` library (per spec §1; no program is enrolled yet).
- Only recipe-type posts are matched — articles have no structured `ingredients` field (spec §1).
- No CI/GitHub Actions — the publish flow commits straight to `main` with no PR step; matching lives inside the authoring conversation (spec §1).
- Normalization is deterministic text transformation only — no LLM/fuzzy matching (spec §1, §6).
- `ingredient` values must be unique across the `ingredient-links` collection — one canonical link per ingredient (spec §2).
- Descriptive adjectives before the noun ("green onion", "kosher salt") are never stripped during normalization — collapsing them risks wrong matches; a miss just falls into "unmatched" (spec §3).
- `suggest_affiliate_links` only reads and proposes — it never writes to any collection or draft (spec §4).
- `add_affiliate_link` never silently overwrites an existing ingredient→link mapping that points elsewhere — it surfaces a conflict message instead (spec §5).
- The backfill script never guesses an ambiguous pairing — it skips and reports for manual resolution (spec §6).
- Every new tool/module follows this repo's existing test conventions exactly: the `fakeServer()` + `vi.mock(...)` pattern used in `mcp-server/tests/tools/*.test.ts`, and plain-text tool responses (`content: [{ type: 'text', text }]`) — no `structuredContent` field exists anywhere in this codebase, confirmed by repo-wide search.

---

### Task 1: `ingredientLinkSchema` in `@lhr/schemas`

**Files:**
- Modify: `packages/schemas/src/index.ts`
- Modify: `tests/content/schemas.test.ts`

**Interfaces:**
- Produces: `ingredientLinkSchema` (Zod object `{ ingredient: z.string(), affiliateLinkId: z.string() }`), exported type `IngredientLinkData`. Both consumed by Task 2 (content collection) and every later mcp-server task via `@lhr/schemas`.

- [ ] **Step 1: Write the failing tests**

In `tests/content/schemas.test.ts`, add the import and a new `describe` block (mirror the existing `affiliateLinkSchema` block exactly):

```ts
import {
  recipePostSchema,
  articlePostSchema,
  productSchema,
  affiliateLinkSchema,
  ingredientLinkSchema,
  setSchema,
} from '../../src/content/schemas';
```

```ts
describe('ingredientLinkSchema', () => {
  it('accepts a valid ingredient link', () => {
    const result = ingredientLinkSchema.safeParse({
      ingredient: 'jerk seasoning',
      affiliateLinkId: 'jerk-seasoning',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing affiliateLinkId', () => {
    const result = ingredientLinkSchema.safeParse({
      ingredient: 'jerk seasoning',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing ingredient', () => {
    const result = ingredientLinkSchema.safeParse({
      affiliateLinkId: 'jerk-seasoning',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/content/schemas.test.ts`
Expected: FAIL — `ingredientLinkSchema` is not exported from `../../src/content/schemas`.

- [ ] **Step 3: Write minimal implementation**

In `packages/schemas/src/index.ts`, add directly below `affiliateLinkSchema`:

```ts
export const ingredientLinkSchema = z.object({
  ingredient: z.string(),
  affiliateLinkId: z.string(),
});
```

Add to the type-export block at the bottom of the file:

```ts
export type IngredientLinkData = z.infer<typeof ingredientLinkSchema>;
```

- [ ] **Step 4: Rebuild the workspace package**

Run: `npm run build --workspace=@lhr/schemas`
(`src/content/schemas.ts` re-exports from `@lhr/schemas`'s built `dist/`, so the test can't see the new export until this rebuild runs.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/content/schemas.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/index.ts tests/content/schemas.test.ts
git commit -m "feat(schemas): add ingredientLinkSchema"
```

---

### Task 2: `ingredientLinks` content collection + seed data

**Files:**
- Modify: `src/content.config.ts`
- Create: `src/content/ingredient-links/jerk-seasoning.json`
- Modify: `tests/content/collections.test.ts`

**Interfaces:**
- Consumes: `ingredientLinkSchema` from Task 1.
- Produces: the `ingredientLinks` collection (queryable via `getCollection('ingredientLinks')`), and the directory `src/content/ingredient-links/` that Tasks 5, 7, and 8 write files into. Seed entry: `{ id: 'jerk-seasoning', data: { ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' } }` — the filename/id convention is the slugified ingredient string (matches the existing `affiliate-links/jerk-seasoning.json` naming pattern), and every later task that writes an ingredient-links file must follow this same convention.

- [ ] **Step 1: Write the failing tests**

In `tests/content/collections.test.ts`, add:

```ts
it('loads the seed ingredient link', async () => {
  const ingredientLinks = await getCollection('ingredientLinks');
  const jerkSeasoning = ingredientLinks.find((l) => l.id === 'jerk-seasoning');
  expect(jerkSeasoning?.data.affiliateLinkId).toBe('jerk-seasoning');
});

it('has no duplicate ingredient values in the ingredient-links collection', async () => {
  const ingredientLinks = await getCollection('ingredientLinks');
  const values = ingredientLinks.map((l) => l.data.ingredient);
  expect(new Set(values).size).toBe(values.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/content/collections.test.ts`
Expected: FAIL — `getCollection('ingredientLinks')` throws (unknown collection).

- [ ] **Step 3: Write minimal implementation**

In `src/content.config.ts`:

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { postSchema, productSchema, affiliateLinkSchema, setSchema, ingredientLinkSchema } from './content/schemas';

const posts = defineCollection({ loader: glob({ pattern: '**/*.mdx', base: './src/content/posts' }), schema: postSchema });
const products = defineCollection({ loader: glob({ pattern: '**/*.json', base: './src/content/products' }), schema: productSchema });
const affiliateLinks = defineCollection({ loader: glob({ pattern: '**/*.json', base: './src/content/affiliate-links' }), schema: affiliateLinkSchema });
const sets = defineCollection({ loader: glob({ pattern: '**/*.json', base: './src/content/sets' }), schema: setSchema });
const ingredientLinks = defineCollection({ loader: glob({ pattern: '**/*.json', base: './src/content/ingredient-links' }), schema: ingredientLinkSchema });

export const collections = { posts, products, affiliateLinks, sets, ingredientLinks };
```

Create `src/content/ingredient-links/jerk-seasoning.json`:

```json
{
  "ingredient": "jerk seasoning",
  "affiliateLinkId": "jerk-seasoning"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/content/collections.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/content/ingredient-links/jerk-seasoning.json tests/content/collections.test.ts
git commit -m "feat(content): add ingredientLinks collection with seed data"
```

---

### Task 3: `normalizeIngredient` pure function

**Files:**
- Create: `mcp-server/src/normalizeIngredient.ts`
- Create: `mcp-server/tests/normalizeIngredient.test.ts`

**Interfaces:**
- Produces: `normalizeIngredient(item: string): string` — consumed by Task 5 (`suggest_affiliate_links`), Task 6 (`add_affiliate_link`), and Task 8 (backfill script). This exact name and signature must be used verbatim in all three.

**Design (all four rules from spec §3):**
1. Lowercase.
2. Strip a leading quantity/unit token (e.g. "2 cloves garlic" → "garlic").
3. Strip a trailing prep clause after a comma (e.g. "garlic, minced" → "garlic").
4. Singularize a simple trailing plural (strip trailing `s`, but never `ss`) — e.g. "cloves" → "clove", "onions" → "onion".
Descriptive adjectives before the noun ("green onion", "kosher salt") are never touched.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/normalizeIngredient.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeIngredient } from '../src/normalizeIngredient';

describe('normalizeIngredient', () => {
  it('strips a leading quantity+unit and a trailing prep clause', () => {
    expect(normalizeIngredient('2 cloves garlic, minced')).toBe('garlic');
  });

  it('strips a bare leading number (no unit word) and singularizes, keeping descriptive adjectives', () => {
    expect(normalizeIngredient('3 green onions')).toBe('green onion');
  });

  it('strips a leading unit word without touching a descriptive adjective', () => {
    expect(normalizeIngredient('1 tsp kosher salt')).toBe('kosher salt');
  });

  it('passes through an already-normalized ingredient unchanged', () => {
    expect(normalizeIngredient('jerk seasoning')).toBe('jerk seasoning');
  });

  it('passes through a bare noun with no quantity unchanged', () => {
    expect(normalizeIngredient('salt')).toBe('salt');
  });

  it('strips a bare leading number and singularizes a descriptive-adjective ingredient', () => {
    expect(normalizeIngredient('2 large eggs')).toBe('large egg');
  });

  it('does not mangle a word ending in a double s', () => {
    expect(normalizeIngredient('molasses')).toBe('molasses');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test -- tests/normalizeIngredient.test.ts`
Expected: FAIL — `../src/normalizeIngredient` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `mcp-server/src/normalizeIngredient.ts`:

```ts
const UNIT_WORDS = [
  'cloves?',
  'cups?',
  'tsp',
  'tbsp',
  'teaspoons?',
  'tablespoons?',
  'ounces?',
  'oz',
  'pounds?',
  'lbs?',
  'grams?',
  'g',
  'kg',
  'pinch(?:es)?',
  'dash(?:es)?',
  'slices?',
  'sprigs?',
  'stalks?',
  'cans?',
  'bunch(?:es)?',
  'sticks?',
  'heads?',
];

const LEADING_QUANTITY_RE = new RegExp(`^\\s*(?:[\\d¼½¾⅓⅔./]+\\s*)?(?:${UNIT_WORDS.join('|')})\\s+`, 'i');
const LEADING_BARE_NUMBER_RE = /^\s*[\d¼½¾⅓⅔./]+\s+/;

export function normalizeIngredient(item: string): string {
  let s = item.toLowerCase().trim();

  const commaIndex = s.indexOf(',');
  if (commaIndex !== -1) s = s.slice(0, commaIndex).trim();

  s = s.replace(LEADING_QUANTITY_RE, '').trim();
  s = s.replace(LEADING_BARE_NUMBER_RE, '').trim();

  const words = s.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  if (last && /s$/.test(last) && !/ss$/.test(last)) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix mcp-server test -- tests/normalizeIngredient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/normalizeIngredient.ts mcp-server/tests/normalizeIngredient.test.ts
git commit -m "feat(mcp-server): add normalizeIngredient"
```

---

### Task 4: `pendingIngredientLinks` field on the draft schema

**Files:**
- Modify: `mcp-server/src/drafts.ts`
- Modify: `mcp-server/src/tools/startPost.ts`
- Modify: `mcp-server/tests/drafts.test.ts`
- Modify: `mcp-server/tests/tools/startPost.test.ts`

**Interfaces:**
- Produces: `DraftPost.pendingIngredientLinks: Array<{ ingredient: string; affiliateLinkId: string }>` (default `[]`) — consumed by Task 6 (`add_affiliate_link` stages entries into it) and Task 7 (`confirmAndPublish` commits it as files). Field shape intentionally mirrors `IngredientLinkData` from Task 1 exactly (`{ ingredient, affiliateLinkId }`) — no random-suffix `id` like `pendingAffiliateLinks` has, since the ingredient-links filename is deterministic (slugified `ingredient`), not randomly generated.

- [ ] **Step 1: Write the failing tests**

In `mcp-server/tests/drafts.test.ts`, add `pendingIngredientLinks: []` to the `emptyRecipeDraft` fixture:

```ts
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
};
```

(This fixture is reused by the `readDraft`/`writeDraft`/`listDrafts`/`summarizeDraftPost` tests via `toEqual`/spread — without this change, Step 2 below will show those tests newly failing once the schema default kicks in, which is the point of running it before implementing.)

In `mcp-server/tests/tools/startPost.test.ts`, find the existing assertion on the created draft (mirroring how `pendingAffiliateLinks: []` is checked) and extend it to also expect `pendingIngredientLinks: []`:

```ts
expect(drafts.createDraft).toHaveBeenCalledWith(
  expect.anything(),
  'post',
  expect.objectContaining({ pendingAffiliateLinks: [], pendingIngredientLinks: [] }),
);
```

(Match this to the exact existing assertion style in that file — read it first and extend the existing `expect.objectContaining(...)` rather than duplicating a whole new assertion.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test -- tests/drafts.test.ts tests/tools/startPost.test.ts`
Expected: FAIL — `createDraft`'s actual argument (and `readDraft`'s parsed output) lack `pendingIngredientLinks`.

- [ ] **Step 3: Write minimal implementation**

In `mcp-server/src/drafts.ts`, extend `draftPostSchema`:

```ts
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
});
```

In `mcp-server/src/tools/startPost.ts`, add the field to the initial draft literal:

```ts
const initial: DraftPost = {
  kind: 'post',
  postType: type,
  title: '',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
  pendingIngredientLinks: [],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix mcp-server test -- tests/drafts.test.ts tests/tools/startPost.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full mcp-server suite to check for regressions**

Run: `npm --prefix mcp-server test`
Expected: PASS for all files — other test fixtures that spread a base draft object (e.g. `addAffiliateLink.test.ts`'s `createBaseDraft()`, `confirmAndPublish.test.ts`'s `validRecipeDraft`) do NOT need updating in this task since Zod's `.default([])` fills in the missing field automatically when those fixtures are read back through `draftPostSchema.parse(...)` — but if any test constructs a `DraftPost`-typed object directly in TypeScript (not just plain JSON test fixtures) and the compiler complains about a missing required property, add `pendingIngredientLinks: []` there too. Confirm by running the suite, not by guessing.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/drafts.ts mcp-server/src/tools/startPost.ts mcp-server/tests/drafts.test.ts mcp-server/tests/tools/startPost.test.ts
git commit -m "feat(mcp-server): add pendingIngredientLinks to draft schema"
```

---

### Task 5: `suggest_affiliate_links` MCP tool

**Files:**
- Create: `mcp-server/src/tools/suggestAffiliateLinks.ts`
- Create: `mcp-server/tests/tools/suggestAffiliateLinks.test.ts`
- Modify: `mcp-server/src/tools/index.ts`

**Interfaces:**
- Consumes: `normalizeIngredient` (Task 3), `readDraft` (`../drafts.js`), `readCollection` (`../catalog.js`).
- Produces: MCP tool `suggest_affiliate_links` — input `{ draftId: string }`, output `{ content: [{ type: 'text', text: string }] }` (plain text only, per this repo's convention — confirmed no `structuredContent` usage exists anywhere). The tool never calls `writeDraft`.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/tools/suggestAffiliateLinks.test.ts`, following the exact mocking pattern from `mcp-server/tests/tools/addAffiliateLink.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const catalogMock = { readCollection: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { registerSuggestAffiliateLinks } = await import('../../src/tools/suggestAffiliateLinks');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

function createRecipeDraft(ingredients: Array<{ item: string; amount?: string }>) {
  return {
    kind: 'post' as const,
    postType: 'recipe' as const,
    title: 'Jerk Chicken',
    ingredients,
    steps: [],
    sections: [],
    photos: [],
    kitchenwareIds: [],
    affiliateLinkIds: [],
    pendingAffiliateLinks: [],
    pendingIngredientLinks: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('suggest_affiliate_links', () => {
  it('reports a match for an ingredient with an existing library entry', async () => {
    draftsMock.readDraft.mockResolvedValue(createRecipeDraft([{ item: '2 tbsp jerk seasoning' }]));
    catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
      dirPath === 'src/content/ingredient-links'
        ? [{ id: 'jerk-seasoning', data: { ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' } }]
        : [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }],
    );
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('2 tbsp jerk seasoning');
    expect(result.content[0].text).toContain('The jerk seasoning we used');
    expect(result.content[0].text).toContain('https://vendor.example.com/jerk-seasoning');
  });

  it('reports an ingredient as unmatched when no library entry exists', async () => {
    draftsMock.readDraft.mockResolvedValue(createRecipeDraft([{ item: '3 green onions' }]));
    catalogMock.readCollection.mockResolvedValue([]);
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('3 green onions');
    expect(result.content[0].text.toLowerCase()).toContain('no existing link');
  });

  it('no-ops for article drafts', async () => {
    draftsMock.readDraft.mockResolvedValue({
      kind: 'post' as const,
      postType: 'article' as const,
      title: 'Why We Chose Coastal Blue',
      ingredients: [],
      steps: [],
      sections: [{ heading: 'Why blue', body: 'Text' }],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
      pendingIngredientLinks: [],
    });
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(catalogMock.readCollection).not.toHaveBeenCalled();
    expect(result.content[0].text.toLowerCase()).toContain('no ingredients to match');
  });

  it('no-ops for a recipe draft with zero ingredients', async () => {
    draftsMock.readDraft.mockResolvedValue(createRecipeDraft([]));
    const server = fakeServer();
    registerSuggestAffiliateLinks(server as never, 'token');

    const result = (await server.call('suggest_affiliate_links', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(catalogMock.readCollection).not.toHaveBeenCalled();
    expect(result.content[0].text.toLowerCase()).toContain('no ingredients to match');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test -- tests/tools/suggestAffiliateLinks.test.ts`
Expected: FAIL — `../../src/tools/suggestAffiliateLinks` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `mcp-server/src/tools/suggestAffiliateLinks.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft } from '../drafts.js';
import { readCollection } from '../catalog.js';
import { normalizeIngredient } from '../normalizeIngredient.js';

interface IngredientLinkData {
  ingredient: string;
  affiliateLinkId: string;
}

interface AffiliateLinkData {
  label: string;
  url: string;
  tag: string;
}

interface Match {
  ingredient: string;
  label: string;
  url: string;
}

function buildSummary(matched: Match[], unmatched: string[]): string {
  if (matched.length === 0 && unmatched.length === 0) {
    return 'No ingredients to match (only recipe drafts with ingredients are checked).';
  }

  const lines: string[] = [];
  if (matched.length > 0) {
    lines.push('Ingredient matches found:');
    for (const m of matched) lines.push(`- "${m.ingredient}" → ${m.label} (${m.url})`);
  } else {
    lines.push('No existing affiliate link matches found for these ingredients.');
  }

  if (unmatched.length > 0) {
    lines.push('', 'No existing link yet for:');
    for (const u of unmatched) lines.push(`- "${u}"`);
  }

  return lines.join('\n');
}

export function registerSuggestAffiliateLinks(server: McpServer, accessToken: string): void {
  server.registerTool(
    'suggest_affiliate_links',
    {
      title: "Suggest affiliate links for a draft's ingredients",
      description:
        'Matches a recipe draft\'s ingredients against the ingredient-links library and reports matches/unmatches for the author to confirm in chat. Never writes anything.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      if (draft.postType !== 'recipe' || draft.ingredients.length === 0) {
        return { content: [{ type: 'text' as const, text: buildSummary([], []) }] };
      }

      const ingredientLinks = await readCollection<IngredientLinkData>(client, 'src/content/ingredient-links');
      const affiliateLinks = await readCollection<AffiliateLinkData>(client, 'src/content/affiliate-links');

      const matched: Match[] = [];
      const unmatched: string[] = [];

      for (const { item } of draft.ingredients) {
        const normalized = normalizeIngredient(item);
        const linkEntry = ingredientLinks.find((e) => e.data.ingredient === normalized);
        const affiliateLink = linkEntry ? affiliateLinks.find((a) => a.id === linkEntry.data.affiliateLinkId) : undefined;
        if (linkEntry && affiliateLink) {
          matched.push({ ingredient: item, label: affiliateLink.data.label, url: affiliateLink.data.url });
        } else {
          unmatched.push(item);
        }
      }

      return { content: [{ type: 'text' as const, text: buildSummary(matched, unmatched) }] };
    },
  );
}
```

Register it in `mcp-server/src/tools/index.ts`:

```ts
import { registerStartPost } from './startPost.js';
import { registerAddContentStep } from './addContentStep.js';
import { registerAttachPhoto } from './attachPhoto.js';
import { registerLinkKitchenware } from './linkKitchenware.js';
import { registerAddAffiliateLink } from './addAffiliateLink.js';
import { registerSuggestAffiliateLinks } from './suggestAffiliateLinks.js';
import { registerPreviewPost } from './previewPost.js';
import { registerConfirmAndPublish } from './confirmAndPublish.js';
import { registerStartNewSet } from './startNewSet.js';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
  registerAddAffiliateLink(server, accessToken);
  registerSuggestAffiliateLinks(server, accessToken);
  registerPreviewPost(server, accessToken);
  registerConfirmAndPublish(server, accessToken);
  registerStartNewSet(server, accessToken);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix mcp-server test -- tests/tools/suggestAffiliateLinks.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full mcp-server suite**

Run: `npm --prefix mcp-server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/tools/suggestAffiliateLinks.ts mcp-server/tests/tools/suggestAffiliateLinks.test.ts mcp-server/src/tools/index.ts
git commit -m "feat(mcp-server): add suggest_affiliate_links tool"
```

---

### Task 6: Extend `add_affiliate_link` with an `ingredient` param

**Files:**
- Modify: `mcp-server/src/tools/addAffiliateLink.ts`
- Modify: `mcp-server/tests/tools/addAffiliateLink.test.ts`

**Interfaces:**
- Consumes: `normalizeIngredient` (Task 3).
- Produces: `add_affiliate_link` now accepts an optional `ingredient: string` input. When provided, it stages a `{ ingredient: <normalized>, affiliateLinkId: <resolved id> }` entry onto `draft.pendingIngredientLinks` (Task 4's field) unless a conflicting entry already exists for that normalized ingredient, in which case it returns a conflict message and leaves `pendingIngredientLinks` untouched. This is the only place `pendingIngredientLinks` gets written to during normal authoring.

- [ ] **Step 1: Write the failing tests**

In `mcp-server/tests/tools/addAffiliateLink.test.ts`:

1. Update `createBaseDraft()` to include `pendingIngredientLinks: []`:

```ts
function createBaseDraft() {
  return {
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
    pendingIngredientLinks: [],
  };
}
```

2. Change `catalogMock.readCollection.mockResolvedValue(...)` calls in the EXISTING tests (the four already in the file) to `mockImplementation` dispatchers that return affiliate-link data only for `'src/content/affiliate-links'` and `[]` for any other path — this keeps the pre-existing tests passing once the handler also calls `readCollection` for `'src/content/ingredient-links'` on every invocation with an `ingredient` param, and is harmless for calls that don't pass `ingredient` (that code path won't be reached). Example for one of the four:

```ts
it('reuses an existing catalog entry matched by URL', async () => {
  draftsMock.readDraft.mockResolvedValue(createBaseDraft());
  catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
    dirPath === 'src/content/affiliate-links'
      ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
      : [],
  );
  // ...rest unchanged
});
```

Apply the same `mockImplementation` conversion to all four pre-existing tests in the file (mechanical change, same shape each time).

3. Add new tests:

```ts
it('stages a new ingredient-link entry when the ingredient has no existing mapping (URL match branch)', async () => {
  draftsMock.readDraft.mockResolvedValue(createBaseDraft());
  catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
    dirPath === 'src/content/affiliate-links'
      ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
      : [],
  );
  const server = fakeServer();
  registerAddAffiliateLink(server as never, 'token');

  await server.call('add_affiliate_link', {
    draftId: 'abc1',
    label: 'Jerk seasoning',
    url: 'https://vendor.example.com/jerk-seasoning',
    tag: 'jerk-seasoning',
    ingredient: '2 tbsp jerk seasoning',
  });

  expect(draftsMock.writeDraft).toHaveBeenCalledWith(
    expect.anything(),
    'post',
    'abc1',
    expect.objectContaining({
      affiliateLinkIds: ['jerk-seasoning'],
      pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }],
    }),
    expect.any(String),
  );
});

it('stages a new ingredient-link entry pointing at a newly-pending affiliate link (no URL match branch)', async () => {
  draftsMock.readDraft.mockResolvedValue(createBaseDraft());
  catalogMock.readCollection.mockResolvedValue([]);
  const server = fakeServer();
  registerAddAffiliateLink(server as never, 'token');

  await server.call('add_affiliate_link', {
    draftId: 'abc1',
    label: 'New sauce',
    url: 'https://vendor.example.com/new-sauce',
    tag: 'new-sauce',
    ingredient: '1 cup new sauce',
  });

  expect(draftsMock.writeDraft).toHaveBeenCalledWith(
    expect.anything(),
    'post',
    'abc1',
    expect.objectContaining({
      pendingAffiliateLinks: [expect.objectContaining({ label: 'New sauce', tag: 'new-sauce' })],
      pendingIngredientLinks: [expect.objectContaining({ ingredient: 'new sauce' })],
    }),
    expect.any(String),
  );
  const [, , , writtenDraft] = draftsMock.writeDraft.mock.calls[0] as [
    unknown,
    unknown,
    unknown,
    { pendingAffiliateLinks: { id: string }[]; pendingIngredientLinks: { affiliateLinkId: string }[] },
  ];
  expect(writtenDraft.pendingIngredientLinks[0].affiliateLinkId).toBe(writtenDraft.pendingAffiliateLinks[0].id);
});

it('returns a conflict message and does not modify pendingIngredientLinks when the ingredient already maps elsewhere', async () => {
  draftsMock.readDraft.mockResolvedValue(createBaseDraft());
  catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
    dirPath === 'src/content/affiliate-links'
      ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
      : dirPath === 'src/content/ingredient-links'
        ? [{ id: 'jerk-seasoning', data: { ingredient: 'jerk seasoning', affiliateLinkId: 'some-other-link' } }]
        : [],
  );
  const server = fakeServer();
  registerAddAffiliateLink(server as never, 'token');

  const result = (await server.call('add_affiliate_link', {
    draftId: 'abc1',
    label: 'Jerk seasoning',
    url: 'https://vendor.example.com/jerk-seasoning',
    tag: 'jerk-seasoning',
    ingredient: 'jerk seasoning',
  })) as { content: { text: string }[] };

  expect(result.content[0].text.toLowerCase()).toContain('already linked');
  expect(draftsMock.writeDraft).toHaveBeenCalledWith(
    expect.anything(),
    'post',
    'abc1',
    expect.objectContaining({ pendingIngredientLinks: [] }),
    expect.any(String),
  );
});

it('does not touch pendingIngredientLinks when the ingredient param is omitted', async () => {
  draftsMock.readDraft.mockResolvedValue(createBaseDraft());
  catalogMock.readCollection.mockImplementation((_client: unknown, dirPath: string) =>
    dirPath === 'src/content/affiliate-links'
      ? [{ id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } }]
      : [],
  );
  const server = fakeServer();
  registerAddAffiliateLink(server as never, 'token');

  await server.call('add_affiliate_link', {
    draftId: 'abc1',
    label: 'Jerk seasoning',
    url: 'https://vendor.example.com/jerk-seasoning',
    tag: 'jerk-seasoning',
  });

  expect(draftsMock.writeDraft).toHaveBeenCalledWith(
    expect.anything(),
    'post',
    'abc1',
    expect.objectContaining({ pendingIngredientLinks: [] }),
    expect.any(String),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test -- tests/tools/addAffiliateLink.test.ts`
Expected: FAIL — `ingredient` param not accepted / `pendingIngredientLinks` untouched in the new tests.

- [ ] **Step 3: Write minimal implementation**

Replace `mcp-server/src/tools/addAffiliateLink.ts` with:

```ts
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github.js';
import { readDraft, writeDraft } from '../drafts.js';
import { readCollection } from '../catalog.js';
import { normalizeIngredient } from '../normalizeIngredient.js';

interface AffiliateLinkData {
  label: string;
  url: string;
  tag: string;
}

interface IngredientLinkData {
  ingredient: string;
  affiliateLinkId: string;
}

export function registerAddAffiliateLink(server: McpServer, accessToken: string): void {
  server.registerTool(
    'add_affiliate_link',
    {
      title: 'Add an affiliate link to a draft',
      description:
        'Adds a label + URL + tag, reusing an existing catalog entry when the URL already exists. Optionally pass the ingredient it corresponds to, so future recipes with the same ingredient match it automatically.',
      inputSchema: {
        draftId: z.string(),
        label: z.string(),
        url: z.string().url(),
        tag: z.string(),
        ingredient: z.string().optional(),
      },
    },
    async ({ draftId, label, url, tag, ingredient }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const existing = await readCollection<AffiliateLinkData>(client, 'src/content/affiliate-links');
      const match = existing.find((entry) => entry.data.url === url);

      let resolvedAffiliateLinkId: string;
      let baseMessage: string;
      if (match) {
        draft.affiliateLinkIds = Array.from(new Set([...draft.affiliateLinkIds, match.id]));
        resolvedAffiliateLinkId = match.id;
        baseMessage = `Reused existing affiliate link "${match.data.label}".`;
      } else {
        const id = `${tag}-${randomBytes(2).toString('hex')}`;
        draft.pendingAffiliateLinks = [...draft.pendingAffiliateLinks, { id, label, url, tag }];
        resolvedAffiliateLinkId = id;
        baseMessage = `Added new affiliate link "${label}" (created on publish).`;
      }

      let ingredientMessage = '';
      if (ingredient) {
        const normalized = normalizeIngredient(ingredient);
        const existingLinks = await readCollection<IngredientLinkData>(client, 'src/content/ingredient-links');
        const existingEntry = existingLinks.find((e) => e.data.ingredient === normalized);

        if (existingEntry && existingEntry.data.affiliateLinkId !== resolvedAffiliateLinkId) {
          ingredientMessage = ` Note: "${normalized}" is already linked to a different affiliate link (${existingEntry.data.affiliateLinkId}); not overwriting.`;
        } else if (!existingEntry) {
          const alreadyPending = draft.pendingIngredientLinks.some((p) => p.ingredient === normalized);
          if (!alreadyPending) {
            draft.pendingIngredientLinks = [
              ...draft.pendingIngredientLinks,
              { ingredient: normalized, affiliateLinkId: resolvedAffiliateLinkId },
            ];
          }
          ingredientMessage = ` Will remember "${normalized}" → this link for future recipes.`;
        }
      }

      await writeDraft(client, 'post', draftId, draft, `Update affiliate links on draft ${draftId}`);
      return { content: [{ type: 'text' as const, text: baseMessage + ingredientMessage }] };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix mcp-server test -- tests/tools/addAffiliateLink.test.ts`
Expected: PASS — all 8 tests (4 original + 4 new).

- [ ] **Step 5: Run the full mcp-server suite**

Run: `npm --prefix mcp-server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/tools/addAffiliateLink.ts mcp-server/tests/tools/addAffiliateLink.test.ts
git commit -m "feat(mcp-server): extend add_affiliate_link with ingredient param"
```

---

### Task 7: Commit `pendingIngredientLinks` files on publish

**Files:**
- Modify: `mcp-server/src/tools/confirmAndPublish.ts`
- Modify: `mcp-server/tests/tools/confirmAndPublish.test.ts`

**Interfaces:**
- Consumes: `draft.pendingIngredientLinks` (Task 4), `slugify` (already imported in this file from `../catalog.js`).
- Produces: publishing a post now also commits one `src/content/ingredient-links/{slugify(ingredient)}.json` file per staged entry, alongside the existing post `.mdx` and any `pendingAffiliateLinks` files.

- [ ] **Step 1: Write the failing test**

In `mcp-server/tests/tools/confirmAndPublish.test.ts`, extend the `validRecipeDraft` fixture:

```ts
const validRecipeDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [{ item: 'Chicken' }],
  steps: ['Grill it'],
  sections: [],
  photos: [{ url: 'https://blob.vercel-storage.com/posts/jerk-chicken.jpg', caption: 'Jerk chicken on a platter' }],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [{ id: 'sauce-ab12', label: 'Sauce', url: 'https://vendor.example.com/sauce', tag: 'sauce' }],
  pendingIngredientLinks: [{ ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' }],
};
```

Extend the first test's assertion (`'commits the rendered post and pending catalog entries, then deletes the draft branch'`):

```ts
expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
  expect.anything(),
  expect.arrayContaining([
    expect.objectContaining({ path: 'src/content/posts/jerk-chicken.mdx' }),
    expect.objectContaining({ path: 'src/content/affiliate-links/sauce-ab12.json' }),
    expect.objectContaining({
      path: 'src/content/ingredient-links/jerk-seasoning.json',
      content: JSON.stringify({ ingredient: 'jerk seasoning', affiliateLinkId: 'sauce-ab12' }, null, 2),
    }),
  ]),
  expect.stringContaining('Jerk Chicken'),
);
```

Add a regression test confirming no extra files are added when there's nothing staged:

```ts
it('commits no ingredient-links files when none are pending', async () => {
  draftsMock.findDraftKind.mockResolvedValue('post');
  draftsMock.readDraft.mockResolvedValue({ ...validRecipeDraft, pendingIngredientLinks: [] });
  catalogMock.uniqueSlug.mockResolvedValue('jerk-chicken');
  githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

  const server = fakeServer();
  registerConfirmAndPublish(server as never, 'token');

  await server.call('confirm_and_publish', { draftId: 'abc1' });

  const [, files] = githubMock.commitFilesToMain.mock.calls[0] as [unknown, { path: string }[]];
  expect(files.some((f) => f.path.startsWith('src/content/ingredient-links/'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test -- tests/tools/confirmAndPublish.test.ts`
Expected: FAIL — no `ingredient-links` file is committed.

- [ ] **Step 3: Write minimal implementation**

In `mcp-server/src/tools/confirmAndPublish.ts`, inside `publishPost`, extend the `files` array:

```ts
const files: FileWrite[] = [
  { path: `src/content/posts/${slug}.mdx`, content: renderFrontmatterYaml(frontmatter) },
  ...draft.pendingAffiliateLinks.map((link) => ({
    path: `src/content/affiliate-links/${link.id}.json`,
    content: JSON.stringify({ label: link.label, url: link.url, tag: link.tag }, null, 2),
  })),
  ...draft.pendingIngredientLinks.map((link) => ({
    path: `src/content/ingredient-links/${slugify(link.ingredient)}.json`,
    content: JSON.stringify({ ingredient: link.ingredient, affiliateLinkId: link.affiliateLinkId }, null, 2),
  })),
];
```

(`slugify` is already imported from `../catalog.js` at the top of this file — no new import needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix mcp-server test -- tests/tools/confirmAndPublish.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full mcp-server suite**

Run: `npm --prefix mcp-server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/tools/confirmAndPublish.ts mcp-server/tests/tools/confirmAndPublish.test.ts
git commit -m "feat(mcp-server): commit pendingIngredientLinks files on publish"
```

---

### Task 8: Backfill script

**Files:**
- Create: `mcp-server/src/backfillIngredientLinks.ts` (pure, unit-tested core logic)
- Create: `mcp-server/tests/backfillIngredientLinks.test.ts`
- Create: `mcp-server/scripts/backfill-ingredient-links.ts` (thin CLI entrypoint, I/O glue — not unit-tested)
- Modify: `mcp-server/package.json`

**Interfaces:**
- Consumes: `normalizeIngredient` (Task 3), `createGitHubClient`/`getFile`/`listFiles`/`commitFilesToMain` (`../src/github.js`), `readCollection` (`../src/catalog.js`), `postSchema` (`@lhr/schemas`, already a direct dependency of `mcp-server` per its `package.json`).
- Produces: `parsePostFrontmatter(mdxContent: string): Record<string, unknown>` and `computeBackfillEntries(posts, existingIngredientLinks): { seeded: Array<{postId, ingredient, affiliateLinkId}>, skipped: Array<{postId, reason}> }` — both pure functions, unit-tested without any GitHub calls. The CLI script wires these to real I/O and is run once, manually, via `npm run backfill:ingredient-links` with a `GITHUB_TOKEN` env var set.

**Matching rule (spec §6, made concrete — deliberately the strictest reading):** a post seeds a library entry only when it has exactly one affiliate link AND exactly one ingredient (an unambiguous 1:1 pairing). Any other case — zero affiliate links (nothing to infer, silently skipped, not reported), 2+ affiliate links, or 1 affiliate link with 2+ ingredients — is left for manual resolution. This avoids any keyword/tag-similarity guessing.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/backfillIngredientLinks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeBackfillEntries, parsePostFrontmatter } from '../src/backfillIngredientLinks';

describe('computeBackfillEntries', () => {
  it('seeds an entry for a post with exactly one affiliate link and one ingredient', () => {
    const posts = [{ id: 'jerk-chicken', ingredients: [{ item: '2 tbsp jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning'] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([{ postId: 'jerk-chicken', ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }]);
    expect(result.skipped).toEqual([]);
  });

  it('skips a post with more than one affiliate link', () => {
    const posts = [{ id: 'multi', ingredients: [{ item: 'salt' }], affiliateLinkIds: ['a', 'b'] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].postId).toBe('multi');
  });

  it('skips a post with exactly one affiliate link but multiple ingredients', () => {
    const posts = [{ id: 'multi-ing', ingredients: [{ item: 'jerk seasoning' }, { item: 'chicken thighs' }], affiliateLinkIds: ['jerk-seasoning'] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([]);
    expect(result.skipped[0].postId).toBe('multi-ing');
  });

  it('ignores posts with zero affiliate links (nothing to infer, not reported as skipped)', () => {
    const posts = [{ id: 'no-links', ingredients: [{ item: 'salt' }], affiliateLinkIds: [] }];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('skips (does not overwrite) when the normalized ingredient already has a library entry', () => {
    const posts = [{ id: 'jerk-chicken-2', ingredients: [{ item: 'jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning'] }];
    const result = computeBackfillEntries(posts, [{ ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }]);
    expect(result.seeded).toEqual([]);
    expect(result.skipped[0].postId).toBe('jerk-chicken-2');
  });

  it('does not seed duplicate ingredient keys across two posts in the same run', () => {
    const posts = [
      { id: 'post-a', ingredients: [{ item: 'jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning'] },
      { id: 'post-b', ingredients: [{ item: '2 tbsp jerk seasoning' }], affiliateLinkIds: ['jerk-seasoning-2'] },
    ];
    const result = computeBackfillEntries(posts, []);
    expect(result.seeded).toEqual([{ postId: 'post-a', ingredient: 'jerk seasoning', affiliateLinkId: 'jerk-seasoning' }]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].postId).toBe('post-b');
  });
});

describe('parsePostFrontmatter', () => {
  it('parses a rendered post frontmatter block back into an object', () => {
    const mdx = '---\ntype: recipe\ntitle: Jerk Chicken\ningredients:\n  - item: jerk seasoning\n---\n\nBody content here.\n';
    const result = parsePostFrontmatter(mdx);
    expect(result.title).toBe('Jerk Chicken');
    expect((result.ingredients as Array<{ item: string }>)[0].item).toBe('jerk seasoning');
  });

  it('throws when no frontmatter delimiters are present', () => {
    expect(() => parsePostFrontmatter('just body text, no frontmatter')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test -- tests/backfillIngredientLinks.test.ts`
Expected: FAIL — `../src/backfillIngredientLinks` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `mcp-server/src/backfillIngredientLinks.ts`:

```ts
import yaml from 'js-yaml';
import { normalizeIngredient } from './normalizeIngredient.js';

export function parsePostFrontmatter(mdxContent: string): Record<string, unknown> {
  const match = mdxContent.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error('No frontmatter delimiters found in post content');
  return yaml.load(match[1]) as Record<string, unknown>;
}

export interface BackfillPost {
  id: string;
  ingredients: Array<{ item: string }>;
  affiliateLinkIds: string[];
}

export interface BackfillResult {
  seeded: Array<{ postId: string; ingredient: string; affiliateLinkId: string }>;
  skipped: Array<{ postId: string; reason: string }>;
}

export function computeBackfillEntries(
  posts: BackfillPost[],
  existingIngredientLinks: Array<{ ingredient: string }>,
): BackfillResult {
  const seeded: BackfillResult['seeded'] = [];
  const skipped: BackfillResult['skipped'] = [];
  const seenNormalized = new Set(existingIngredientLinks.map((e) => e.ingredient));

  for (const post of posts) {
    if (post.affiliateLinkIds.length === 0) continue;

    if (post.affiliateLinkIds.length !== 1) {
      skipped.push({
        postId: post.id,
        reason: `has ${post.affiliateLinkIds.length} affiliate links; cannot infer a 1:1 pairing without guessing`,
      });
      continue;
    }

    if (post.ingredients.length !== 1) {
      skipped.push({
        postId: post.id,
        reason: `has exactly one affiliate link but ${post.ingredients.length} ingredients; cannot infer which ingredient it belongs to`,
      });
      continue;
    }

    const normalized = normalizeIngredient(post.ingredients[0].item);
    if (seenNormalized.has(normalized)) {
      skipped.push({ postId: post.id, reason: `normalized ingredient "${normalized}" already has a library entry; not overwriting` });
      continue;
    }

    seeded.push({ postId: post.id, ingredient: normalized, affiliateLinkId: post.affiliateLinkIds[0] });
    seenNormalized.add(normalized);
  }

  return { seeded, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix mcp-server test -- tests/backfillIngredientLinks.test.ts`
Expected: PASS

- [ ] **Step 5: Write the CLI entrypoint (not unit-tested — I/O glue only)**

Create `mcp-server/scripts/backfill-ingredient-links.ts`:

```ts
import { createGitHubClient, listFiles, getFile, commitFilesToMain } from '../src/github.js';
import { readCollection } from '../src/catalog.js';
import { postSchema } from '@lhr/schemas';
import { parsePostFrontmatter, computeBackfillEntries, type BackfillPost } from '../src/backfillIngredientLinks.js';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN env var is required (a GitHub personal access token with repo write access).');
    process.exit(1);
  }
  const client = createGitHubClient(token);

  const postFiles = await listFiles(client, 'src/content/posts', 'main');
  const posts: BackfillPost[] = [];
  for (const filename of postFiles.filter((f) => f.endsWith('.mdx'))) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;
    const frontmatter = parsePostFrontmatter(file.content);
    const parsed = postSchema.safeParse(frontmatter);
    if (!parsed.success || parsed.data.type !== 'recipe') continue;
    posts.push({
      id: filename.replace(/\.mdx$/, ''),
      ingredients: parsed.data.ingredients,
      affiliateLinkIds: parsed.data.affiliateLinkIds,
    });
  }

  const existingIngredientLinks = await readCollection<{ ingredient: string; affiliateLinkId: string }>(
    client,
    'src/content/ingredient-links',
  );
  const { seeded, skipped } = computeBackfillEntries(posts, existingIngredientLinks.map((e) => e.data));

  console.log(`Seeded ${seeded.length} ingredient-link entr${seeded.length === 1 ? 'y' : 'ies'}:`);
  for (const s of seeded) console.log(`  ${s.postId}: "${s.ingredient}" -> ${s.affiliateLinkId}`);
  console.log(`Skipped ${skipped.length} case(s) needing manual resolution:`);
  for (const s of skipped) console.log(`  ${s.postId}: ${s.reason}`);

  if (seeded.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  const files = seeded.map((s) => ({
    path: `src/content/ingredient-links/${s.ingredient.replace(/\s+/g, '-')}.json`,
    content: JSON.stringify({ ingredient: s.ingredient, affiliateLinkId: s.affiliateLinkId }, null, 2),
  }));
  await commitFilesToMain(client, files, 'Backfill ingredient-links from existing posts');
  console.log(`Committed ${files.length} file(s) to main.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Wire up the run command**

Add `tsx` as a devDependency and a run script in `mcp-server/package.json`:

```bash
npm install --save-dev tsx --workspace=mcp-server
```

Add to `mcp-server/package.json`'s `"scripts"`:

```json
"backfill:ingredient-links": "tsx scripts/backfill-ingredient-links.ts"
```

(Using `tsx` rather than extending the `tsc`-based build: this is a one-time, manually-run local script, not part of the deployed server build — `scripts/` deliberately stays outside `tsconfig.json`'s `include` and `scripts/bundle.mjs`'s entry points, so it can never accidentally ship in the production bundle.)

- [ ] **Step 7: Run the full mcp-server suite**

Run: `npm --prefix mcp-server test`
Expected: PASS (the CLI script itself isn't covered by an automated test — only `computeBackfillEntries`/`parsePostFrontmatter` are).

- [ ] **Step 8: Commit**

```bash
git add mcp-server/src/backfillIngredientLinks.ts mcp-server/tests/backfillIngredientLinks.test.ts mcp-server/scripts/backfill-ingredient-links.ts mcp-server/package.json mcp-server/package-lock.json
git commit -m "feat(mcp-server): add ingredient-links backfill script"
```

---

### Task 9: Update `site-help` skill documentation

**Files:**
- Modify: `.claude/skills/site-help/SKILL.md`

No tests — this is documentation. Verified by reading the rendered result for coherence, not by running anything.

- [ ] **Step 1: Add a table row**

In the "Quick reference" table, add a new row directly after `add_affiliate_link`:

```markdown
| `suggest_affiliate_links` | Checks a recipe draft's ingredients against previously-approved affiliate links and reports matches/unmatches for you to confirm before adding any new ones. |
```

- [ ] **Step 2: Insert a step in the "Publishing a post" flow**

Renumber and insert a new step between the current step 2 (`add_content_step`) and step 3 (`attach_photo`), since ingredients need to exist before matching can run:

```markdown
3. **`suggest_affiliate_links`** (recipes only) — once ingredients are entered,
   the assistant checks them against the ingredient-link library and tells you
   which ones already have a known affiliate link. Confirm the ones you want,
   skip the rest, or supply a link for anything unmatched — accepting a
   suggestion or adding a new link here also remembers it for future recipes.
```

Renumber the remaining steps (`attach_photo` becomes 4, `link_kitchenware` becomes 5, `add_affiliate_link` becomes 6, `preview_post` becomes 7, `confirm_and_publish` becomes 8).

- [ ] **Step 3: Update any tool-count prose**

Read the file's opening paragraph ("Everything ... happens by talking through the `lhr-authoring` MCP server's 8 tools.") and update "8 tools" to "9 tools".

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/site-help/SKILL.md
git commit -m "docs(site-help): document suggest_affiliate_links in authoring flow"
```
