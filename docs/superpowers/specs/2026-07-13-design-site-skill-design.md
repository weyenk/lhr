# `/design-site` Skill — Design

**Date:** 2026-07-13
**Status:** Approved for planning

## 1. Overview & Goals

The site currently has zero visual design — `src/pages/index.astro` renders an unstyled `<h1>` and a bare `<ul>` of post links, and no page beyond the post templates and home listing exists yet. The author is not a designer and doesn't want to make these calls unassisted; she wants a repeatable, guided process she can run herself, later, that produces a concrete design she (or a future implementation session) can build from.

This spec covers a one-time (but rerunnable) design interview — invoked as `/design-site` — that walks the author through brand fundamentals (palette, tone, typography, wordmark/logo/iconography direction), a shared grid/spacing/mobile-layout baseline, and layout intent for every planned page, using the actual physical space her content is photographed in as a grounding constraint rather than working from abstract taste alone. The skill's only output is a written spec (`docs/BRAND.md`); it does not touch any CSS, components, or other implementation.

**Primary success criteria:**
- Running `/design-site` produces `docs/BRAND.md` with a decision recorded for every topic below.
- Palette, typography, and imagery-direction decisions are explicitly grounded in the author's real kitchen/photography space, not chosen in the abstract.
- Voice/tone is discovered fresh from the author — the skill never treats existing seed/placeholder posts (e.g. "Jerk Chicken for a Crowd") as evidence of an established voice.
- Palette choices meet a WCAG AA contrast baseline (4.5:1 text, 3:1 UI) and include semantic state colors (error, sold-out, sale) — accessibility isn't left for a later implementation pass to discover on its own.
- A shared grid/spacing scale and mobile-vs-desktop layout intent are established once, before the six page-layout topics, so those six aren't each deciding structure ad hoc.
- The skill is rerunnable: if `docs/BRAND.md` already exists, it asks whether to start fresh or revise specific sections, leaving untouched sections exactly as they were — except that revising a foundational section (Palette or Typography) prompts a check on sections that depend on it (Logo/Iconography, the six page layouts) rather than leaving them silently stale.
- The skill never invokes an implementation skill or writes application code — turning the finished doc into an actual styled site is a separate, later plan.

## 2. Skill Mechanics

- Lives at `.claude/skills/design-site/SKILL.md`, invoked as `/design-site`.
- Tools needed: `Read`, `Write`, `Edit`, `Glob`, `AskUserQuestion`, `WebFetch` (to look at any reference sites the author names), and the visual companion (the Artifact-based mockup mechanism used by `superpowers:brainstorming`).
- **Step 0:** check whether `docs/BRAND.md` exists.
  - **Doesn't exist** → run the full interview, all eleven topics below, in order.
  - **Exists** → ask the author: start over (redo everything) or revise specific sections (multiSelect list of the eleven topic names). Only the chosen topics rerun; every other section's existing content is left untouched in the final doc — **except**: if Palette and/or Typography is selected, the skill also asks whether the sections that depend on them (Wordmark/Logo/Iconography, and the six page-layout sections) should be re-reviewed too. If the author declines, those dependent sections are left as-is but flagged in the doc as based on a prior Palette/Typography that has since changed.
- Questions go one at a time. For genuinely visual choices (palette, typography, logo, every page layout), the skill offers the visual companion once, early, the same way `superpowers:brainstorming` offers it — and if accepted, generates real options to react to (swatches, font samples, rough wireframes, directional logo concepts) rather than asking the author to imagine things from a text description. If declined, or if a later topic isn't actually visual, the skill falls back to describing options in text.
- `docs/BRAND.md` is written directly, one topic's section at a time, as the interview proceeds — no separate approval gate before writing, since this is author-authored-via-interview content (same treatment as `/setup`'s `docs/BUSINESS-PLAN.md`/`docs/PERSONA.md`).
- The skill's terminal state is the finished/updated `docs/BRAND.md`. It never invokes `writing-plans`, `frontend-design`, or any other implementation skill itself.

## 3. Interview Topics

