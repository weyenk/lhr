# Recipe Variant Generator — Design

**Date:** 2026-08-24
**Status:** Draft — first of five sub-projects in a larger automation initiative (affiliate
sourcing, trends watcher, competitor analysis, product-in-photo placement, and a local
orchestrator are separate, later specs)

**Amendment (2026-08-25, from the local-orchestrator spec):** §6's "minimal local scheduler...a
small Node script run via cron/launchd" is superseded. Scheduling moved to Vercel Cron Jobs (the
author wants triggering that doesn't depend on her personal Mac being on, and this repo is fully
Vercel-hosted already) — see `2026-08-25-local-orchestrator-design.md`. Concretely: the pipeline
in §6 must be an exported async function (e.g. `generateWeeklyVariantRecipe()`), not a standalone
CLI script — the orchestrator's Vercel Cron-triggered endpoint in `apps/lhr-office` imports and
calls it directly, in-process, rather than spawning it as a child process. Everything else in this
spec (content model, substitution engine, narrative generation) is unaffected. Watch the Vercel
serverless function timeout (300s default) — this pipeline makes several sequential LLM calls (8
variants × ingredient substitution + step rewriting, plus the narrative), so parallelizing
independent calls where safe may be necessary to stay under it.

**Status as merged to `main` (2026-08-30):** the implementation that landed still uses the
original §6 approach — a standalone script (`mcp-server/scripts/generate-weekly-variant-recipe.ts`,
`npm run generate:weekly-recipe`) invoked by the user's own cron/launchd, not the orchestrator
model this amendment describes. `runWeeklyVariantRecipeGeneration()` in
`mcp-server/src/generateWeeklyVariantRecipe.ts` is already an exported async function the script
thinly wraps, so adapting it to be called in-process from a Vercel Cron endpoint later is a small
follow-up, not a rewrite — but that follow-up hasn't been done. Whoever picks up the
local/shared-orchestrator work should either do that adaptation or explicitly re-confirm the
cron/launchd approach is fine to keep.


## 1. Overview & Goals

