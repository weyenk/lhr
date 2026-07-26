# Homepage Paginated Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's single-hero-plus-text-sidebar layout with a hero followed by a paginated feed of full article/recipe cards, while keeping a sidebar whose length tracks the main column's height on each page.

**Architecture:** `src/pages/index.astro` is replaced by `src/pages/[...page].astro`, using Astro's built-in `paginate()` to produce static pages at `/`, `/2/`, `/3/`, etc. Page 1 shows a hero (the most recent post) plus 5 card-style posts; later pages show 5 (or fewer, on the last page) cards with no hero. A new `ArticleCard.astro` component renders each card. The sidebar is capped to a post count computed from rough per-item height estimates so it roughly matches the main column's height on the current page.

**Tech Stack:** Astro 5 (content collections, `getStaticPaths` + `paginate`), Tailwind CSS v4 (`line-clamp-3` utility is built in, no plugin needed), Vitest (build-then-inspect-`dist/`-HTML test style already used throughout this repo).

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-26-homepage-paginated-feed-design.md`.
- No client-side JavaScript for pagination — static generated pages only.
- 5 posts per page in the main column (`CARDS_PER_PAGE = 5`).
- Sidebar sizing constants: `HERO_HEIGHT_PX = 500`, `CARD_HEIGHT_PX = 180`, `SIDEBAR_ITEM_HEIGHT_PX = 70`.
- Sidebar hidden below the `md` breakpoint entirely.
- Follow existing repo conventions: pages use bare `getStaticPaths`/`Astro.props` destructuring without an explicit `Props` interface (see `src/pages/posts/[...slug].astro`); reusable components (like the new `ArticleCard.astro`) declare an explicit `interface Props` (see `src/components/ProductCard.astro`).
- Tests build the site with `npm run build` in a `beforeAll` and assert against the generated files in `dist/` — this is the only test style used in this repo (see `tests/pages/*.test.ts`); there is no component-level test harness.

---

### Task 1: Paginated homepage route with hero + article cards

**Files:**
- Create: `src/components/ArticleCard.astro`
- Create: `src/pages/[...page].astro`
- Delete: `src/pages/index.astro`
- Modify: `tests/pages/home.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `CollectionEntry<'posts'>` from `astro:content`; existing `PostTag.astro` component (`<PostTag type={post.data.type} />`).
- Produces: `ArticleCard.astro` with `Props { post: CollectionEntry<'posts'> }`, rendering an `<a class="article-card ...">` linking to `/posts/${post.id}/`. Task 2 imports and uses this component as-is — its props and output structure do not change.

This task intentionally leaves the sidebar showing the full remaining post list on every page (today's behavior, just re-derived from the new data split) and does not yet hide it on mobile — that's Task 2's job, kept separate so it can be reviewed independently of the pagination/cards mechanics.

- [ ] **Step 1: Confirm the current post ordering the tests will rely on**

Run:
```bash
node -e "
const fs = require('fs');
const posts = fs.readdirSync('src/content/posts')
  .filter((f) => f.endsWith('.mdx'))
  .map((f) => {
    const content = fs.readFileSync('src/content/posts/' + f, 'utf-8');
    const date = content.match(/^date:\s*(.+)$/m)[1].trim();
    return { id: f.replace(/\.mdx$/, ''), date };
  })
  .sort((a, b) => new Date(b.date) - new Date(a.date));
posts.forEach((p, i) => console.log(i, p.date, p.id));
"
```

Expected output (22 posts, index 0 = newest): index 0 is
`when-gray-skies-call-for-warm-spice-an-apple-cinnamon-muffin-story`, indices
1–5 are `date-night-chicken-crust-pizza-with-whiskey-caramelized-onions-amp-bacon`,
`oaxacan-velvet-the-grounding-ritual-of-chicken-mole-negro`,
`the-pursuit-of-wok-hei-sesame-chicken-at-home`,
`suan-la-fen-a-journey-to-the-heart-of-sichuan-from-my-own-kitchen`,
`lemon-pepper-wet-an-atlanta-homecoming`; index 6 is
`pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual`; index 21
(the last/oldest) is `arancini-a-sicilian-street-food-sensation`.

If your output differs (e.g. because posts were added/removed/redated since
this plan was written), substitute the actual ids into the test assertions
below wherever this plan names a specific post id.

- [ ] **Step 2: Rewrite the failing test file**

Replace the entire contents of `tests/pages/home.test.ts` with:

```typescript
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

  it('shows the most recent post as the hero, only on page 1', () => {
    const page1 = readFileSync('dist/index.html', 'utf-8');
    expect(page1).toContain('home__featured');
    expect(page1).toContain('href="/posts/when-gray-skies-call-for-warm-spice-an-apple-cinnamon-muffin-story/"');
    expect(page1).toContain('When Gray Skies Call for Warm Spice: An Apple Cinnamon Muffin Story');

    const page2 = readFileSync('dist/2/index.html', 'utf-8');
    expect(page2).not.toContain('home__featured');
  });

  it('shows exactly 5 article cards on page 1, excluding the hero post', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    // Count occurrences of the card's own class rather than checking
    // individual post hrefs are absent: the sidebar is allowed to (and,
    // before Task 2's sizing, does) list every post regardless of which
    // page's cards are showing, so a post's href can legitimately appear
    // via the sidebar without being one of this page's cards.
    expect((html.match(/article-card/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/posts/date-night-chicken-crust-pizza-with-whiskey-caramelized-onions-amp-bacon/"');
    expect(html).toContain('href="/posts/oaxacan-velvet-the-grounding-ritual-of-chicken-mole-negro/"');
    expect(html).toContain('href="/posts/the-pursuit-of-wok-hei-sesame-chicken-at-home/"');
    expect(html).toContain('href="/posts/suan-la-fen-a-journey-to-the-heart-of-sichuan-from-my-own-kitchen/"');
    expect(html).toContain('href="/posts/lemon-pepper-wet-an-atlanta-homecoming/"');
  });

  it('renders a truncated excerpt on each article card', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('Skip the delivery with this ultimate low-carb date night pizza!');
  });

  it('paginates to a second page with the next 5 posts and a link back', () => {
    const html = readFileSync('dist/2/index.html', 'utf-8');
    expect((html.match(/article-card/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/posts/pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual/"');
    expect(html).toContain('href="/"');
  });

  it('renders numbered pagination controls with the current page marked', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__pagination');
    expect(html).toContain('aria-current="page"');
  });

  it('has a final page with just the single oldest leftover post', () => {
    const html = readFileSync('dist/5/index.html', 'utf-8');
    expect((html.match(/article-card/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/posts/arancini-a-sicilian-street-food-sensation/"');
  });

  it('tags each card with its post type', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('post-tag');
    expect(html).toContain('>Recipe<');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/pages/home.test.ts`

Expected: FAIL — `dist/2/index.html` and `dist/5/index.html` don't exist yet
(build only produces `dist/index.html` today), and `article-card` /
`line-clamp-3` / `home__pagination` don't appear anywhere.

- [ ] **Step 4: Create `src/components/ArticleCard.astro`**

```astro
---
import type { CollectionEntry } from 'astro:content';
import PostTag from './PostTag.astro';

interface Props {
  post: CollectionEntry<'posts'>;
}

const { post } = Astro.props;
---
<a
  href={`/posts/${post.id}/`}
  class="article-card flex flex-col overflow-hidden rounded-lg bg-white shadow-md md:flex-row"
>
  <img
    src={post.data.coverPhoto}
    alt={post.data.coverPhotoAlt}
    class="aspect-[3/2] w-full object-cover md:w-1/3"
  />
  <div class="p-4">
    <PostTag type={post.data.type} />
    <h3 class="mt-1 font-heading text-lg font-bold text-text">{post.data.title}</h3>
    {post.data.excerpt && (
      <p class="mt-2 line-clamp-3 text-sm text-text">{post.data.excerpt}</p>
    )}
  </div>
</a>
```

- [ ] **Step 5: Delete `src/pages/index.astro` and create `src/pages/[...page].astro`**

Delete `src/pages/index.astro`, then create `src/pages/[...page].astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import PostTag from '../components/PostTag.astro';
import ArticleCard from '../components/ArticleCard.astro';
import { getCollection } from 'astro:content';

const CARDS_PER_PAGE = 5;

export async function getStaticPaths({ paginate }) {
  const posts = (await getCollection('posts')).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
  const [hero, ...cardPosts] = posts;
  return paginate(cardPosts, {
    pageSize: CARDS_PER_PAGE,
    props: { hero, sidebarPool: cardPosts },
  });
}

const { page, hero, sidebarPool } = Astro.props;
const isFirstPage = page.currentPage === 1;
const pageNumbers = Array.from({ length: page.lastPage }, (_, i) => i + 1);
---
<BaseLayout title="Love Heat Relationship">
  <div class="mx-auto max-w-[1200px] px-4 py-8">
    <h1 class="sr-only">Love Heat Relationship</h1>
    <div class="grid grid-cols-1 gap-6 md:grid-cols-12">
      <div class="md:col-span-8">
        {isFirstPage && hero && (
          <a
            href={`/posts/${hero.id}/`}
            class="home__featured mb-6 block rounded-lg bg-white p-4 shadow-md"
          >
            <img
              src={hero.data.coverPhoto}
              alt={hero.data.coverPhotoAlt}
              class="mb-3 aspect-[3/2] w-full rounded-md object-cover"
            />
            <PostTag type={hero.data.type} />
            <h2 class="mt-1 font-heading text-xl font-bold text-text">{hero.data.title}</h2>
          </a>
        )}
        <div class="home__cards flex flex-col gap-6">
          {page.data.map((post) => (
            <ArticleCard post={post} />
          ))}
        </div>
        <nav class="home__pagination mt-6 flex items-center justify-center gap-4 text-sm font-medium" aria-label="Pagination">
          {page.url.prev ? (
            <a href={page.url.prev} class="text-text hover:text-accent">‹ Prev</a>
          ) : (
            <span class="text-accent-secondary">‹ Prev</span>
          )}
          <ul class="flex gap-2">
            {pageNumbers.map((n) => (
              <li>
                <a
                  href={n === 1 ? '/' : `/${n}/`}
                  aria-current={n === page.currentPage ? 'page' : undefined}
                  class={n === page.currentPage ? 'font-bold text-accent' : 'text-text hover:text-accent'}
                >{n}</a>
              </li>
            ))}
          </ul>
          {page.url.next ? (
            <a href={page.url.next} class="text-text hover:text-accent">Next ›</a>
          ) : (
            <span class="text-accent-secondary">Next ›</span>
          )}
        </nav>
      </div>
      <ul class="home__recent-list md:col-span-4">
        {sidebarPool.map((post) => (
          <li class="home__recent-item mb-3 rounded-lg bg-white p-3 shadow-md">
            <a href={`/posts/${post.id}/`} class="block">
              <PostTag type={post.data.type} />
              <h3 class="mt-1 font-heading text-sm font-medium text-text">{post.data.title}</h3>
            </a>
          </li>
        ))}
      </ul>
    </div>
  </div>
</BaseLayout>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/pages/home.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 7: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: `tests/pages/home.test.ts` now fully passes. Three other files —
`tests/content/collections.test.ts`, `tests/pages/article-post.test.ts`,
and `tests/pages/recipe-post.test.ts` — were already failing before this
task (they depend on seed content unrelated to the homepage, a
pre-existing gap confirmed by running `npx vitest run` before starting
this plan). Leave those alone; this task doesn't touch any file they
depend on.

- [ ] **Step 8: Commit**

```bash
git add src/components/ArticleCard.astro src/pages/[...page].astro tests/pages/home.test.ts
git rm src/pages/index.astro
git commit -m "feat: paginate homepage into a hero plus article/recipe cards"
```

---

### Task 2: Size the sidebar to the main column and hide it on mobile

**Files:**
- Modify: `src/pages/[...page].astro`
- Modify: `tests/pages/home.test.ts`

**Interfaces:**
- Consumes: `page.currentPage`, `page.data.length` from `Astro.props` (already destructured in Task 1); `sidebarPool` prop (already produced in Task 1's `getStaticPaths`).
- Produces: no new exports — this task only changes how many items of `sidebarPool` are rendered and adds a `hidden md:block` visibility class to the sidebar `<ul>`.

- [ ] **Step 1: Add failing assertions for sidebar sizing and mobile visibility**

Add these `it` blocks inside the existing `describe('home page', ...)` block
in `tests/pages/home.test.ts` (after the last existing test):

```typescript
  it('hides the sidebar below the md breakpoint', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__recent-list hidden md:block');
  });

  it('sizes the sidebar to roughly match the main column on each page', () => {
    const countItems = (html: string) => (html.match(/home__recent-item/g) ?? []).length;

    // Page 1: hero (500px) + 5 cards (180px each) = 1400px of main column,
    // at ~70px per sidebar row -> round(1400 / 70) = 20 items.
    const page1 = readFileSync('dist/index.html', 'utf-8');
    expect(countItems(page1)).toBe(20);

    // Page 2: no hero, 5 cards = 900px -> round(900 / 70) = 13 items.
    const page2 = readFileSync('dist/2/index.html', 'utf-8');
    expect(countItems(page2)).toBe(13);

    // Page 5 (last): no hero, 1 leftover card = 180px -> round(180 / 70) = 3 items.
    const page5 = readFileSync('dist/5/index.html', 'utf-8');
    expect(countItems(page5)).toBe(3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pages/home.test.ts`
Expected: FAIL — the sidebar currently renders all 21 `sidebarPool` items on
every page with no `hidden` class, so `countItems` returns 21 everywhere and
the `hidden md:block` string isn't present.

- [ ] **Step 3: Implement per-page sidebar sizing and mobile hiding**

In `src/pages/[...page].astro`, add the sizing constants near
`CARDS_PER_PAGE` and compute `sidebarPosts`:

```astro
const CARDS_PER_PAGE = 5;
const HERO_HEIGHT_PX = 500;
const CARD_HEIGHT_PX = 180;
const SIDEBAR_ITEM_HEIGHT_PX = 70;
```

After `const isFirstPage = page.currentPage === 1;`, add:

```astro
const mainColumnHeight = (isFirstPage ? HERO_HEIGHT_PX : 0) + page.data.length * CARD_HEIGHT_PX;
const sidebarCount = Math.max(1, Math.round(mainColumnHeight / SIDEBAR_ITEM_HEIGHT_PX));
const sidebarPosts = sidebarPool.slice(0, sidebarCount);
```

Then update the sidebar markup to use `sidebarPosts` instead of
`sidebarPool`, and hide it below `md`:

```astro
<ul class="home__recent-list hidden md:block md:col-span-4">
  {sidebarPosts.map((post) => (
```

Note the class order here matters for the test's substring match in Step
1 (`'home__recent-list hidden md:block'`) — keep `hidden md:block` adjacent
and immediately after `home__recent-list`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/pages/home.test.ts`
Expected: PASS — all tests green, including the two new ones.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS on every file except any pre-existing unrelated failures
noted in Task 1, Step 7.

- [ ] **Step 6: Commit**

```bash
git add src/pages/[...page].astro tests/pages/home.test.ts
git commit -m "feat: size homepage sidebar to the main column per page and hide it on mobile"
```

---

## Self-Review Notes

- **Spec coverage:** routing/pagination (Task 1), hero-only-on-page-1 (Task
  1), `ArticleCard` responsive/excerpt behavior (Task 1 — the `md:flex-row`
  / stacked-by-default classes give image-on-top on mobile per the design's
  mobile layout choice, and `line-clamp-3` covers excerpt truncation),
  pagination controls (Task 1), sidebar height-tracking (Task 2), sidebar
  hidden on mobile (Task 2), test updates removing stale post references
  (Task 1, full rewrite of `home.test.ts`). All spec sections are covered.
- **Type consistency:** `ArticleCard`'s `Props.post` type
  (`CollectionEntry<'posts'>`) matches what `page.data` yields from
  `getCollection('posts')` via `paginate`. `sidebarPool` and `hero` are
  passed through `paginate`'s `props` option in Task 1 and consumed
  unchanged in Task 2 — no renaming across tasks.
- **No placeholders:** every step has literal, runnable code and exact
  file paths; no "add validation" or "similar to Task N" placeholders.