Eleven topics, each producing one `##` section of `docs/BRAND.md`. Order matters: brand fundamentals (mood, palette, tone, type) are locked before the grid/spacing baseline, which is locked before the six page layouts that all reference it.

1. **Kitchen grounding & mood** *(photos + text)* — the author shares photos of the actual space her content is/will be photographed in. The skill names back what it observes as fixed environmental colors/materials (e.g., black granite, exposed red brick, warm driftwood-gray cabinetry, stainless steel, matte black hardware) and records these as anchor constraints the palette must harmonize with — not swappable inspiration, but the backdrop every real photo will have. These anchors inform the palette's **mood and undertone**, not a literal hex-sampling of the photos: a photographed material's color and a screen-safe palette color are different problems, and treating them as the same risks baking in whatever the source photos happen to look like. The author can also name 2-3 reference sites/brands and mood adjectives here, but these are secondary flavor, subordinate to what the physical space allows. If no photos are available, the skill falls back to asking the author to describe the space in words (materials, colors, lighting).
2. **Palette** *(visual companion)* — 2-3 candidate palettes as swatches (hex + usage role: primary/accent/background/text), built to complement the Topic 1 anchor mood rather than clash with it. Every candidate palette must meet a WCAG AA contrast baseline (4.5:1 for text, 3:1 for UI elements) between its text and background roles before it's presented as an option — a palette that fails this isn't offered, regardless of how well it matches the kitchen mood. Each palette also includes semantic state colors (error, sold-out, sale/discount) distinct from the brand colors, so status is never conveyed by color alone. Author picks or requests a tweak.
3. **Tone & imagery direction** *(text)* — voice is discovered fresh: adjectives, 1-2 writers/publications whose voice the author admires, optionally a sample sentence. Never inferred from existing site content, since current posts are placeholder seed data, not established authored voice. Photography style (lighting, styling, candid vs. staged) is grounded in what's actually achievable in the Topic 1 space. Also captures imagery post-processing/treatment (crop ratios, color grading/filters) as a decision distinct from photography style itself, since that's what actually reconciles real photos with the chosen palette on the page. Runs before Typography (Topic 4) so type choice is informed by voice rather than the reverse.
4. **Typography** *(visual companion)* — 2-3 heading/body font pairings shown with real sample text (site name, a sample headline, sample body copy), chosen to match the tone/voice established in Topic 3.
5. **Wordmark, logo & iconography** *(visual companion)* — rough directional concepts (an icon/symbol idea, a wordmark treatment, and any small supporting icon style e.g. for nav/UI) using the palette and typography already chosen. Explicitly framed to the author as directional only, not production-ready logo/icon art. Depends on Topics 2 and 4 (see §5 rerun cascade).
6. **Grid, spacing & mobile layout intent** *(visual companion)* — establishes a shared spacing scale and column grid once, plus explicit mobile-vs-desktop layout intent, so the six page-layout topics below inherit a system rather than each making ad hoc structural decisions.
7. **Home / listing page layout** *(visual companion)* — 2-3 layout wireframes for the existing home page, built on the Topic 6 grid. Depends on Topics 2, 4, and 6.
8. **Recipe post layout** *(visual companion)* — placement of ingredients, steps, kitchenware cards, and affiliate links, building on the existing `RecipeLayout.astro` structure and the Topic 6 grid. Depends on Topics 2, 4, and 6.
9. **Article post layout** *(visual companion)* — building on the existing `ArticleLayout.astro` structure and the Topic 6 grid. Depends on Topics 2, 4, and 6.
10. **Product / shop listing page layout** *(visual companion)* — this page doesn't exist yet; designed against the existing `products`/`sets` content collections and the Topic 6 grid. Depends on Topics 2, 4, and 6.
11. **About & community page layout** *(visual companion)* — lighter-weight, since neither page nor its content model exists yet; captures structural intent, not final content. Depends on Topics 2, 4, and 6.

Each topic's decision is written to `docs/BRAND.md` before the skill moves to the next topic.

## 4. Output Doc Structure (`docs/BRAND.md`)

