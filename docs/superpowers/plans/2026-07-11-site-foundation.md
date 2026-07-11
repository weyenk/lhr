# Site Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the deployable Astro site for loveheatrelationship.com — content schema, recipe/article templates, kitchenware/affiliate-link display with disclosure and analytics tracking, and the governance docs — as the foundation the MCP authoring server (Plan 2) and Claude authoring skill (Plan 3) will build on.

**Architecture:** Astro static site (no SSR needed — content is published via git commits from the future MCP server, so a static build on every push is sufficient) using the Content Layer API for four collections (`posts`, `products`, `affiliateLinks`, `sets`) backed by Zod schemas, deployed to Vercel via its zero-config Astro framework detection.

**Tech Stack:** Astro 5, `@astrojs/mdx`, TypeScript, Vitest (via `getViteConfig` so tests can import `astro:content`), self-hosted Umami (script embed only in this plan — provisioning the Umami server itself is infrastructure, not covered here).

## Global Constraints

- Stack is Astro + Vercel + Umami — do not substitute frameworks/hosting/analytics tooling. (spec §2, Rules #1)
- Analytics tooling must remain free or open-source. (spec §6, Constitution #3)
- Affiliate links and kitchenware product links must always carry a visible disclosure. (spec §6, Constitution #2)
- Repo content structure is `content/posts`, `content/products`, `content/affiliate-links`, `content/sets`. (spec §5, Rules #2)
- Post frontmatter shape is: type, title, date, cover photo (+alt), linked kitchenware, linked affiliate links, plus recipe-only ingredients/steps. (spec §3, Rules #5)

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `astro.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/pages/index.astro`
- Create: `tests/pages/home.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: `BaseLayout.astro` accepting `Props { title: string }`, rendering a `<slot />` inside `<body>` — every later layout/page wraps content in this.
- Produces: npm scripts `dev`, `build`, `preview`, `test`, `pretest` (runs `astro sync` before tests).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lhr-site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "pretest": "astro sync",
    "test": "vitest run"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "@astrojs/mdx": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 3: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.astro/
.env
```

- [ ] **Step 6: Create `src/layouts/BaseLayout.astro`**

```astro
---
interface Props {
  title: string;
}

const { title } = Astro.props;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 7: Create `src/pages/index.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="Love Heat Relationship">
  <h1>Love Heat Relationship</h1>
</BaseLayout>
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: installs without error, creates `package-lock.json`.

- [ ] **Step 9: Write the build-verification test**

Create `tests/pages/home.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('home page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the site title', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('Love Heat Relationship');
  });
});
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — `home page > renders the site title`

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json astro.config.mjs vitest.config.ts .gitignore src/layouts/BaseLayout.astro src/pages/index.astro tests/pages/home.test.ts
git commit -m "chore: scaffold Astro site with build-verification test"
```

---

### Task 2: Content Schemas (Zod)

**Files:**
- Create: `src/content/schemas.ts`
- Test: `tests/content/schemas.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `recipePostSchema`, `articlePostSchema`, `postSchema` (discriminated union on `type`), `productSchema`, `affiliateLinkSchema`, `setSchema`, and types `PostData`, `ProductData`, `AffiliateLinkData`, `SetData` — Task 3 wires these into collections; Task 4/5/6 import the `*Data` types.

- [ ] **Step 1: Write the failing tests**

Create `tests/content/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  recipePostSchema,
  articlePostSchema,
  productSchema,
  affiliateLinkSchema,
  setSchema,
} from '../../src/content/schemas';

describe('recipePostSchema', () => {
  it('accepts a valid recipe post', () => {
    const result = recipePostSchema.safeParse({
      type: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/jerk-chicken.jpg',
      coverPhotoAlt: 'Jerk chicken on a platter',
      kitchenwareIds: ['coastal-blue-platter'],
      affiliateLinkIds: ['jerk-seasoning'],
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Marinate overnight.', 'Grill over indirect heat.'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a recipe post with no steps', () => {
    const result = recipePostSchema.safeParse({
      type: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/jerk-chicken.jpg',
      coverPhotoAlt: 'Jerk chicken on a platter',
      ingredients: [{ item: 'Chicken thighs' }],
      steps: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('articlePostSchema', () => {
  it('accepts a valid article post without ingredients/steps', () => {
    const result = articlePostSchema.safeParse({
      type: 'article',
      title: 'Why We Chose the Coastal Blue Set',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/set-hero.jpg',
      coverPhotoAlt: 'The Coastal Blue kitchenware set styled on a table',
    });
    expect(result.success).toBe(true);
  });
});

describe('productSchema', () => {
  it('accepts a valid product', () => {
    const result = productSchema.safeParse({
      name: 'Coastal Blue Serving Platter',
      priceCents: 4800,
      image: 'https://example.com/platter.jpg',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative price', () => {
    const result = productSchema.safeParse({
      name: 'Coastal Blue Serving Platter',
      priceCents: -100,
      image: 'https://example.com/platter.jpg',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    });
    expect(result.success).toBe(false);
  });
});

describe('affiliateLinkSchema', () => {
  it('accepts a valid affiliate link', () => {
    const result = affiliateLinkSchema.safeParse({
      label: 'The jerk seasoning we used',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed URL', () => {
    const result = affiliateLinkSchema.safeParse({
      label: 'The jerk seasoning we used',
      url: 'not-a-url',
      tag: 'jerk-seasoning',
    });
    expect(result.success).toBe(false);
  });
});

describe('setSchema', () => {
  it('accepts a valid kitchenware set', () => {
    const result = setSchema.safeParse({
      name: 'Coastal Blue',
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      productIds: ['coastal-blue-platter'],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../src/content/schemas'`

- [ ] **Step 3: Write `src/content/schemas.ts`**

```ts
import { z } from 'astro:content';

const basePostFields = {
  title: z.string(),
  date: z.coerce.date(),
  coverPhoto: z.string().url(),
  coverPhotoAlt: z.string(),
  excerpt: z.string().optional(),
  kitchenwareIds: z.array(z.string()).default([]),
  affiliateLinkIds: z.array(z.string()).default([]),
};

export const recipePostSchema = z.object({
  type: z.literal('recipe'),
  ...basePostFields,
  ingredients: z
    .array(
      z.object({
        item: z.string(),
        amount: z.string().optional(),
      }),
    )
    .min(1),
  steps: z.array(z.string()).min(1),
});

export const articlePostSchema = z.object({
  type: z.literal('article'),
  ...basePostFields,
});

export const postSchema = z.discriminatedUnion('type', [recipePostSchema, articlePostSchema]);

export const productSchema = z.object({
  name: z.string(),
  priceCents: z.number().int().positive(),
  image: z.string().url(),
  imageAlt: z.string(),
  vendorUrl: z.string().url(),
  setId: z.string(),
});

export const affiliateLinkSchema = z.object({
  label: z.string(),
  url: z.string().url(),
  tag: z.string(),
});

export const setSchema = z.object({
  name: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  productIds: z.array(z.string()),
});

export type PostData = z.infer<typeof postSchema>;
export type ProductData = z.infer<typeof productSchema>;
export type AffiliateLinkData = z.infer<typeof affiliateLinkSchema>;
export type SetData = z.infer<typeof setSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `schemas.test.ts` cases

- [ ] **Step 5: Commit**

```bash
git add src/content/schemas.ts tests/content/schemas.test.ts
git commit -m "feat: add content schemas for posts, products, affiliate links, sets"
```

---

### Task 3: Content Collections Config + Seed Data

**Files:**
- Create: `src/content.config.ts`
- Create: `src/content/sets/coastal-blue.json`
- Create: `src/content/products/coastal-blue-platter.json`
- Create: `src/content/affiliate-links/jerk-seasoning.json`
- Test: `tests/content/collections.test.ts`

**Interfaces:**
- Consumes: `postSchema`, `productSchema`, `affiliateLinkSchema`, `setSchema` from `src/content/schemas.ts` (Task 2).
- Produces: collections `posts`, `products`, `affiliateLinks`, `sets` queryable via `getCollection()`/`render()` from `astro:content` — Tasks 5–7 depend on this. Seed entries with ids `coastal-blue` (set), `coastal-blue-platter` (product), `jerk-seasoning` (affiliate link).

- [ ] **Step 1: Write the failing test**

Create `tests/content/collections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCollection } from 'astro:content';

describe('content collections', () => {
  it('loads the seed kitchenware set', async () => {
    const sets = await getCollection('sets');
    const coastalBlue = sets.find((s) => s.id === 'coastal-blue');
    expect(coastalBlue?.data.name).toBe('Coastal Blue');
  });

  it('loads the seed product and links it to its set', async () => {
    const products = await getCollection('products');
    const platter = products.find((p) => p.id === 'coastal-blue-platter');
    expect(platter?.data.setId).toBe('coastal-blue');
  });

  it('loads the seed affiliate link', async () => {
    const links = await getCollection('affiliateLinks');
    const jerkSeasoning = links.find((l) => l.id === 'jerk-seasoning');
    expect(jerkSeasoning?.data.tag).toBe('jerk-seasoning');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no collections configured / empty results

- [ ] **Step 3: Write `src/content.config.ts`**

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { postSchema, productSchema, affiliateLinkSchema, setSchema } from './content/schemas';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/posts' }),
  schema: postSchema,
});

const products = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/products' }),
  schema: productSchema,
});

const affiliateLinks = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/affiliate-links' }),
  schema: affiliateLinkSchema,
});

const sets = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/sets' }),
  schema: setSchema,
});

export const collections = { posts, products, affiliateLinks, sets };
```

- [ ] **Step 4: Create the seed data files**

Create `src/content/sets/coastal-blue.json`:

```json
{
  "name": "Coastal Blue",
  "startDate": "2026-07-01",
  "endDate": "2026-12-31",
  "productIds": ["coastal-blue-platter"]
}
```

Create `src/content/products/coastal-blue-platter.json`:

```json
{
  "name": "Coastal Blue Serving Platter",
  "priceCents": 4800,
  "image": "https://placehold.co/800x600?text=Coastal+Blue+Platter",
  "imageAlt": "A coastal blue ceramic serving platter",
  "vendorUrl": "https://vendor.example.com/coastal-blue-platter",
  "setId": "coastal-blue"
}
```

Create `src/content/affiliate-links/jerk-seasoning.json`:

```json
{
  "label": "The jerk seasoning we used",
  "url": "https://vendor.example.com/jerk-seasoning",
  "tag": "jerk-seasoning"
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `collections.test.ts` cases

- [ ] **Step 6: Commit**

```bash
git add src/content.config.ts src/content/sets/coastal-blue.json src/content/products/coastal-blue-platter.json src/content/affiliate-links/jerk-seasoning.json tests/content/collections.test.ts
git commit -m "feat: wire up content collections with seed kitchenware set data"
```

---

### Task 4: Content Helper Functions

**Files:**
- Create: `src/lib/content.ts`
- Test: `tests/lib/content.test.ts`

**Interfaces:**
- Consumes: `ProductData`, `AffiliateLinkData`, `SetData` types from `src/content/schemas.ts` (Task 2).
- Produces: `getActiveSet(sets, now?)`, `getSetProducts(setId, products)`, `getEntriesByIds(ids, entries)`, `formatPrice(cents)`. Tasks 5–6 (layouts) consume `getEntriesByIds` and `formatPrice`. `getActiveSet`/`getSetProducts` are not consumed within Plan 1 — they exist because Plan 2's `link_kitchenware`/`start_new_set` MCP tools need "what's the current set" logic, and defining it once here (with tests) avoids Plan 2 re-deriving it.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getActiveSet, getSetProducts, getEntriesByIds, formatPrice } from '../../src/lib/content';

const sets = [
  {
    id: 'coastal-blue',
    data: {
      name: 'Coastal Blue',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-12-31'),
      productIds: ['coastal-blue-platter'],
    },
  },
];

const products = [
  {
    id: 'coastal-blue-platter',
    data: {
      name: 'Coastal Blue Serving Platter',
      priceCents: 4800,
      image: 'https://example.com/platter.jpg',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    },
  },
];

describe('getActiveSet', () => {
  it('returns the set whose date range contains the given date', () => {
    const active = getActiveSet(sets, new Date('2026-08-15'));
    expect(active?.id).toBe('coastal-blue');
  });

  it('returns null when no set is active', () => {
    const active = getActiveSet(sets, new Date('2027-01-15'));
    expect(active).toBeNull();
  });
});

describe('getSetProducts', () => {
  it('returns products belonging to the given set', () => {
    const result = getSetProducts('coastal-blue', products);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('coastal-blue-platter');
  });
});

describe('getEntriesByIds', () => {
  it('returns entries in the requested order, skipping missing ids', () => {
    const result = getEntriesByIds(['coastal-blue-platter', 'missing-id'], products);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('coastal-blue-platter');
  });
});

describe('formatPrice', () => {
  it('formats cents as a dollar string', () => {
    expect(formatPrice(4800)).toBe('$48.00');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../src/lib/content'`

- [ ] **Step 3: Write `src/lib/content.ts`**

```ts
import type { ProductData, SetData } from '../content/schemas';

export interface Entry<T> {
  id: string;
  data: T;
}

export function getActiveSet(sets: Entry<SetData>[], now: Date = new Date()): Entry<SetData> | null {
  return sets.find((s) => s.data.startDate <= now && now <= s.data.endDate) ?? null;
}

export function getSetProducts(setId: string, products: Entry<ProductData>[]): Entry<ProductData>[] {
  return products.filter((p) => p.data.setId === setId);
}

export function getEntriesByIds<T>(ids: string[], entries: Entry<T>[]): Entry<T>[] {
  return ids
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is Entry<T> => entry !== undefined);
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `content.test.ts` cases

- [ ] **Step 5: Commit**

```bash
git add src/lib/content.ts tests/lib/content.test.ts
git commit -m "feat: add content helper functions for sets, products, affiliate links"
```

---

### Task 5: Recipe Post Template

**Files:**
- Create: `src/components/ProductCard.astro`
- Create: `src/components/AffiliateLink.astro`
- Create: `src/layouts/RecipeLayout.astro`
- Create: `src/pages/posts/[...slug].astro`
- Create: `src/content/posts/jerk-chicken-platter.mdx`
- Test: `tests/pages/recipe-post.test.ts`

**Interfaces:**
- Consumes: `formatPrice`, `getEntriesByIds` from `src/lib/content.ts` (Task 4); `ProductData`, `AffiliateLinkData` types from `src/content/schemas.ts` (Task 2); `BaseLayout` from Task 1.
- Produces: `ProductCard.astro` (`Props { id: string; data: ProductData }`) and `AffiliateLink.astro` (`Props { id: string; data: AffiliateLinkData }`) — Task 6 (article layout) reuses both. `src/pages/posts/[...slug].astro` route, live at `/posts/<id>/`.

- [ ] **Step 1: Write the failing test**

Create `tests/pages/recipe-post.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('recipe post page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the seed recipe post with ingredients, steps, kitchenware, and affiliate links', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toContain('Jerk Chicken for a Crowd');
    expect(html).toContain('Chicken thighs');
    expect(html).toContain('Marinate the chicken overnight.');
    expect(html).toContain('Coastal Blue Serving Platter');
    expect(html).toContain('$48.00');
    expect(html).toContain('data-umami-event="kitchenware-click"');
    expect(html).toContain('The jerk seasoning we used');
    expect(html).toContain('data-umami-event="affiliate-click"');
    expect(html).toContain('affiliate link');
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT: no such file or directory, open 'dist/posts/jerk-chicken-platter/index.html'`

- [ ] **Step 3: Write `src/components/ProductCard.astro`**

```astro
---
import { formatPrice } from '../lib/content';
import type { ProductData } from '../content/schemas';

interface Props {
  id: string;
  data: ProductData;
}

const { id, data } = Astro.props;
---
<a
  class="product-card"
  href={data.vendorUrl}
  target="_blank"
  rel="noopener sponsored"
  data-umami-event="kitchenware-click"
  data-umami-event-product={id}
>
  <img src={data.image} alt={data.imageAlt} />
  <span class="product-card__name">{data.name}</span>
  <span class="product-card__price">{formatPrice(data.priceCents)}</span>
  <small class="product-card__disclosure">Shop this piece (affiliate link)</small>
</a>
```

- [ ] **Step 4: Write `src/components/AffiliateLink.astro`**

```astro
---
import type { AffiliateLinkData } from '../content/schemas';

interface Props {
  id: string;
  data: AffiliateLinkData;
}

const { id, data } = Astro.props;
---
<a
  class="affiliate-link"
  href={data.url}
  target="_blank"
  rel="noopener sponsored"
  data-umami-event="affiliate-click"
  data-umami-event-link={id}
>
  {data.label}
  <small class="affiliate-link__disclosure">(affiliate link)</small>
</a>
```

- [ ] **Step 5: Write `src/layouts/RecipeLayout.astro`**

```astro
---
import BaseLayout from './BaseLayout.astro';
import ProductCard from '../components/ProductCard.astro';
import AffiliateLink from '../components/AffiliateLink.astro';
import { render, type CollectionEntry } from 'astro:content';
import { getEntriesByIds } from '../lib/content';

interface Props {
  post: CollectionEntry<'posts'>;
  products: CollectionEntry<'products'>[];
  affiliateLinks: CollectionEntry<'affiliateLinks'>[];
}

const { post, products, affiliateLinks } = Astro.props;
const { data } = post;

if (data.type !== 'recipe') {
  throw new Error(`RecipeLayout received a non-recipe post: ${post.id}`);
}

const linkedProducts = getEntriesByIds(data.kitchenwareIds, products);
const linkedAffiliateLinks = getEntriesByIds(data.affiliateLinkIds, affiliateLinks);
const { Content } = await render(post);
---
<BaseLayout title={data.title}>
  <article class="recipe-post">
    <h1>{data.title}</h1>
    <img src={data.coverPhoto} alt={data.coverPhotoAlt} />
    <ul class="recipe-post__ingredients">
      {data.ingredients.map((ingredient) => (
        <li>{ingredient.amount ? `${ingredient.amount} ` : ''}{ingredient.item}</li>
      ))}
    </ul>
    <ol class="recipe-post__steps">
      {data.steps.map((step) => <li>{step}</li>)}
    </ol>
    <Content />
    {linkedProducts.length > 0 && (
      <section class="recipe-post__kitchenware">
        <h2>Shop this set</h2>
        {linkedProducts.map((product) => <ProductCard id={product.id} data={product.data} />)}
      </section>
    )}
    {linkedAffiliateLinks.length > 0 && (
      <section class="recipe-post__affiliate-links">
        <h2>Also mentioned</h2>
        {linkedAffiliateLinks.map((link) => <AffiliateLink id={link.id} data={link.data} />)}
      </section>
    )}
  </article>
</BaseLayout>
```

- [ ] **Step 6: Write `src/pages/posts/[...slug].astro`**

```astro
---
import { getCollection } from 'astro:content';
import RecipeLayout from '../../layouts/RecipeLayout.astro';
import ArticleLayout from '../../layouts/ArticleLayout.astro';

export async function getStaticPaths() {
  const posts = await getCollection('posts');
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const products = await getCollection('products');
const affiliateLinks = await getCollection('affiliateLinks');
---
{post.data.type === 'recipe' ? (
  <RecipeLayout post={post} products={products} affiliateLinks={affiliateLinks} />
) : (
  <ArticleLayout post={post} products={products} affiliateLinks={affiliateLinks} />
)}
```

Note: this references `src/layouts/ArticleLayout.astro`, created in Task 6. The build will fail until Task 6 adds it — that's expected; Task 6 immediately follows.

- [ ] **Step 7: Create the seed recipe post**

Create `src/content/posts/jerk-chicken-platter.mdx`:

```mdx
---
type: recipe
title: "Jerk Chicken for a Crowd"
date: 2026-07-01
coverPhoto: "https://placehold.co/1200x800?text=Jerk+Chicken"
coverPhotoAlt: "Jerk chicken served on a coastal blue platter"
kitchenwareIds: ["coastal-blue-platter"]
affiliateLinkIds: ["jerk-seasoning"]
ingredients:
  - item: "Chicken thighs"
    amount: "2 lbs"
  - item: "Jerk seasoning"
    amount: "3 tbsp"
steps:
  - "Marinate the chicken overnight."
  - "Grill over indirect heat until charred and cooked through."
---

Serve family-style straight from the platter — this one's meant for sharing.
```

- [ ] **Step 8: Run test to verify it passes**

This step depends on Task 6's `ArticleLayout.astro` existing (the route imports it). Complete Task 6's Step 3 (`ArticleLayout.astro` creation) before running this, then:

Run: `npm test`
Expected: PASS — `recipe post page > renders the seed recipe post...`

- [ ] **Step 9: Commit**

```bash
git add src/components/ProductCard.astro src/components/AffiliateLink.astro src/layouts/RecipeLayout.astro src/pages/posts/[...slug].astro src/content/posts/jerk-chicken-platter.mdx tests/pages/recipe-post.test.ts
git commit -m "feat: add recipe post template with kitchenware and affiliate link display"
```

---

### Task 6: Article Post Template

**Files:**
- Create: `src/layouts/ArticleLayout.astro`
- Create: `src/content/posts/why-coastal-blue.mdx`
- Test: `tests/pages/article-post.test.ts`

**Interfaces:**
- Consumes: `ProductCard.astro`, `AffiliateLink.astro` (Task 5); `getEntriesByIds` (Task 4); `BaseLayout` (Task 1).
- Produces: `ArticleLayout.astro` (`Props { post, products, affiliateLinks }`, same shape as `RecipeLayout`) — required by `src/pages/posts/[...slug].astro` (Task 5, Step 6).

- [ ] **Step 1: Write `src/layouts/ArticleLayout.astro` first (unblocks Task 5's route)**

```astro
---
import BaseLayout from './BaseLayout.astro';
import ProductCard from '../components/ProductCard.astro';
import AffiliateLink from '../components/AffiliateLink.astro';
import { render, type CollectionEntry } from 'astro:content';
import { getEntriesByIds } from '../lib/content';

interface Props {
  post: CollectionEntry<'posts'>;
  products: CollectionEntry<'products'>[];
  affiliateLinks: CollectionEntry<'affiliateLinks'>[];
}

const { post, products, affiliateLinks } = Astro.props;
const { data } = post;

if (data.type !== 'article') {
  throw new Error(`ArticleLayout received a non-article post: ${post.id}`);
}

const linkedProducts = getEntriesByIds(data.kitchenwareIds, products);
const linkedAffiliateLinks = getEntriesByIds(data.affiliateLinkIds, affiliateLinks);
const { Content } = await render(post);
---
<BaseLayout title={data.title}>
  <article class="article-post">
    <h1>{data.title}</h1>
    <img src={data.coverPhoto} alt={data.coverPhotoAlt} />
    <Content />
    {linkedProducts.length > 0 && (
      <section class="article-post__kitchenware">
        <h2>Shop this set</h2>
        {linkedProducts.map((product) => <ProductCard id={product.id} data={product.data} />)}
      </section>
    )}
    {linkedAffiliateLinks.length > 0 && (
      <section class="article-post__affiliate-links">
        <h2>Also mentioned</h2>
        {linkedAffiliateLinks.map((link) => <AffiliateLink id={link.id} data={link.data} />)}
      </section>
    )}
  </article>
</BaseLayout>
```

- [ ] **Step 2: Confirm Task 5's recipe test now passes**

Run: `npm test`
Expected: PASS — `recipe post page` suite (was blocked on this file), plus all earlier suites still passing

- [ ] **Step 3: Write the failing article test**

Create `tests/pages/article-post.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('article post page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the seed article post with kitchenware but no ingredients list', () => {
    const html = readFileSync('dist/posts/why-coastal-blue/index.html', 'utf-8');
    expect(html).toContain('Why We Chose the Coastal Blue Set');
    expect(html).toContain('Coastal Blue Serving Platter');
    expect(html).toContain('data-umami-event="kitchenware-click"');
    expect(html).not.toContain('recipe-post__ingredients');
  }, 60000);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT: no such file or directory, open 'dist/posts/why-coastal-blue/index.html'`

- [ ] **Step 5: Create the seed article post**

Create `src/content/posts/why-coastal-blue.mdx`:

```mdx
---
type: article
title: "Why We Chose the Coastal Blue Set"
date: 2026-07-02
coverPhoto: "https://placehold.co/1200x800?text=Coastal+Blue"
coverPhotoAlt: "The Coastal Blue kitchenware set styled on a linen tablecloth"
kitchenwareIds: ["coastal-blue-platter"]
affiliateLinkIds: []
---

Every six months we pick one set to live with, cook with, and photograph obsessively. This time, it's Coastal Blue.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `article post page > renders the seed article post...`

- [ ] **Step 7: Commit**

```bash
git add src/layouts/ArticleLayout.astro src/content/posts/why-coastal-blue.mdx tests/pages/article-post.test.ts
git commit -m "feat: add article post template"
```

---

### Task 7: Home / Listing Page

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `tests/pages/home.test.ts`

**Interfaces:**
- Consumes: `getCollection('posts')` from `astro:content`; seed posts from Tasks 5–6 (`jerk-chicken-platter`, `why-coastal-blue`).
- Produces: nothing consumed by later tasks — this is the site's entry page.

- [ ] **Step 1: Extend the failing test**

Modify `tests/pages/home.test.ts` to add a new case:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('home page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the site title', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('Love Heat Relationship');
  });

  it('lists links to all published posts', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('href="/posts/jerk-chicken-platter/"');
    expect(html).toContain('Jerk Chicken for a Crowd');
    expect(html).toContain('href="/posts/why-coastal-blue/"');
    expect(html).toContain('Why We Chose the Coastal Blue Set');
  });
});
```

- [ ] **Step 2: Run test to verify the new case fails**

Run: `npm test`
Expected: FAIL — `lists links to all published posts` — home page has no post links yet

- [ ] **Step 3: Update `src/pages/index.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('posts')).sort(
  (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
);
---
<BaseLayout title="Love Heat Relationship">
  <h1>Love Heat Relationship</h1>
  <ul class="post-list">
    {posts.map((post) => (
      <li>
        <a href={`/posts/${post.id}/`}>{post.data.title}</a>
      </li>
    ))}
  </ul>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both `home page` cases

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro tests/pages/home.test.ts
git commit -m "feat: list published posts on the home page"
```

---

### Task 8: Umami Analytics Script

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Create: `.env.example`
- Test: `tests/layouts/base-layout.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID` environment variables (set at build time on Vercel once the self-hosted Umami instance exists — infrastructure step, not covered by this plan).
- Produces: nothing new consumed by other tasks; `data-umami-event*` attributes already added in Tasks 5–6 depend on Umami's script being present on the page, which this task adds.

- [ ] **Step 1: Write the failing test**

Create `tests/layouts/base-layout.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Umami analytics script', () => {
  it('is included in the build when Umami env vars are set', () => {
    execSync('npm run build', {
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_UMAMI_URL: 'https://umami.loveheatrelationship.com/script.js',
        PUBLIC_UMAMI_WEBSITE_ID: 'test-website-id',
      },
    });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('src="https://umami.loveheatrelationship.com/script.js"');
    expect(html).toContain('data-website-id="test-website-id"');
  }, 60000);

  it('is omitted from the build when Umami env vars are unset', () => {
    execSync('npm run build', { stdio: 'inherit' });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).not.toContain('data-website-id');
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify the first case fails**

Run: `npm test`
Expected: FAIL — `is included in the build when Umami env vars are set` — no script tag present

- [ ] **Step 3: Update `src/layouts/BaseLayout.astro`**

```astro
---
interface Props {
  title: string;
}

const { title } = Astro.props;
const umamiUrl = import.meta.env.PUBLIC_UMAMI_URL;
const umamiWebsiteId = import.meta.env.PUBLIC_UMAMI_WEBSITE_ID;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {umamiUrl && umamiWebsiteId && (
      <script defer src={umamiUrl} data-website-id={umamiWebsiteId}></script>
    )}
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 4: Create `.env.example`**

```
PUBLIC_UMAMI_URL=https://umami.loveheatrelationship.com/script.js
PUBLIC_UMAMI_WEBSITE_ID=
```

- [ ] **Step 5: Run test to verify both cases pass**

Run: `npm test`
Expected: PASS — both `Umami analytics script` cases

- [ ] **Step 6: Commit**

```bash
git add src/layouts/BaseLayout.astro .env.example tests/layouts/base-layout.test.ts
git commit -m "feat: embed Umami analytics script when configured"
```

---

### Task 9: Governance Docs (Constitution & Rules)

**Files:**
- Create: `docs/CONSTITUTION.md`
- Create: `docs/RULES.md`
- Test: `tests/docs/governance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed programmatically — these are read by future human/agentic contributors before making structural changes, per spec §6.

- [ ] **Step 1: Write the failing test**

Create `tests/docs/governance.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('governance docs', () => {
  const constitution = () => readFileSync('docs/CONSTITUTION.md', 'utf-8');
  const rules = () => readFileSync('docs/RULES.md', 'utf-8');

  it('constitution includes all six never-change principles', () => {
    const text = constitution();
    expect(text).toContain('never goes live without the author');
    expect(text).toContain('always disclosed per FTC');
    expect(text).toContain('free or open-source');
    expect(text).toContain('never silently discarded');
    expect(text).toContain('single-author only');
    expect(text).toContain('codified as a new Rule');
  });

  it('rules includes all five evolvable rules', () => {
    const text = rules();
    expect(text).toContain('Astro + Vercel + Umami');
    expect(text).toContain('content/posts');
    expect(text).toContain('start_post');
    expect(text).toContain('26-posts/6-months');
    expect(text).toContain('frontmatter schema');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT: no such file or directory, open 'docs/CONSTITUTION.md'`

- [ ] **Step 3: Create `docs/CONSTITUTION.md`**

```markdown
# LHR Constitution

These principles never change without extraordinary explicit override. Any agent (human-directed or autonomous) working on this project must follow them at all times.

1. A post never goes live without the author's explicit confirmation — no autonomous auto-publish.
2. Affiliate links and product placements are always disclosed per FTC guidelines.
3. Analytics/tracking tooling must remain free or open-source — no adding paid/closed tracking without the author's sign-off.
4. In-progress drafts are never silently discarded on error.
5. The authoring MCP server is single-author only — never opened to public/unauthenticated access.
6. If the user corrects the same thing more than once, the agent must proactively ask whether that correction should be codified as a new Rule (see `RULES.md`).
```

- [ ] **Step 4: Create `docs/RULES.md`**

```markdown
# LHR Rules

These rules can evolve, but an agent should only drift a little from them before asking the user for explicit permission to change course.

1. Tech stack is Astro + Vercel + Umami — don't swap frameworks/hosting/analytics tooling without asking first.
2. Repo content structure (`content/posts`, `content/products`, `content/affiliate-links`, `content/sets`) is the convention to follow.
3. MCP tool names/contracts (`start_post`, `attach_photo`, `link_kitchenware`, `add_affiliate_link`, `confirm_and_publish`, `start_new_set`) are the established interface — extend rather than rename without discussion.
4. The ~26-posts/6-months set cadence is the default assumption, not a hard limit — an agent can suggest adjusting it but should confirm with the author before changing the pattern.
5. Post frontmatter schema (type, title, date, cover photo + alt, linked kitchenware, linked affiliate links, plus recipe-only ingredients/steps) is the standard shape for new posts.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both `governance docs` cases

- [ ] **Step 6: Commit**

```bash
git add docs/CONSTITUTION.md docs/RULES.md tests/docs/governance.test.ts
git commit -m "docs: add project constitution and rules"
```

---

### Task 10: Vercel Deployment Wiring

**Files:**
- Create: `vercel.json`
- Create: `docs/DEPLOYMENT.md`
- Test: `tests/deployment/vercel-config.test.ts`

**Interfaces:**
- Consumes: `npm run build` (Task 1) producing `dist/`.
- Produces: nothing consumed by other tasks — this is the final task connecting the built site to hosting.

- [ ] **Step 1: Write the failing test**

Create `tests/deployment/vercel-config.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vercel.json', () => {
  it('specifies the Astro framework, build command, and output directory', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    expect(config.framework).toBe('astro');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBe('dist');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `ENOENT: no such file or directory, open 'vercel.json'`

- [ ] **Step 3: Create `vercel.json`**

```json
{
  "framework": "astro",
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `vercel.json > specifies the Astro framework, build command, and output directory`

- [ ] **Step 5: Create `docs/DEPLOYMENT.md`** documenting the manual, one-time steps this plan cannot automate:

```markdown
# Deployment

Manual, one-time setup (outside this repo's code):

1. In the Vercel dashboard, import this GitHub repository as a new project. Vercel reads `vercel.json` automatically — no further config needed.
2. Add the custom domain `loveheatrelationship.com` to the Vercel project, and update DNS at the domain registrar to point to Vercel per its instructions.
3. Provision the self-hosted Umami instance (e.g. on Fly.io or Railway) and note its script URL and website ID.
4. In the Vercel project's Environment Variables, set `PUBLIC_UMAMI_URL` and `PUBLIC_UMAMI_WEBSITE_ID` to the values from step 3.
5. Push to `main` — Vercel auto-deploys on every push.
```

- [ ] **Step 6: Commit**

```bash
git add vercel.json docs/DEPLOYMENT.md tests/deployment/vercel-config.test.ts
git commit -m "chore: add Vercel deployment config and manual setup docs"
```

---

## Definition of Done

- [ ] `npm test` passes with all suites from Tasks 1–10.
- [ ] `npm run build` produces `dist/index.html`, `dist/posts/jerk-chicken-platter/index.html`, `dist/posts/why-coastal-blue/index.html`.
- [ ] `docs/CONSTITUTION.md` and `docs/RULES.md` exist and are committed.
- [ ] Manual steps in `docs/DEPLOYMENT.md` are completed by the user (Vercel project creation, domain DNS, Umami provisioning) — outside the scope of automated tasks.
