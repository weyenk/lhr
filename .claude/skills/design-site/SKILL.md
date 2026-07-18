---
name: design-site
description: One-time, rerunnable interview that walks the site's author through brand fundamentals (kitchen-grounded palette, tone, typography, wordmark/logo/iconography), a shared grid/spacing/mobile baseline, and layout intent for every planned page, producing docs/BRAND.md. Invoke as /design-site.
---

# /design-site — Visual & Brand Design Interview

Walks the author through an eleven-topic interview and writes the results directly to `docs/BRAND.md`. This is the one-time (but rerunnable) interview described in `docs/superpowers/specs/2026-07-13-design-site-skill-design.md`. The skill only ever produces `docs/BRAND.md` — it never writes CSS, Astro components, or invokes any implementation skill.

**Tools this skill uses:** Read, Write, Edit, Glob, AskUserQuestion, WebFetch, and the visual companion (see below).

## Using the visual companion

Several topics below are marked *(visual companion)*. The first time one of those topics comes up, offer the companion as its own message, before asking anything else that topic needs:

> "This next part might be easier if I show you — I can put together mockups, swatches, and comparisons in a browser tab as we go. It's still new and can be token-intensive. Want me to? I'll open it for you."

**If accepted:** start the server (`scripts/start-server.sh --project-dir <repo root> --open`, per the `superpowers:brainstorming` visual-companion guide) and use it for this and every later *(visual companion)* topic — write real options (swatches, font samples, wireframes, directional logo concepts) to a new file in `screen_dir` each time, and read `state_dir/events` on the next turn for the author's selection, combined with their terminal reply.

**If declined**, or if the server becomes unreachable mid-interview: fall back to describing 2-3 options in text for that topic and every later *(visual companion)* topic. Don't re-offer once declined.

## Step 0: Check for an existing design doc

Check whether `docs/BRAND.md` exists (Glob or Read).

- **Doesn't exist** → this is a first run. Proceed to "Step 1: Run the interview" with all eleven topics in order.
- **Exists** → this is a rerun. Ask the author, via `AskUserQuestion`:

  Question: "docs/BRAND.md already exists. How do you want to proceed?"
  Options:
  - "Start over" — re-run all eleven topics from scratch, overwriting the existing doc section-by-section as each topic completes.
  - "Revise specific sections" — show the topic list below and let the author multi-select which topics to redo. Read the existing `docs/BRAND.md` first so untouched sections' existing content is preserved verbatim.

  If "Revise specific sections": ask a second `AskUserQuestion` (multiSelect: true) listing the eleven topic names, in this order: "Kitchen grounding & mood", "Palette", "Tone & imagery direction", "Typography", "Wordmark, logo & iconography", "Grid, spacing & mobile layout", "Home / listing page layout", "Recipe post layout", "Article post layout", "Product / shop listing page layout", "About & community page layout". Only run Step 1 for the topics selected; every other topic's section is left byte-for-byte unchanged in the final doc.

  **Dependency cascade:** if "Palette" and/or "Typography" is among the selected topics, ask one more `AskUserQuestion` (multiSelect: true): "Palette/Typography feeds Wordmark, Logo & Iconography and all six page-layout sections. Re-review any of those too?" Options: "Wordmark, logo & iconography", "Home / listing page layout", "Recipe post layout", "Article post layout", "Product / shop listing page layout", "About & community page layout" (author can select none). Add whichever are selected to this run's set of topics.

  For any dependent section the author does **not** select for re-review, add (or update) a one-line note at the very top of that section's existing content: `> Note: last decided against a Palette/Typography that has since changed (revised <today's date>).` — so staleness is visible in the doc, not silently hidden.

## Writing docs/BRAND.md sections

Each topic below produces one `##` section (the six page-layout topics instead each produce one `###` subsection under a shared `## Page Layouts` heading). As soon as a topic's question(s) are answered and reflected back to the author, write that section immediately — don't wait for the whole interview to finish. This is deliberate: if the author abandons partway through, finished sections stay and unfinished ones are simply absent, rather than losing everything captured so far.

To write a section:
- **If `docs/BRAND.md` doesn't exist yet:** create it starting with a `# Brand & Visual Design` title, then this topic's section.
- **If the file exists but this section doesn't yet:** append the new section after whatever sections already exist. On a fresh run this lands sections in canonical topic order automatically, since topics run in that order.
- **If the file exists and this section already exists (a "revise" rerun):** replace everything from that section's heading up to (but not including) the next heading of the same or higher level, leaving everything before and after byte-for-byte untouched.
- For the six page-layout topics specifically: the shared `## Page Layouts` heading is created once, by whichever of those topics is written first in a given run. Each topic then writes/replaces only its own `###` subsection(s) beneath it, leaving sibling subsections untouched.

## Step 1: Run the interview

