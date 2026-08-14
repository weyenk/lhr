# Homepage: paginated article/recipe feed below the hero

**Status:** Done — merged PR #22 (e161d2c, 2026-07-26); `src/pages/[...page].astro` exists on `main`

## Problem

The homepage (`src/pages/index.astro`) currently shows exactly one featured
post (the "hero": full-width image, tag, title) alongside a sidebar that
lists every other post as a plain text link. There's no way to browse more
posts as full cards — you either read the hero or scan a long, image-less
list. The author wants more articles and recipes visible as real cards, with
the hero staying at the top.

## Design

### Routing & pagination

Replace `src/pages/index.astro` with `src/pages/[...page].astro`, using
Astro's built-in `paginate()` (from `getStaticPaths`). This produces static,
crawlable URLs:

- `/` — page 1
- `/2/`, `/3/`, ... — subsequent pages

No client-side JavaScript is needed for pagination.

### Data split

Given all posts sorted by date descending:

- **`hero`** — the single most recent post. Rendered only on page 1, in the
  same visual style as today (full-width image, `PostTag`, title).
- **`cardPosts`** — every post except the hero, paginated 5 per page via
  `paginate(cardPosts, { pageSize: 5 })`. Page 1 shows cards 1–5 (posts
  2nd–6th most recent overall), page 2 shows cards 6–10, etc. Pages 2+ start
  directly with cards — the hero is not repeated.
- **`sidebarPosts`** — drawn from the same pool as `cardPosts` (skipping the
  hero). Overlap with whatever's shown as cards on the current page is
  expected and fine.

### Sidebar length tracks the main column per page

The sidebar's item count is recalculated on every paginated page so its
height roughly matches the main column's height on that same page, instead
of listing a large fixed number of posts regardless of how much is in the
main column (today's behavior, and visually mismatched on short pages).

Approach: rough per-item height estimates as tunable constants, used only
to size the sidebar, not for any pixel-perfect layout:

```
HERO_HEIGHT_PX = 500
CARD_HEIGHT_PX = 180
SIDEBAR_ITEM_HEIGHT_PX = 70
```

```
mainColumnHeight = (page 1 ? HERO_HEIGHT_PX : 0) + cardsOnThisPage.length * CARD_HEIGHT_PX
sidebarCount = max(1, round(mainColumnHeight / SIDEBAR_ITEM_HEIGHT_PX))
sidebarPosts = pool.slice(0, sidebarCount)
```

Example: last page with a single leftover card → `mainColumnHeight = 180` →
`sidebarCount = round(180/70) = 3`. Page 1 with hero + 5 cards →
`mainColumnHeight = 500 + 900 = 1400` → `sidebarCount = 20`.

These three constants live as named constants at the top of the page file
so they're easy to retune after eyeballing the real layout — they are
estimates, not something the design depends on being exact.

### Sidebar visibility

The sidebar (`md:col-span-4` column) is hidden entirely below the `md`
breakpoint (`hidden md:block`). On mobile, the page is just the hero (page 1
only) followed by the paginated cards and pagination controls — no sidebar.

### `ArticleCard.astro` (new component)

Props: `post` (a post collection entry).

Renders a card matching the site's existing visual language (`rounded-lg
bg-white shadow-md`, same `PostTag` component, same heading font):

- **`md:` and up:** horizontal layout — thumbnail image on the left
  (roughly a third of the card width, `aspect-[3/2] object-cover`), tag +
  title + excerpt stacked on the right.
- **Below `md`:** stacked layout — image full-width on top, then tag,
  title, and excerpt below (matching how the hero already stacks on
  mobile).
- **Excerpt:** the post's existing frontmatter `excerpt` field, truncated
  with Tailwind's `line-clamp-3` so every card stays a consistent height
  regardless of excerpt length.

### Pagination controls

Rendered below the card list on every page: numbered links (`1 2 3 ...`)
plus `‹ Prev` / `Next ›`, using `page.url.prev` / `page.url.next` /
`page.currentPage` / `page.lastPage` from Astro's pagination API. Current
page is highlighted using the site's existing accent color
(`text-accent` / `--color-accent`). With ~22 posts and 5 per page, this is
~4-5 page links total — no need for ellipsis/truncation logic.

### Test updates

`tests/pages/home.test.ts` currently references two posts that no longer
exist in `src/content/posts` (`jerk-chicken-platter`, `why-coastal-blue`) —
a pre-existing, unrelated staleness, not caused by this change. While
rewriting this test file for pagination, its post references will be
updated to posts that currently exist, so the test suite accurately
reflects the new homepage rather than continuing to assert on removed
content.

New/updated assertions:

- `dist/index.html` — site title, `home__featured` hero block, at least one
  `ArticleCard`-rendered post, sidebar list, and a link to `/2/`.
- `dist/2/index.html` — a different set of posts than page 1, and a link
  back to `/`.

## Out of scope

- Fixing the fact that every current post is `type: recipe` (no `article`
  posts exist yet) — a content issue, unrelated to this layout change.
- Any change to individual post pages, the `about`/`community` pages, or
  the sidebar's own visual styling beyond hiding it on mobile and changing
  its item count.
