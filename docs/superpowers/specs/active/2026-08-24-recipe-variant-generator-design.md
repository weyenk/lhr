# Recipe Variant Generator — Design

**Date:** 2026-08-24
**Status:** Draft — first of five sub-projects in a larger automation initiative (affiliate
sourcing, trends watcher, competitor analysis, product-in-photo placement, and a local
orchestrator are separate, later specs)

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

## Implementation Note (added 2026-08-30, after a production incident)

This pipeline now runs inside `apps/lhr-office`'s orchestrator (per the shared-orchestrator spec),
whose Vercel function is capped at 300s. On 2026-08-30, `POST /status/run/recipe-variant-generator`
ran past that cap and was killed by Vercel mid-request (`FUNCTION_INVOCATION_TIMEOUT`) — seven
diets' worth of sequential, free-tier OpenRouter calls (§3), each of which could hang rather than
throw, added up past the limit. Root cause and prior art (`ecff-website`'s `press-box` desk hit the
identical failure mode) are in `docs/superpowers/plans/` history; the fix, layered onto §3/§8's
existing per-variant retry-then-flag behavior:

- `callOpenRouter` (`mcp-server/src/openrouter.ts`) now passes `AbortSignal.timeout(25_000)` to
  every request, so a hung model fails fast instead of hanging indefinitely.
- `generateAllVariants` (`mcp-server/src/dietSubstitutions.ts`) takes an overall deadline
  (default: 180s from call time, leaving headroom under the 300s cap for the recipe pick,
  narrative, and draft-creation steps around it). Once the deadline passes, every further
  LLM-dependent substitution/step-rewrite call fails immediately (no network call), which the
  existing two-attempt retry-then-flag logic already turns into a "couldn't generate — needs
  manual pass" variant — the same UX as any other LLM failure, just triggered by running out of
  time instead of erroring twice. Diets whose ingredients are fully covered by the static
  substitution table are unaffected, since those never call the LLM at all.

This keeps the whole job inside one Vercel invocation — no cross-invocation checkpointing was
needed, since the deadline guarantees the job always finishes (successfully or partially flagged)
well inside the timeout.

## Implementation Note (added 2026-08-30, pick/finish split)

The deadline fix above bounds a single invocation's runtime, but it left a gap: a diet flagged
"couldn't generate — needs manual pass" was never retried — `confirmAndPublish` blocks publishing
until it's resolved (§8), but nothing in the pipeline ever revisited it, and no MCP tool existed to
fix one from chat. Once the finisher had a reason to run repeatedly, it also became the natural
place to satisfy a separate ask: seeing which recipe was picked before any AI cycles are spent
generating its variants, in service of `apps/lhr-office` becoming a real ops dashboard over time
rather than a static job-history page.

The pipeline is now split into two registered jobs (`packages/jobs/src/registry.ts`) instead of
one:

- **`recipe-variant-generator`** (`generateWeeklyVariantRecipe`, unchanged 7-day cadence) now only
  picks a recipe (§5), generates the narrative (§4), and lands a draft with just the `original`
  variant — none of §3's diet substitution happens here anymore. Its `/status` run summary
  ("Picked ... diet variants pending") is visible immediately, before the expensive part runs.
- **`recipe-variant-finisher`** (`finishPendingRecipeVariants`, new file
  `mcp-server/src/finishRecipeVariants.ts`, 1-day cadence) finds the first open recipe draft with
  any diet still missing or flagged, and retries just those diets (bounded by the same 180s
  deadline as before, via the unchanged `generateVariant`). A diet that's still flagged after a
  tick gets picked up again on the next one, instead of being abandoned once the picker's weekly
  cadence clears. The picker and finisher never collide: the picker's dedup check already treats
  every open draft — finished or not — as "used" for `sourceMealDbId` purposes.

No orchestrator, DB schema, or job-contract changes were needed — this is exactly the "adding a job
is registering one more entry" property the shared-orchestrator spec's §1 goals describe.

## Implementation Note (added 2026-08-30, UI-based pick/approve/reroll)

