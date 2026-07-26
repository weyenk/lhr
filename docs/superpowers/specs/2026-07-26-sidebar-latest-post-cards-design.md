# Homepage sidebar: Food52-style image cards instead of a plain text list

## Problem

The homepage sidebar (`src/pages/[...page].astro`, the `home__recent-list`
column, added by the already-merged paginated-feed work) currently lists
each post as plain text only: a small `bg-white shadow-md` card with just a
`PostTag` and title, no image or excerpt. Depending on the page, the sidebar
can show up to ~20 of these rows, sized by a height-matching calculation
(`sidebarCount = round(mainColumnHeight / SIDEBAR_ITEM_HEIGHT_PX)`) meant to
keep the sidebar visually as tall as the main column on that page.

The author wants a "Latest"-style sidebar closer to Food52's: fewer,
larger items, each with its cover image, headline, and a subheadline (the
post's existing `excerpt` frontmatter field), instead of a long scan of
bare titles. The existing height-matching behavior should be preserved,
just retuned for the new, taller item height — not replaced with a fixed
item count.

## Design

### `SidebarPostCard.astro` (new component)

A small, sidebar-only component in `src/components/`, following the
existing pattern of focused components (`ArticleCard.astro`, `ProductCard.astro`).

Props: `post: CollectionEntry<'posts'>`.

Renders a **borderless, stacked** card — no `bg-white`/`shadow-md` wrapper,
image on top, text below, directly on the page background:

```
<a href={`/posts/${post.id}/`} class="block">
  <img src={post.data.coverPhoto} alt={post.data.coverPhotoAlt}
       class="mb-2 aspect-[3/2] w-full rounded-md object-cover" />
  <PostTag type={post.data.type} />
  <h3 class="mt-1 font-heading text-base font-bold text-text">{post.data.title}</h3>
  {post.data.excerpt && (
    <p class="mt-1 line-clamp-2 text-sm text-accent-secondary">{post.data.excerpt}</p>
  )}
</a>
```

- `line-clamp-2` on the excerpt keeps it reading as a subheadline (Food52's
  are effectively one line) while tolerating slightly longer excerpt text
  without overflowing.
- This is a distinct component from `ArticleCard.astro`, not a variant of
  it: `ArticleCard` is image-left/text-right on desktop and carries the
  white shadow card — a different layout serving the wider main column.
  Forcing one component to cover both (horizontal+card vs. stacked+borderless)
  would add conditional layout branches to a component the main column
  already depends on, for a shape only the sidebar needs.

### `src/pages/[...page].astro` changes

- Sidebar markup changes from `<li class="home__recent-item mb-3 rounded-lg
  bg-white p-3 shadow-md">` + inline tag/title, to `<li class="home__recent-item">`
  wrapping `<SidebarPostCard post={post} />`. The `<ul>` gets `flex flex-col
  gap-6` (larger gap than the old `mb-3`, since there's no card border to
  separate items anymore). The `home__recent-item` class name is kept as-is
  purely so the existing sizing test's item-counting helper keeps working
  unchanged.
- `SIDEBAR_ITEM_HEIGHT_PX` is retuned from `98` to **`380`**, an estimate
  for one image (aspect 3/2 at the sidebar's ~360px column width ≈ 240px)
  plus tag/title/excerpt text (~90px) plus the new gap (~24px). Like the
  other two height constants, this is a tunable estimate to eyeball against
  the real rendered layout, not a value the design depends on being exact.
- `HERO_HEIGHT_PX` (655) and `CARD_HEIGHT_PX` (200) are unchanged — only
  the sidebar's own item height changes.
- Everything else about `[...page].astro` (hero, `ArticleCard` main-column
  cards, pagination, mobile `hidden md:block` sidebar behavior) is
  unchanged.

### Sidebar draws from posts after the current page's cards

The existing `sidebarPool: cardPosts` prop always slices from index 0, so
every page's sidebar showed the same top-of-pool posts regardless of which
page's cards were showing — on page 1 specifically, all 4 sidebar posts
were also 4 of the 5 main-column cards. That was tolerable when the
sidebar was plain text; it's much more visible once both places show the
same cover photo. `sidebarPosts` now starts right after the current page's
own cards, using Astro's pagination `page.end` (the 0-based index, within
`cardPosts`, of the current page's last card):

```
const sidebarOffset = page.end + 1;
const sidebarPosts = sidebarPool.slice(sidebarOffset, sidebarOffset + sidebarCount);
```

On the last page, this can legitimately slice past the end of the pool —
`Array.slice` on an out-of-range start just returns `[]`, so the sidebar is
empty there rather than erroring or repeating earlier posts. That's the
same "don't show more than you have room for" tolerance the sidebar
already had.

### Sidebar count after retuning

With `SIDEBAR_ITEM_HEIGHT_PX = 380`, `sidebarCount = round(mainColumnHeight / 380)`,
and the offset above applied:

- Page 1 (hero + 5 cards, `cardPosts[0..4]`): `655 + 5*200 = 1655` →
  `round(1655/380) = 4` → sidebar shows `cardPosts[5..8]` (no overlap with
  the 5 main-column cards).
- Page 2 (5 cards, no hero, `cardPosts[5..9]`): `5*200 = 1000` →
  `round(1000/380) = 3` → sidebar shows `cardPosts[10..12]`.
- Last page (1 leftover card, `cardPosts[20..20]`, the only index left in
  a 21-post pool): `200` → `round(200/380) = 1`, but `sidebarOffset` is 21
  against a 21-length pool, so the slice is empty → sidebar shows **0**
  items on the last page.

These replace the current test's expected counts of 17 / 10 / 2 for the
same three pages.

### Test updates (`tests/pages/home.test.ts`)

- `'sizes the sidebar to roughly match the main column on each page'`:
  update expected counts to 4 / 3 / 0 per the retuned constant and offset
  above (page 1 / page 2 / last page).
- `'hides the sidebar below the md breakpoint'`: unchanged, still asserts
  `home__recent-list hidden md:block`.
- New assertion: sidebar items render an `<img>` and the post's excerpt
  text (mirroring the existing "renders a truncated excerpt" pattern for
  `ArticleCard`), confirming the sidebar now shows images/subheadlines
  rather than bare titles. Since the sidebar now starts at `cardPosts[5]`
  on page 1 (see offset above), this checks for
  `pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual`'s
  excerpt: "A taste of Sicily in every bite: Pistachio granita with buttery
  brioche con tuppo—because summer mornings deserve a little magic."
  (note the em dash before "because").
- New assertion: a sidebar item does **not** carry `bg-white`/`shadow-md`
  (confirms the borderless treatment), while the hero and main-column
  `ArticleCard`s still do (unchanged).
- New assertion: the sidebar `<ul>` carries a spacing utility (`space-y-`)
  and not a bare `flex` class — `flex`/`flex-col`/`gap-*` collide with the
  `hidden`/`md:block` display toggle already on that element (Tailwind
  resolves same-specificity utilities by stylesheet order, not class-list
  order, so `hidden` or the `md:block` media-query rule always wins over
  `flex`, silently making `gap-*` inert). `space-y-*` applies margin to
  children instead of relying on the element being a flex container, so it
  works regardless of which display utility wins — the same pattern
  already used for the sidebar in `src/layouts/ArticleLayout.astro`
  (`article-post__sidebar space-y-4 md:col-span-4`).

## Out of scope

- Any change to `ArticleCard.astro`, the hero card, or pagination controls.
- A "view all posts" / archive link for posts that fall outside both the
  main column and the sidebar's count on a given page — dropped for now,
  same as the original sidebar's behavior of simply not showing posts it
  doesn't have room for.
- Changing sidebar visibility on mobile (already hidden below `md`,
  unaffected by this change).
