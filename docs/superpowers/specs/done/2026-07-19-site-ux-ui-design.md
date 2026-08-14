# Site UX/UI Design

**Status:** Done — merged PR #9 (f5951c9, 2026-07-19); `BaseLayout.astro`, `about.astro`, and restyled `RecipeLayout`/`ArticleLayout` exist on `main`

## Purpose

`docs/BRAND.md` established the site's palette, typography, spacing/grid system, and directional intent for each page. The site itself is currently unstyled — no CSS, no header/nav/footer, no design tokens wired up anywhere. `src/pages/index.astro` renders a bare `<ul>` of post links, and `RecipeLayout.astro` / `ArticleLayout.astro` render raw, unstyled HTML.

This spec turns BRAND.md's direction into an implementable UX/UI design: a global layout (header, nav, footer), a Tailwind-based design token setup, and page-level component layouts for the four pages currently in scope.

## Scope

In scope:
- **Home** (`src/pages/index.astro`) — existing, gets restyled
- **Recipe Post** (`src/layouts/RecipeLayout.astro`) — existing, gets restyled
- **Article Post** (`src/layouts/ArticleLayout.astro`) — existing, gets restyled
- **About** (new — `src/pages/about.astro`) — new static page, no content-collection needed
- Global layout: header/nav, footer, mobile navigation (`src/layouts/BaseLayout.astro`)
- Shared components: `ProductCard.astro`, `AffiliateLink.astro` restyled into the shared card language

Out of scope (deferred to future brainstorms once their content models exist):
- Product / Shop Listing page
- Community page

## Implementation approach

**Tailwind CSS**, chosen over plain CSS custom properties and per-component hardcoded values. The site has zero styling infrastructure today, so this is a clean adoption rather than a migration. Tailwind's default `md:` breakpoint (768px) matches BRAND.md's mobile breakpoint exactly, so no custom breakpoint config is needed.

Tailwind config extends the default theme with:
- **Colors**: `background: #F5F1EA`, `text: #2B2521`, `accent: #A83E2C` (primary/CTA), `accent-secondary: #6B6560` (borders/secondary UI), plus semantic colors `error: #C62828`, `sold-out: #6B6560`, `sale: #256B39`
- **Fonts**: `heading: ['Poppins', 'sans-serif']` (weights 500/700), `body: ['Karla', 'sans-serif']` (weights 400/500/700)
- **Spacing**: extend scale with the 8px-base steps — 8/16/24/32/48/64 (Tailwind's default scale already covers these as 2/4/6/8/12/16, so this is a confirmation of usage rather than a new scale)
- **Container**: `max-width: 1200px`, 12-column grid on desktop (`grid-cols-12`), collapsing to a single-column stack below 768px

## Global layout

### Header / navigation

Centered masthead pattern: the "lhr" wordmark centered at the top, with a nav row (Home, About) centered directly below it, separated from the page body by a thin `accent-secondary`-colored border.

Below 768px, the nav row is replaced by a hamburger icon (a 1.5px-stroke line icon in terracotta, per BRAND.md's iconography direction) that toggles a simple dropdown containing the same nav links. The toggle needs a small inline script in `BaseLayout.astro` — no new JS dependency, just a click handler that shows/hides the dropdown and sets `aria-expanded` on the button.

The hamburger button gets an `aria-label` (e.g. "Toggle navigation") and a visible focus-visible outline in the accent color, consistent with BRAND.md's confirmed AA contrast pairs.

### Footer

Minimal: centered wordmark, a copyright line, and one or two social icon placeholders (same 1.5px-stroke line icon style), separated from the page body by a thin top border. No functional elements (no newsletter signup) since Community is out of scope for this pass.

### Card language

A single shared visual treatment is used everywhere a "card" appears: rounded corners, a soft box-shadow, white fill. This applies to the Home featured-post card, Home recent-post list items, the Recipe ingredients card, the Recipe/Article kitchenware and affiliate-link cards, and `ProductCard.astro`.

## Page layouts

### Home (`src/pages/index.astro`)

12-column grid on desktop: a featured post card spans 8 columns on the left, a vertically stacked list of recent posts spans 4 columns on the right. Each list item is a small card showing a type tag (Recipe/Article, in small uppercase terracotta text), title, and date.

Below 768px, the grid collapses to a single column: featured card first, then the recent-post list stacked beneath it.

Replaces the current bare `<ul>` of post links entirely.

### Recipe Post (`src/layouts/RecipeLayout.astro`)

Full-width hero photo, then a type tag + title, then a two-column area: the steps list takes the wide primary column (8 cols) since it's most-referenced while actively cooking, and the ingredients live in a smaller shadow-card sidebar (4 cols) alongside, using the same shared card treatment described below. Below that, a kitchenware ("Shop this set") and affiliate-links ("Also mentioned") card strip spans full width, cards laid out side by side on desktop.

Below 768px: hero → ingredients card → steps → kitchenware/affiliate strip, all single-column.

### Article Post (`src/layouts/ArticleLayout.astro`)

Full-width hero photo, then a type tag + title, then a two-column area: a narrower magazine-width prose column (8 cols, ~60ch max-width for readability) on the left, with a kitchenware/affiliate-links sidebar (4 cols) alongside it on the right — rather than waiting until the end of the article.

Below 768px: hero → prose (repeated heading/body sections) → sidebar cards stacked beneath.

### About (new — `src/pages/about.astro`)

New static page, single long-form layout: an author photo (fixed width, ~220-280px) sits beside the bio/story prose. No content-collection or schema needed — this is static markup, not managed content.

Below 768px: photo stacks above the bio text.

## Shared components

- **Type tag/badge**: small uppercase label in terracotta, used to mark Recipe vs. Article on Home list items and post pages.
- **Button/CTA style**: terracotta fill, white text, rounded corners, bold — reserved for explicit calls to action. *Not implemented in this pass*: the approved implementation plan kept `ProductCard.astro` as a plain shadow card (matching the shared card language) with a driftwood-gray "Shop this set" section heading rather than a terracotta CTA button on the card itself. Revisit if a dedicated CTA button treatment is wanted later.
- **`ProductCard.astro`**: restyled into the shared card language — product image, name, price, linking out to `vendorUrl`.
- **`AffiliateLink.astro`**: restyled into the shared card language as a simple text/icon link row.
- **Icons**: 1.5px-stroke line icons with rounded joins, in terracotta or driftwood-gray, used for the hamburger toggle and footer social placeholders.

## Accessibility

Reuses BRAND.md's confirmed WCAG AA contrast pairs (13.4:1 text-on-background, 5.5:1 accent-on-background). The hamburger nav toggle gets an `aria-label` and `aria-expanded` state, and all interactive elements (nav links, hamburger button, CTA buttons) get a visible focus-visible outline in the accent color.

## Explicitly out of scope

- Product / Shop Listing page design
- Community page design
- Newsletter signup component
- Dark mode / theme switching (not raised, not requested)