The picker described above still only *chose* a recipe automatically — there was no way for the
author to see or influence which one, short of reading raw job-summary text. This amendment makes
picking UI-based on `/status`, consistent with `apps/lhr-office` moving toward a real ops dashboard
rather than a static job-history page:

- **`recipe-variant-generator`**'s job body changed again: instead of creating a draft directly, it
  now only ensures a **candidate** is pending (`getPendingCandidate`/`pickNewCandidate` in the new
  `mcp-server/src/recipeCandidates.ts`). A candidate is a lightweight `candidate/<id>` GitHub
  branch (`.candidates/<id>.json`, `{ status: 'pending' | 'rerolled', source }`) — not yet a real
  draft, and no narrative/diet-variant AI calls have been spent on it.
- `/status` on `apps/lhr-office` renders the pending candidate (title/cuisine/category) with
  **Approve** and **Reroll** buttons (`POST /status/candidate/:id/approve` / `/reroll`, same Basic
  Auth gate as the existing "Run now" button).
- **Approve** (`approveCandidate`) is the only point an AI cycle is spent on the pick: it generates
  the narrative and creates the real draft (exactly what the picker used to do directly), then
  deletes the candidate branch.
- **Reroll** (`rerollCandidate`) flips the candidate's status to `rerolled` (kept, not deleted, so
  its `idMeal` is permanently excluded from future suggestions) and immediately picks a fresh one,
  so the UI has something new to show without waiting for the picker's next weekly tick.
- `apps/lhr-office` now depends directly on `lhr-authoring-mcp-server` (`package.json`) to read/act
  on candidates via the same GitHub-branch mechanism drafts already use — no new database table.
  Learned from the two prior subdirectory-install incidents (`docs/AUTHORING-SETUP.md`): the
  dependency must be declared in `apps/lhr-office`'s own `package.json`, not just transitively
  available, since Vercel installs each subdirectory project's own dependency closure.

## Implementation Note (added 2026-09-03, one-diet-per-tick finisher budget)

In production the finisher was observed stuck reporting "Filled in 0/7 pending diet(s)" for the
same draft across every daily tick. Root cause: `finishPendingRecipeVariants` looped over every
currently-pending diet in one invocation, sharing the single 180s `DIET_PIPELINE_BUDGET_MS`
deadline across the whole batch. `callOpenRouter`'s free-tier rate-limit backoff
(`MAX_RATE_LIMIT_ATTEMPTS` retries in `mcp-server/src/openrouter.ts`) means a single ingredient's
substitution call can, in the worst case, itself take most or all of that budget when the shared
free-model pool is saturated — and for a recipe with more than a handful of ingredients, that first
diet's own per-ingredient, per-diet sequential calls were often enough on their own to exhaust the
deadline. Once the deadline passed, every remaining diet's `generateVariant` call short-circuited
instantly (`callOpenRouter` skips the network call once past the deadline), so it got flagged
"couldn't generate — needs manual pass" without a real attempt — indistinguishable, from
`pendingDiets`'s point of view, from a diet that had genuinely been tried and failed, so the same
set of diets was retried from scratch (and lost to the same shared-budget problem) on every
subsequent tick.

Fix: `finishPendingRecipeVariants` now attempts exactly **one** pending diet per invocation, giving
it the full `DIET_PIPELINE_BUDGET_MS` deadline to itself instead of splitting it across a batch. A
resolved diet is written back immediately and never revisited; an unresolved one is retried (still
with a full budget) on the next daily tick. A recipe with all 7 substitutable diets pending now
takes up to 7 daily ticks to fully resolve instead of one, but each tick makes guaranteed forward
progress rather than a slow/rate-limited diet starving every other diet in the same run. `/status`
summaries changed accordingly, from "Filled in X/Y pending diet(s)" to naming the one diet attempted
this tick and how many remain.

## Out of Scope

- Nutritional computation (§1) — heuristic substitution only.
- Porting the linked GitHub substitution project (§1) — concept only, not the code.
- On-demand single-recipe generation via a new MCP tool (§1) — scheduled-only for this phase.
- The shared local orchestrator/scheduler runner and the other four agents (§1) — separate specs.
- Re-hosting TheMealDB cover images to the site's own blob storage (§5) — direct URL for now.