```markdown
# Brand & Visual Design

## Kitchen Grounding
- Environment anchor colors/materials (from submitted photos): e.g. black granite,
  red brick, warm driftwood-gray wood, stainless steel, matte black hardware
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence)

## Palette
- Named swatches with hex values and usage role (primary, accent, background, text)
- Note on how each was chosen to harmonize with the kitchen anchors above
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for each text/background pairing
- Semantic state colors: error, sold-out, sale/discount

## Tone & Imagery Direction
- Voice adjectives, admired writers/publications, sample sentence — discovered
  fresh from the author, not inferred from existing (placeholder) site content
- Photography style notes (lighting, styling, candid vs. staged) grounded in
  what's achievable in the actual kitchen space
- Imagery post-processing/treatment (crop ratios, color grading/filters)

## Typography
- Heading font (family + fallback stack + weight/case notes)
- Body font (family + fallback stack)
- Any scale notes (e.g. size relationships) if the interview surfaced them
- *Depends on: Tone & Imagery Direction*

## Wordmark, Logo & Iconography
- Directional concept description (shape/symbol idea, wordmark treatment,
  supporting icon style)
- Explicit note: directional only, not production-ready art
- *Depends on: Palette, Typography*

## Grid, Spacing & Mobile Layout
- Spacing scale / column grid used by all page layouts below
- Mobile-vs-desktop layout intent

## Page Layouts
### Home / Listing
### Recipe Post
### Article Post
### Product / Shop Listing
### About
### Community
(each: component list + arrangement description + any page-specific notes;
*depends on: Palette, Typography, Grid/Spacing & Mobile Layout*)
```

Each `##` section is independently revisable via the rerun/revise-by-section flow in §2. Sections marked "Depends on" are the ones flagged stale (or offered for re-review) when Palette or Typography is revised — see §2 and §5. The Product/Shop, About, and Community sections are explicitly marked as forward-looking in the doc, since those pages (and, for Product/Shop's presentation, any content beyond the existing `products`/`sets` schemas) don't exist yet.

## 5. Rerun & Error Handling

- **Fresh run** (`docs/BRAND.md` doesn't exist): runs all eleven topics in order, writing each `##` section as it's completed.
- **Rerun** (`docs/BRAND.md` exists): asks start-fresh vs. revise-specific-sections (multiSelect of the eleven section names). Only chosen topics rerun; every other section is left exactly as it was.
- **Dependency cascade on rerun**: Palette and Typography are depended on by Wordmark/Logo/Iconography and all six page-layout sections (see §4's "Depends on" notes). If the author selects Palette and/or Typography to revise, the skill also asks whether the dependent sections should be re-reviewed. If declined, the doc keeps the dependent sections' existing content but adds a note that they were last decided against a prior Palette/Typography — visible next time the doc is read, rather than silently stale.
- **Abandoned mid-interview**: because sections are written as each topic completes, an interrupted session leaves a partial-but-internally-consistent doc — finished sections stay, unfinished ones are simply absent. Nothing decided is silently lost, and nothing half-decided is written.
- **Kitchen photos unavailable at Topic 1**: falls back to a text description of the space rather than blocking the interview on photo availability.
- **No palette candidate meets the contrast baseline**: if every candidate palette generated for Topic 2 fails the WCAG AA check against the Topic 1 mood, the skill adjusts the candidates (e.g. lightening/darkening a role) rather than presenting a failing palette as an option — the author is never offered an inaccessible choice.
- **Visual companion declined**: visual topics (palette, logo/iconography, grid/spacing, all six page layouts) fall back to text-described options instead of generated mockups.
- The skill never invokes an implementation skill itself. A current `docs/BRAND.md` is the entire scope; building the actual CSS/Astro components from it is a separate, later plan the author starts explicitly.

## Out of Scope

- Any implementation work (CSS, Astro components, actual logo production art) — this skill only produces the spec.
- Financial/legal/business-model questions — those belong to `/setup`, not this skill.
- Designing content that doesn't exist yet (actual About/Community page copy, product catalog beyond current seed data) — only structural/layout intent is captured for pages without a content model.