Ask the following eleven topics **one question at a time** — never bundle multiple topics into one prompt. After capturing each topic's answer(s) and reflecting them back in 1-2 sentences, write that topic's section immediately (per "Writing docs/BRAND.md sections" above), then move to the next topic.

### Topic 1: Kitchen grounding & mood *(photos + text)*

Ask the author to share photos of the actual space her content is/will be photographed in. If none are available, ask her to describe it in words instead (materials, colors, lighting).

From the photos (or description), name back what you observe as fixed environmental colors/materials — for example: "I'm seeing black granite counters, exposed red brick, warm gray-driftwood cabinet fronts, stainless steel appliances, and matte black fixtures." Confirm this reading with the author before moving on; correct it if she says something's off.

Then ask, as a secondary question: "Any reference sites or brands whose vibe you want, plus a few mood adjectives?" If she names sites, `WebFetch` them and note back what you see (color tendencies, type feel, density, photography style) — this is flavor, not a constraint the way the kitchen anchors are.

**Capture:** environment anchor colors/materials (primary input), reference sites/mood adjectives (secondary). Write the `## Kitchen Grounding` section:

```markdown
## Kitchen Grounding
- Environment anchor colors/materials: <observed anchors, from photos or description>
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): <captured answer, or "None given">
```

### Topic 2: Palette *(visual companion)*

Generate 2-3 candidate palettes (primary, accent, background, text roles, each a hex value) that complement the Topic 1 anchor mood — e.g. anchors like black granite / red brick / warm gray wood call for warm neutrals with a grounded accent, not a palette that fights them.

**Before presenting any candidate**, check its text/background pairing against WCAG AA: text-on-background must be ≥4.5:1, and any UI element (buttons, borders) against its background must be ≥3:1. If a candidate fails, adjust the failing role (lighten/darken it) until it passes, or drop that candidate — never present a failing palette as a choice. If **every** candidate fails after adjustment attempts, generate new candidates rather than offering a known-bad option.

Add semantic state colors to every candidate — error, sold-out, sale/discount — distinct from the brand colors, so status is never conveyed by brand-accent color alone.

Present the passing candidates via the visual companion as swatch cards; the author picks one or asks for a tweak.

**Capture:** the chosen palette's roles + hex values, its contrast-check result, its semantic colors, and the harmonization reasoning. Write the `## Palette` section:

```markdown
## Palette
- Primary/background: <hex>
- Text: <hex>
- Accent: <hex> — <role/usage>
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for <text hex> on <background hex>
- Semantic state colors: error <hex>, sold-out <hex>, sale/discount <hex>
- Note on how this was chosen to harmonize with the kitchen anchors above: <reasoning>
```

### Topic 3: Tone & imagery direction *(text)*

Voice is discovered **fresh** — never inferred from existing site content, since the current posts (e.g. "Jerk Chicken for a Crowd") are placeholder seed data, not an established authored voice. Ask, one at a time:

1. "Give me a few adjectives for how the writing should sound."
2. "Any writers or publications whose voice you admire, even loosely?"
3. Optional: "If you want, give me one sample sentence in the voice you're going for."
4. "What's the photography style — natural light or staged, minimal styling or busy, candid mid-action shots or composed stills? Keep this grounded in what's actually achievable in your kitchen space from Topic 1."
5. "Any imagery treatment beyond the shot itself — a preferred crop ratio, a color-grading/filter approach — that would help reconcile real photos with the palette we just picked?"

**Capture:** voice adjectives, admired writers/publications, optional sample sentence, photography style, imagery post-processing/treatment. Write the `## Tone & Imagery Direction` section:

```markdown
## Tone & Imagery Direction
- Voice adjectives: <captured answer>
- Admired writers/publications: <captured answer, or "None given">
- Sample sentence: <captured answer, or "None given">
- Photography style: <captured answer>, grounded in the actual kitchen space from Kitchen Grounding
- Imagery post-processing/treatment: <captured answer>
```

### Topic 4: Typography *(visual companion)*

Generate 2-3 heading/body font pairings, chosen to match the voice/tone from Topic 3 — not picked before it. Show each pairing with real sample text: the site name, a sample headline, and a line of sample body copy.

**Capture:** the chosen heading font (family + fallback stack + any weight/case notes) and body font (family + fallback stack). Write the `## Typography` section:

```markdown
## Typography
- Heading font: <family>, fallback stack `<fallback stack>` — <weight/case notes, if any>
- Body font: <family>, fallback stack `<fallback stack>`
- Scale notes: <any size-relationship notes surfaced, or "None captured">
- *Depends on: Tone & Imagery Direction*
```

### Topic 5: Wordmark, logo & iconography *(visual companion)*

Using the palette and typography already chosen, generate rough directional concepts: an icon/symbol idea, a wordmark treatment (how the site name is typeset), and a small supporting icon style (e.g. for nav/UI elements). Explicitly tell the author these are directional only, not production-ready logo/icon art.