Today every recipe post is written by hand through the `site-help` MCP flow: one recipe, one
set of ingredients/steps, one narrative. This spec adds a second, automated path that runs on a
weekly local schedule: pull a recipe from [TheMealDB](https://www.themealdb.com/api.php), run it
through an ingredient-substitution engine to produce **8 dietary variants**, draft an LLM-written
narrative intro, and land the whole bundle as a single draft post — using the exact same draft
storage, preview, and publish gate the manual flow already uses. No new publish path, no
auto-publish: Constitution rule 1 (a post never goes live without the author's explicit
confirmation) applies unchanged.

The 8 variants: **original** (unmodified — the "full flavored" baseline), **gluten-free**,
**vegan**, **vegetarian**, **pescatarian**, **low-carb**, **low-salt**, **low-fat**.

**Primary success criteria:**
- Once a week, a draft appears (visible via the existing `start_post`/`list_drafts` flow) with a
  complete recipe bundle: shared title/photo/narrative, 8 ingredient+step variants selectable in
  a tabbed view once published.
- The author reviews and edits the narrative and any variant in the normal chat-based authoring
  flow, exactly as she does today, before publishing.
- Every published bundle traces back to a `sourceMealDbId` so the same source recipe is never
  auto-imported twice.

**Explicitly out of scope for this phase:**
- Precise nutritional computation (macros, calories, sodium mg). "Low-carb"/"low-salt"/"low-fat"
  are heuristic ingredient/portion substitutions, not a nutrition-API-backed calculation.
- The `Dynamic-Ingredient-Substitution-Food-Pairing-Recommendation-System` GitHub project. It's an
  unmaintained academic proof-of-concept (0 stars, 4 commits, no license, Indian-cuisine-specific
  dataset) that itself just wraps OpenAI calls — not worth a hard dependency on unlicensed code
  that offers nothing beyond an LLM wrapper. This design takes only the concept.
- An on-demand "generate this specific recipe now" MCP tool. Only the scheduled weekly pipeline
  is in scope; on-demand can be added later if wanted.
- Agents 2–5 (affiliate sourcing, trends, competitor analysis, product-in-photo) and the general
  local orchestrator/scheduler runner. This spec's scheduled script is deliberately written so a
  later orchestrator can absorb it as one registered job, but building that shared runner is a
  separate spec.
- TheMealDB's paid tier. The free shared test key (`1`) covers search/lookup/random endpoints,
  which is all this needs.

## 2. Content Model Changes

Two additions to `packages/schemas/src/index.ts`, on `recipePostSchema`:

```ts
export const recipeVariantSchema = z.object({
  diet: z.enum([
    'original', 'gluten-free', 'vegan', 'vegetarian',
    'pescatarian', 'low-carb', 'low-salt', 'low-fat',
  ]),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).min(1),
  steps: z.array(z.string()).min(1),
  notes: z.string().optional(), // e.g. "swapped butter for coconut oil throughout"
});

// on recipePostSchema:
variants: z.array(recipeVariantSchema).optional(),
sourceMealDbId: z.string().optional(),
```

The post's existing `ingredients`/`steps` fields are unchanged and continue to represent the
"original" recipe — every existing post and every manually-authored post keeps working exactly as
today. `variants` is additive: when present, the recipe display renders a tab/selector across all
8; when absent (the common case for hand-written posts), nothing changes.

The same two fields are mirrored onto `draftPostSchema` in `mcp-server/src/drafts.ts` so the
generator can stage them into a draft the same way manual authoring stages everything else.

**Narrative body plumbing (small prerequisite fix).** Today `buildPostFrontmatter`/`renderPostMdx`
(`mcp-server/src/render.ts`) only ever write the YAML frontmatter block — there is currently no
path in the MCP authoring tools for writing MDX body prose at all (existing posts with narrative
bodies predate the MCP tool, from the Squarespace migration). This design adds one optional
`narrativeBody: z.string().optional()` field to `draftPostSchema`, and `renderPostMdx` appends it
below the frontmatter fence when present. This is scoped narrowly — just enough plumbing for this
bundle to carry a narrative — not a redesign of the authoring flow's content-writing capabilities.

## 3. Substitution Engine

New module `mcp-server/src/dietSubstitutions.ts`, alongside the existing
`normalizeIngredient.ts`:

- **Substitution table**: a curated map from normalized ingredient patterns to per-diet
  replacements — e.g. `all-purpose flour` → gluten-free: `1:1 gluten-free flour blend`; `butter` →
  vegan: `vegan butter or coconut oil`; `heavy cream` → low-fat: `evaporated skim milk`; `soy
  sauce` → low-salt: `low-sodium soy sauce or coconut aminos`. Matches run against the same
  `normalizeIngredient()` used for affiliate-link matching today, so both features share one
  notion of "what ingredient is this."
- **LLM fallback**: for any ingredient the table doesn't cover, one call to a free OpenRouter
  model (default `meta-llama/llama-3.3-70b-instruct:free`, model id configurable via env var) with
  the ingredient name + target diet, asking for a substitute or "no substitution needed" (e.g.
  salt itself needs no substitute for vegan). Requires a new `OPENROUTER_API_KEY` env var, added
  to `.env.example` alongside `GITHUB_TOKEN` (§6).
- **Step rewriting**: after ingredients are substituted for a variant, one LLM pass rewrites the
  numbered steps so any inline reference to a swapped ingredient (e.g. "melt the butter") reflects
  the substitution ("melt the vegan butter"). The table alone can't safely touch free-form prose.
- **Sanity guard**: a variant is rejected (not silently emitted) if the LLM returns 0 ingredients
  or 0 steps, or the output isn't parseable. A rejected variant is flagged in the draft as
  "couldn't generate — needs manual pass" rather than either blocking the whole bundle or
  publishing something broken, consistent with Constitution rule 4 (drafts never silently
  discarded).

## 4. Narrative Generation

One LLM call (same OpenRouter free model) given the source recipe's title/description/cuisine
(from TheMealDB's `strMeal`/`strArea`/`strCategory`) drafts a short story-style intro matching the
site's existing voice (a few paragraphs, in the style of existing posts — see
`chili-con-carne-over-tatties-roadside-rescue-culinary-reward.mdx` as a reference example). This
becomes the draft's `narrativeBody`. It is always presented as a starting point: the author edits
it like any other draft content before `confirm_and_publish`, never published as-is by the
pipeline.

## 5. Recipe Source & Dedup

- Fetch from TheMealDB's `random.php` (or `filter.php?c=<category>` rotating across a fixed list
  of categories to get variety) using the shared free key.
- Before generating anything, check the recipe's `idMeal` against every existing post's
  `sourceMealDbId` (via the same `readCollection` helper `confirmAndPublish` already uses) — if
  already imported, pick another recipe (retry up to a few times, then skip this week's run and
  log it rather than forcing a duplicate).
