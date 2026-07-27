# Brand & Visual Design

## Kitchen Grounding
- Environment anchor colors/materials: exposed red brick walls, black granite/quartz countertops, warm gray driftwood-toned cabinet fronts, stainless steel appliances, light gray/white marble-veined backsplash, matte black fixtures/hardware, brushed steel faucet, arched window with white trim and abundant natural light, potted greenery/herbs as fresh accents
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): "big city life," "industrial," "relatable" — no specific reference sites given

## Palette
- Primary/background: #F5F1EA
- Text: #2B2521
- Accent: #A83E2C — primary brand/CTA accent, brick-terracotta
- Accent (secondary): #6B6560 — driftwood-gray, borders/secondary UI
- Contrast check: confirmed WCAG AA (13.4:1 text, 5.5:1 primary-accent UI) for #2B2521 on #F5F1EA
- Semantic state colors: error #C62828, sold-out #6B6560, sale/discount #256B39
- Note on how this was chosen to harmonize with the kitchen anchors above: light warm cream echoes the marble backsplash and natural window light; the terracotta primary is pulled directly from the exposed brick; the driftwood-gray secondary accent matches the cabinet fronts. Chosen over a dark-charcoal "Loft Charcoal" alternative and a cooler slate-blue "Brick & Steel Neutral" alternative.

## Tone & Imagery Direction
- Voice adjectives: easy to read, fun, inviting
- Admired writers/publications: None given
- Sample sentence: None given (author may revisit)
- Photography style: natural light (using the kitchen's arched window), possibly staged/styled down the road, but food itself always camera-ready — grounded in the actual kitchen space from Kitchen Grounding
- Imagery post-processing/treatment: no heavy filters — true-to-life, minimally processed real photos

## Typography
- Heading font: Poppins (weights 500/700), fallback stack `'Poppins', sans-serif` — geometric, rounded, energetic "big city" feel
- Body font: Karla, fallback stack `'Karla', sans-serif` — clean humanist sans, easy to read
- Scale notes: None captured
- *Depends on: Tone & Imagery Direction*

## Wordmark, Logo & Iconography
- Directional concept: "Skyline Skillet" — a skillet silhouette with a simple city skyline behind it, in terracotta (#A83E2C), literally pairing "big city life" with cooking
- Wordmark treatment: lowercase "lhr" set in tight-tracked Poppins bold
- Supporting icon style: simple 1.5px-stroke line icons in terracotta or driftwood-gray, rounded joins to match Poppins' geometric roundness — for nav, tags, and UI accents
- Note: directional only, not production-ready art
- *Depends on: Palette, Typography*

## Grid, Spacing & Mobile Layout
- Spacing scale: 8px base unit: 8/16/24/32/48/64
- Column grid: 12-column desktop grid, max-width 1200px
- Mobile-vs-desktop intent: single-column stack below 768px, grid collapses gracefully at that breakpoint

## Page Layouts

### Home / Listing
- Components: large featured-post card, a "Latest" sidebar of large image+headline+subheadline cards alongside it
- Arrangement: split layout — featured card on the left (wider column), a vertical stack of borderless, Food52-style image cards on the right under a "Latest" heading (each with cover photo, tag, headline, and excerpt subheadline), in `src/pages/[...page].astro`
- Notes: efficient use of the 12-column grid on wide screens; collapses to a single stacked column on mobile per the Grid, Spacing & Mobile Layout system
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### Recipe Post
- Components: hero photo, wide primary steps column, compact bordered "recipe card" ingredients sidebar, freeform content, kitchenware cards ("Shop this set") and affiliate links ("Also mentioned") as a footer strip
- Arrangement: steps take the wide primary column since they're most-referenced while actively cooking; ingredients live in a smaller bordered sidebar card alongside; kitchenware/affiliate sections form a card strip below the recipe body. Stacks to hero → recipe card → steps → kitchenware/affiliate strip on mobile
- Notes: builds on the existing `src/layouts/RecipeLayout.astro` sections (ingredients, steps, `Content`, kitchenware, affiliate links)
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### Article Post
- Components: hero photo, narrower magazine-width prose column (repeated heading+body sections), kitchenware cards ("Shop this set") in a sidebar, affiliate links ("Also mentioned") sidebar/end
- Arrangement: prose reads in a narrower magazine-style column rather than full content width; kitchenware cards follow alongside the prose in a sidebar on desktop instead of waiting until the article ends. Sidebar collapses to sit below the content on mobile
- Notes: builds on the existing `src/layouts/ArticleLayout.astro` sections (repeated heading/body sections, kitchenware, affiliate links)
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### Product / Shop Listing
- Components: full hero banner for the current set (set name + date range prominent), grid of product cards below (name, price, image, linking out to `vendorUrl`)
- Arrangement: leads with a large hero treatment for the active set, emphasizing that kitchenware rotates on a limited-time basis; fewer, larger product cards displayed beneath the hero
- Notes: forward-looking — this page and any content beyond the existing products/sets schemas don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### About
- Components: single long-form page, photo of the author (likely in the kitchen) beside the story/bio text
- Arrangement: classic photo-and-story layout, photo alongside body copy
- Notes: forward-looking — page and content model don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### Community
- Components: "coming soon" message with a newsletter signup form
- Arrangement: minimal placeholder — no other components yet
- Notes: forward-looking — page and content model don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
