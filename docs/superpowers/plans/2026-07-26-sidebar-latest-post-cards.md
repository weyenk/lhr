# Sidebar Latest Post Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage sidebar's plain-text post list with bigger, borderless, Food52-style cards (image, tag, headline, subheadline), retuning the existing height-matching sidebar sizing for the new taller item height.

**Architecture:** One new presentational component, `SidebarPostCard.astro`, renders a single sidebar item (image on top, tag/title/excerpt below, no card wrapper). `src/pages/[...page].astro` swaps its inline `<li>` markup for this component and retunes one constant (`SIDEBAR_ITEM_HEIGHT_PX`). No data-flow, schema, or routing changes — `post.data.excerpt` already exists on every post.

**Tech Stack:** Astro components (`.astro`), Tailwind utility classes, Vitest + `execSync('npm run build')` for page-level build tests (this repo's existing pattern — there is no per-component unit test harness; static markup components like `ArticleCard.astro` are verified via the page build test, not a dedicated component test file).

## Global Constraints

- `HERO_HEIGHT_PX = 655` and `CARD_HEIGHT_PX = 200` in `src/pages/[...page].astro` stay unchanged — only `SIDEBAR_ITEM_HEIGHT_PX` changes, from `98` to `380`.
- `SidebarPostCard.astro` is a **new, separate** component — do not add a variant/prop to `ArticleCard.astro` to cover this case.
- Sidebar cards are borderless: no `bg-white` / `shadow-md` classes anywhere in the sidebar's markup.
- Excerpt text on sidebar cards uses `line-clamp-2` (not `line-clamp-3`, which is `ArticleCard`'s value).
- The `home__recent-item` class name on the sidebar `<li>` must be preserved (existing test tooling counts occurrences of this exact string).
- No changes to `ArticleCard.astro`, the hero block, pagination controls/markup, or the sidebar's `hidden md:block` mobile visibility.
- **[Added after task-review round 1]** Sidebar spacing must use `space-y-6`, not `flex flex-col gap-6` — the latter is inert because `flex` collides with the `hidden`/`md:block` display toggle already on the same element (Tailwind resolves same-specificity utilities by stylesheet order, not class-list order, so `hidden`/`md:block` always wins and `gap-*` never applies). See Task 1 Step 5 (revised).
- **[Added after task-review round 1, per author decision]** The sidebar must not repeat posts already shown as main-column cards on the same page: `sidebarPosts` is sliced starting right after the current page's cards (`page.end + 1`), not from index 0 of the pool. See Task 1 Steps 1, 2, 5 (revised).

---

### Task 1: Sidebar image cards

**Files:**
- Create: `src/components/SidebarPostCard.astro`
- Modify: `src/pages/[...page].astro:9` (constant), `src/pages/[...page].astro:81-90` (sidebar markup)
- Test: `tests/pages/home.test.ts:79-94` (update), plus one new test in the same file

**Interfaces:**
- Consumes: `CollectionEntry<'posts'>` (from `astro:content`) — same type `ArticleCard.astro` already takes as its `post` prop. Fields used: `post.id`, `post.data.coverPhoto`, `post.data.coverPhotoAlt`, `post.data.type`, `post.data.title`, `post.data.excerpt` (optional).
- Produces: `SidebarPostCard` — an Astro component with a single prop `post: CollectionEntry<'posts'>`, imported and used in `src/pages/[...page].astro`.

- [ ] **Step 1: Update the sidebar-sizing test's expected counts (REVISED after task-review round 1)**

In `tests/pages/home.test.ts`, replace the existing `'sizes the sidebar to roughly match the main column on each page'` test (currently lines 79-94) with:

```typescript
  it('sizes the sidebar to roughly match the main column on each page', () => {
    const countItems = (html: string) => (html.match(/home__recent-item/g) ?? []).length;

    // Page 1: hero (655px) + 5 cards (200px each) = 1655px of main column,
    // at ~380px per sidebar row -> round(1655 / 380) = 4 items.
    const page1 = readFileSync('dist/index.html', 'utf-8');
    expect(countItems(page1)).toBe(4);

    // Page 2: no hero, 5 cards = 1000px -> round(1000 / 380) = 3 items.
    const page2 = readFileSync('dist/2/index.html', 'utf-8');
    expect(countItems(page2)).toBe(3);

    // Page 5 (last): no hero, 1 leftover card = 200px -> round(200 / 380) = 1
    // would-be item, but the sidebar now starts right after this page's own
    // card (see Step 5's sidebarOffset) and there are no posts left in the
    // pool past that point, so the sidebar is empty here.
    const page5 = readFileSync('dist/5/index.html', 'utf-8');
    expect(countItems(page5)).toBe(0);
  });
```

- [ ] **Step 2: Add a new test asserting sidebar cards are borderless, spaced image cards (REVISED after task-review round 1)**

Add this test directly after the one from Step 1, in the same `describe` block:

```typescript
  it('renders sidebar items as borderless image cards with a subheadline', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    const sidebarMatch = html.match(/<ul class="home__recent-list[^>]*>[\s\S]*?<\/ul>/);
    expect(sidebarMatch).not.toBeNull();
    const sidebarHtml = sidebarMatch![0];

    expect(sidebarHtml).toContain('<img');
    expect(sidebarHtml).toContain('A taste of Sicily in every bite: Pistachio granita with buttery brioche con tuppo—because summer mornings deserve a little magic.');
    expect(sidebarHtml).not.toContain('bg-white');
    expect(sidebarHtml).not.toContain('shadow-md');

    const listOpenTag = sidebarHtml.match(/<ul class="home__recent-list[^>]*>/)![0];
    expect(listOpenTag).toMatch(/\bspace-y-/);
    expect(listOpenTag).not.toMatch(/(^|\s)flex(\s|")/);
  });
```

This relies on `pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual`
being the first post the sidebar shows on page 1. With the offset from Step 5
(`sidebarOffset = page.end + 1`), page 1's cards occupy `cardPosts[0..4]`
(confirmed by the existing `'shows exactly 5 article cards...'` test), so the
sidebar starts at `cardPosts[5]` — which is this post (confirmed by the
existing `'paginates to a second page...'` test, which shows it as page 2's
first main-column card, i.e. index 5 of `cardPosts`).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/pages/home.test.ts`
Expected: The build succeeds, but both tests from Steps 1-2 FAIL — sizing test fails because the sidebar still renders 17/10/2 items (old `SIDEBAR_ITEM_HEIGHT_PX = 98`), and the new test fails because the sidebar still has no `<img>` and still contains `bg-white`/`shadow-md`.

- [ ] **Step 4: Create `SidebarPostCard.astro`**

Create `src/components/SidebarPostCard.astro`:

```astro
---
import type { CollectionEntry } from 'astro:content';
import PostTag from './PostTag.astro';

interface Props {
  post: CollectionEntry<'posts'>;
}

const { post } = Astro.props;
---
<a href={`/posts/${post.id}/`} class="block">
  <img
    src={post.data.coverPhoto}
    alt={post.data.coverPhotoAlt}
    class="mb-2 aspect-[3/2] w-full rounded-md object-cover"
  />
  <PostTag type={post.data.type} />
  <h3 class="mt-1 font-heading text-base font-bold text-text">{post.data.title}</h3>
  {post.data.excerpt && (
    <p class="mt-1 line-clamp-2 text-sm text-accent-secondary">{post.data.excerpt}</p>
  )}
</a>
```

- [ ] **Step 5: Wire `SidebarPostCard` into `src/pages/[...page].astro`, retune the constant, and offset the sidebar past the current page's cards (REVISED after task-review round 1)**

In `src/pages/[...page].astro`, add the import alongside the existing `ArticleCard` import (near line 4):

```astro
import SidebarPostCard from '../components/SidebarPostCard.astro';
```

Change line 9 from:

```astro
const SIDEBAR_ITEM_HEIGHT_PX = 98;
```

to:

```astro
const SIDEBAR_ITEM_HEIGHT_PX = 380;
```

Change the line that currently reads:

```astro
const sidebarPosts = sidebarPool.slice(0, sidebarCount);
```

to:

```astro
const sidebarOffset = page.end + 1;
const sidebarPosts = sidebarPool.slice(sidebarOffset, sidebarOffset + sidebarCount);
```

(`page.end` is Astro's built-in pagination field: the 0-based index, within
the array passed to `paginate()` — here, `cardPosts` — of the current
page's last item. Starting the sidebar slice right after it guarantees no
post shown as a main-column card on this page is repeated in the sidebar.
`Array.slice` returns `[]` when the start index is past the array's end,
which is expected and fine on the last page — see Step 1.)

Replace the sidebar block (currently lines 81-90):

```astro
      <ul class="home__recent-list hidden md:block md:col-span-4">
        {sidebarPosts.map((post) => (
          <li class="home__recent-item mb-3 rounded-lg bg-white p-3 shadow-md">
            <a href={`/posts/${post.id}/`} class="block">
              <PostTag type={post.data.type} />
              <h3 class="mt-1 font-heading text-sm font-medium text-text">{post.data.title}</h3>
            </a>
          </li>
        ))}
      </ul>
```

with:

```astro
      <ul class="home__recent-list hidden md:block md:col-span-4 space-y-6">
        {sidebarPosts.map((post) => (
          <li class="home__recent-item">
            <SidebarPostCard post={post} />
          </li>
        ))}
      </ul>
```

`space-y-6` (not `flex flex-col gap-6`) — `flex` would collide with the
`hidden`/`md:block` display toggle already on this element and silently
disable `gap-*` (Tailwind resolves same-specificity utilities by
stylesheet order, not class-list order, so `hidden`/`md:block` always
wins over `flex`). `space-y-*` applies margin between children instead,
so it works regardless of which display utility wins — the same pattern
already used for `src/layouts/ArticleLayout.astro`'s sidebar
(`article-post__sidebar space-y-4 md:col-span-4`).

Note: `PostTag` is still used elsewhere in this file (the hero block), so its import stays.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- tests/pages/home.test.ts`
Expected: All tests in the file PASS, including the two from Steps 1-2.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: All tests PASS (confirms no other suite — e.g. `tests/pages/article-post.test.ts` — depended on the old sidebar markup).

- [ ] **Step 8: Commit**

```bash
git add src/components/SidebarPostCard.astro src/pages/\[...page\].astro tests/pages/home.test.ts
git commit -m "feat: redesign homepage sidebar as Food52-style image cards

Replaces the plain-text sidebar list with borderless image+headline+
subheadline cards, retuning the height-matching sidebar sizing (98px ->
380px per item) for the new, taller card height."
```

---

## Self-Review Notes

- **Spec coverage:** `SidebarPostCard.astro` (component design) — Task 1 Step 4. Sidebar markup/constant/offset changes — Task 1 Step 5. Sizing recalculation (4/3/0) — Task 1 Step 1. New image/excerpt/borderless/spacing test — Task 1 Step 2. Out-of-scope items (ArticleCard, hero, pagination, mobile visibility) — untouched by every step above.
- **Placeholder scan:** none found — every step has literal code/commands.
- **Type consistency:** `SidebarPostCard`'s `post` prop type (`CollectionEntry<'posts'>`) matches `ArticleCard`'s existing `post` prop type exactly; both are used the same way at call sites (`<Component post={post} />`).

### Revision history

Task-review round 1 (after the initial implementation landed) found the
`flex flex-col gap-6` sidebar spacing was inert (see Global Constraints),
and the author decided — once it was pointed out that images made it
obvious — that the sidebar shouldn't repeat posts already shown as
main-column cards on the same page. Steps 1, 2, and 5 above reflect both
fixes directly rather than being left as the original, now-superseded
text; the design spec (`docs/superpowers/specs/2026-07-26-sidebar-latest-post-cards-design.md`)
carries the same revisions.

The final whole-branch review found no Critical issues, but flagged the
sidebar as an unlabeled column with no accessible name — the author
approved adding a "Latest" heading (`home__recent-list`'s `hidden
md:block md:col-span-4` classes moved to a new wrapping `<div
class="home__sidebar">` that holds the heading and the list). It also
found the design spec still documented the pre-fix `flex flex-col gap-6`
construct, that the no-duplicate-posts guarantee had no direct test, a
stale test comment referencing a superseded plan's "Task 2", and that
`docs/BRAND.md` still described the old compact text-list sidebar. All
were fixed directly in the same fix wave; see the design spec's own
"Sidebar heading" section for the heading's final shape.