- The cover photo uses TheMealDB's `strMealThumb` URL directly (satisfies the existing
  `coverPhoto: z.string().url()` field — no re-hosting needed for this phase). The author can
  swap it for a different photo before publishing like any other draft, which also covers any
  uncertainty about that image's reuse license for a monetized post.

## 6. Scheduled Pipeline (standalone script, not yet an orchestrator)

A single script, `mcp-server/scripts/generate-weekly-variant-recipe.ts`, run via the user's own
`cron`/`launchd` entry (documented in this spec's implementation, not built as a new hosted
service):

1. Fetch + dedup-check a recipe (§5).
2. Normalize its ingredients; generate all 8 variants (§3).
3. Draft the narrative intro (§4).
4. Create a draft post via the existing `drafts.ts` `createDraft` (branch `draft/post-<id>`,
   `.drafts/<id>.json`) with `postType: 'recipe'`, `ingredients`/`steps` set to the original
   variant, `variants` set to all 8, `narrativeBody` set, `photos` set to the source thumbnail,
   and `sourceMealDbId` set.
5. Logs a summary (title, diets that needed a manual-pass flag, draft id) to stdout for whatever
   captures cron output locally.

Because this reuses `drafts.ts` directly rather than inventing a parallel draft representation,
the generated draft shows up in `list_drafts`/`start_post` and goes through `previewPost` and
`confirm_and_publish` exactly like a hand-authored one — no second review UI to build.

**Auth for the unattended script.** The interactive MCP server authenticates via the existing
GitHub OAuth flow (`mcp-server/src/auth/`), which assumes an active chat session — not usable from
an unattended cron job. The script instead uses a GitHub **personal access token** (repo-scoped,
same repo) stored in a local env var (`GITHUB_TOKEN`, added to `.env.example`), passed to the same
`createGitHubClient` used elsewhere. This is a second, narrower authentication path alongside the
OAuth one, not a replacement for it.

## 7. New Astro Component: `RecipeVariantTabs`

`src/components/RecipeVariantTabs.astro`, used by `RecipeLayout.astro` when `data.variants` is
present: renders a tab/segmented-control row (the 8 diet labels) that swaps the visible
ingredients list + steps below it. Client-side JS is a small vanilla show/hide toggle (matching
the site's existing lightweight-JS approach — no new framework dependency). When `variants` is
absent, `RecipeLayout` renders exactly as it does today.

## 8. Error Handling & Edge Cases

- TheMealDB fetch failure or all dedup retries exhausted: script logs and exits without creating a
  draft — no partial/corrupt draft left behind.
- LLM call failure (timeout/error) for a variant: one retry, then that variant is marked
  "couldn't generate" in the draft rather than dropped silently (§3) or the whole run aborted.
- LLM call failure for the narrative: falls back to a minimal placeholder narrative
  (`"[Narrative draft pending — auto-generation failed]"`) so the draft still exists for the
  author to write by hand, rather than blocking bundle creation entirely.
- Draft creation failure (GitHub API error): script logs and exits; nothing partially written,
  since `createDraft` either fully succeeds (branch + file) or throws before anything is
  considered created.

## 9. Testing Approach

Following the existing `mcp-server/tests/**` pattern:

- `dietSubstitutions.test.ts` — table matches for common ingredients per diet, LLM-fallback path
  (mocked), sanity-guard rejection on malformed LLM output.
- Schema tests for `recipeVariantSchema`/`variants`/`sourceMealDbId` alongside existing
  `packages/schemas` tests (valid variant, missing required field, invalid `diet` enum value).
- `renderPostMdx` test extended to cover `narrativeBody` presence/absence in output.
- An integration test for `generate-weekly-variant-recipe.ts` that mocks TheMealDB, the OpenRouter
  calls, and the GitHub client, asserting: a draft is created with 8 variants, dedup skips a
  recipe whose `sourceMealDbId` already exists, and a failed variant is flagged rather than
  dropped or crashing the run.
- Component test/snapshot for `RecipeVariantTabs` (tab switching shows the right ingredients/steps
  for each diet) alongside existing `tests/components`.

## Out of Scope

- Nutritional computation (§1) — heuristic substitution only.
- Porting the linked GitHub substitution project (§1) — concept only, not the code.
- On-demand single-recipe generation via a new MCP tool (§1) — scheduled-only for this phase.
- The shared local orchestrator/scheduler runner and the other four agents (§1) — separate specs.
- Re-hosting TheMealDB cover images to the site's own blob storage (§5) — direct URL for now.