**Capture:** the chosen directional concept description. Write the `## Wordmark, Logo & Iconography` section:

```markdown
## Wordmark, Logo & Iconography
- Directional concept: <shape/symbol idea>
- Wordmark treatment: <typographic treatment of the site name>
- Supporting icon style: <captured answer>
- Note: directional only, not production-ready art
- *Depends on: Palette, Typography*
```

### Topic 6: Grid, spacing & mobile layout intent *(visual companion)*

Establish a shared spacing scale and column grid once, plus explicit mobile-vs-desktop layout intent, so the six page-layout topics below inherit a system rather than each making ad hoc structural decisions. Show 2-3 options via the visual companion (e.g. differing base spacing units or grid widths) if there's a genuine choice to make; otherwise propose one sensible default and confirm it with the author.

**Capture:** the spacing scale, column grid, and mobile-layout intent. Write the `## Grid, Spacing & Mobile Layout` section:

```markdown
## Grid, Spacing & Mobile Layout
- Spacing scale: <e.g. 8px base unit: 8/16/24/32/48/64>
- Column grid: <e.g. 12-column desktop grid, max-width Npx>
- Mobile-vs-desktop intent: <e.g. single-column stack below Npx, breakpoint>
```

### Topic 7: Home / listing page layout *(visual companion)*

Show 2-3 layout wireframes for the existing home page (currently `src/pages/index.astro`, an unstyled list of post links), built on the Grid, Spacing & Mobile Layout system from Topic 6.

**Capture:** the chosen layout's component list and arrangement. Write the `### Home / Listing` subsection under `## Page Layouts` (creating the parent heading if this is the first page-layout topic run this session):

```markdown
## Page Layouts

### Home / Listing
- Components: <e.g. hero for most recent post, grid of post cards below>
- Arrangement: <description>
- Notes: <any page-specific notes>
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 8: Recipe post layout *(visual companion)*

Show 2-3 wireframes for the placement of ingredients, steps, kitchenware cards, and affiliate links, building on the existing `src/layouts/RecipeLayout.astro` structure (read the file to ground the options in its actual current sections) and the Topic 6 grid.

**Capture:** the chosen layout's component list and arrangement. Write the `### Recipe Post` subsection under `## Page Layouts` (append after `### Home / Listing`, or create the parent heading if this is the first page-layout topic run):

```markdown
### Recipe Post
- Components: <e.g. hero photo, two-column ingredients/steps on desktop, kitchenware cards inline>
- Arrangement: <description>
- Notes: <any page-specific notes>
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 9: Article post layout *(visual companion)*

Show 2-3 wireframes building on the existing `src/layouts/ArticleLayout.astro` structure (read the file) and the Topic 6 grid.

**Capture:** the chosen layout's component list and arrangement. Write the `### Article Post` subsection under `## Page Layouts`:

```markdown
### Article Post
- Components: <e.g. hero photo, single-column prose, kitchenware cards at end>
- Arrangement: <description>
- Notes: <any page-specific notes>
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 10: Product / shop listing page layout *(visual companion)*

This page doesn't exist yet. Show 2-3 wireframes designed against the existing `products`/`sets` content collections (read `src/content.config.ts` and `src/content/schemas.ts` to ground the options in the real fields available) and the Topic 6 grid.

**Capture:** the chosen layout's component list and arrangement. Write the `### Product / Shop Listing` subsection under `## Page Layouts`:

```markdown
### Product / Shop Listing
- Components: <e.g. grid of product cards grouped by current set>
- Arrangement: <description>
- Notes: forward-looking — this page and any content beyond the existing products/sets schemas don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 11: About & community page layout *(visual companion)*

Neither page nor its content model exists yet, so keep this lighter-weight: capture structural intent, not final content. Show 1-2 simple wireframes for each via the visual companion.

**Capture:** structural intent for both pages. Write the `### About` and `### Community` subsections under `## Page Layouts` (both from this one topic):

```markdown
### About
- Components: <e.g. single long-form page, photo + story>
- Arrangement: <description>
- Notes: forward-looking — page and content model don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### Community
- Components: <e.g. placeholder "coming soon" structure, newsletter signup>
- Arrangement: <description>
- Notes: forward-looking — page and content model don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

## Step 2: Close out

Summarize what was written this run: which of the eleven `docs/BRAND.md` sections were newly written, which were revised, and which were left untouched (a rerun with unselected topics). If any dependent sections (Wordmark/Logo/Iconography, page layouts) were left stale because the author declined to re-review them after a Palette/Typography change, say so explicitly, and remind the author they can re-run `/design-site` later to revise any section.

Never claim to have produced CSS, Astro components, or any other implementation artifact — `docs/BRAND.md` is the entire scope of this skill.
