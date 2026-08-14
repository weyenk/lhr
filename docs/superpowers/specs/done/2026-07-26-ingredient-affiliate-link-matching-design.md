# Ingredient → Affiliate Link Matching — Design

**Date:** 2026-07-26
**Status:** Done — merged PR #23 (a1219cd, 2026-07-26); `ingredient-links` content collection and `normalizeIngredient` exist on `main`

## 1. Overview & Goals

Recipe posts already store ingredients as structured data (`item` + optional `amount`
per `recipePostSchema`), and the site already has a minimal affiliate-link system
(`affiliateLinkSchema`: `label`, `url`, `tag`), but every link is added by hand, one
at a time, per post, via the `add_affiliate_link` MCP tool. This spec adds automatic
matching: while an author is drafting a recipe through the existing `site-help`
skill/MCP flow, the assistant cross-references the recipe's ingredients against a
library of previously-approved ingredient→link mappings and prompts the author to
accept, reject, or fill in gaps — conversationally, in the same chat that's already
driving the draft.

**Explicitly out of scope for this phase:**
- Any live external affiliate-program API (Amazon Associates, ShareASale, etc.).
  Per `docs/BACKLOG.md`, no affiliate program is enrolled yet. This design builds
  entirely against a self-curated library so it's useful immediately, and is
  structured so a real program's search API could be added later as an additional
  match source without changing the authoring flow.
- Article-type posts. Only recipes have the structured `ingredients` field this
  feature depends on; articles use free-text `sections`.
- Any CI/GitHub Actions automation. The publish flow commits straight to `main` from
  a draft branch (`confirm_and_publish` → `commitFilesToMain`) with no PR step to
  hook into, so matching happens inside the authoring conversation instead.
- Fuzzy/semantic (LLM-assisted) matching. Ingredient normalization is a deterministic
  text transform (§3), not a model call — see §6 for why.

**Primary success criteria:**
- While drafting a recipe, the author is shown which ingredients already have a
  known affiliate link and can accept them with a word, and which ingredients have
  no link yet, so she can supply one or skip it.
- Accepting a suggestion, or supplying a new link for an unmatched ingredient, grows
  the library automatically — the next recipe with the same ingredient matches
  without her doing anything extra.
- Existing manually-linked posts are not orphaned: a one-time backfill seeds the
  library from links already in use today, so the feature has a useful starting
  point rather than launching empty.

## 2. New Content Collection: `ingredient-links`

A new collection, `src/content/ingredient-links/*.json`, following the same
one-file-per-entry pattern as `products` and `affiliate-links`. Each file maps one
normalized ingredient name to one existing affiliate link:

```json
{
  "ingredient": "jerk seasoning",
  "affiliateLinkId": "jerk-seasoning"
}
```

New schema in `packages/schemas/src/index.ts`:

```ts
export const ingredientLinkSchema = z.object({
  ingredient: z.string(),        // normalized form — see §3
  affiliateLinkId: z.string(),   // must reference an existing affiliate-links entry
});

export type IngredientLinkData = z.infer<typeof ingredientLinkSchema>;
```

`ingredient` values must be unique across the collection — one canonical link per
ingredient name. This is enforced the same way other collections are validated today
(a content-consistency test, not a runtime check), and is what makes conflict
detection in §5 possible.

## 3. Ingredient Normalization

A single pure function, shared by every consumer (`suggest_affiliate_links`, the
backfill script, and `add_affiliate_link`'s new `ingredient` param):

```ts
function normalizeIngredient(item: string): string
```

Rules:
1. Lowercase.
2. Strip a leading quantity/unit token if present (e.g. "2 cloves garlic" → "garlic").
3. Strip a trailing prep clause introduced by a comma (e.g. "garlic, minced" →
   "garlic").
4. Singularize simple trailing plurals ("cloves" → "clove", "onions" → "onion").

Deliberately **not** stripped: descriptive adjectives before the noun ("green onion",
"kosher salt", "smoked paprika"). These are treated as distinct ingredients from
their bare form ("onion", "salt", "paprika") rather than collapsed — collapsing them
risks matching a recipe's "kosher salt" to a completely unrelated "table salt"
affiliate link. A miss here just means the ingredient falls into the "unmatched"
list for the author to handle (see §4), which is a low-cost failure mode since a
human reviews every suggestion anyway.

## 4. New MCP Tool: `suggest_affiliate_links`

Inserted into the existing `site-help` skill flow, right after ingredients are
entered via `add_content_step` and before the existing `add_affiliate_link` step.

```
suggest_affiliate_links({ draftId }) →
  { matched: [{ ingredient, affiliateLinkId, label, url }],
    unmatched: [{ ingredient }] }
```

Behavior:
- Reads the draft. If `draft.postType !== 'recipe'`, returns an empty result — no-op
  for articles.
- Normalizes each `draft.ingredients[].item` (§3) and looks it up in the
  `ingredient-links` collection.
- Returns matched ingredients (with the existing link's label/URL so the assistant
  can show the author what she'd be accepting) and unmatched ones.

The skill then does the prompting **conversationally** — no new UI, just chat, the
same way the flow already asks about kitchenware and affiliate links today. For
example: *"I found existing links for garlic and jerk seasoning — want me to add
those? No link yet for scallions or ginger — have a URL for either, or should I skip
them?"*

Whatever the author accepts is applied through the existing `add_affiliate_link`
tool (extended below), not a new write path — `suggest_affiliate_links` only reads
and proposes, it never writes.

## 5. Extending `add_affiliate_link`

Today `add_affiliate_link` takes `draftId`, `label`, `url`, `tag` and either reuses
an existing catalog entry (matched by URL) or stages a new one. This design adds one
optional parameter:

```ts
inputSchema: {
  draftId: z.string(),
  label: z.string(),
  url: z.string().url(),
  tag: z.string(),
  ingredient: z.string().optional(),   // new
},
```

When `ingredient` is present, in addition to today's behavior:
- Normalize it (§3) and check the `ingredient-links` collection.
- If no entry exists for that normalized ingredient, stage a new `ingredient-links`
  entry pointing at the resolved `affiliateLinkId` (existing or newly-pending),
  written alongside the affiliate link file at publish time — same
  staged/committed-on-publish pattern `pendingAffiliateLinks` already uses.
- If an entry **already exists** for that ingredient pointing at a *different*
  link, don't overwrite it — return a conflict message (e.g. `"ingredient
  already maps to a different link"`) so the author resolves it explicitly rather
  than the library silently drifting.

This is the only write path into `ingredient-links` during normal authoring — it
piggybacks on a tool call the author is already making, so accepting a suggestion or
filling in a gap grows the library for free.

## 6. Backfill Script (one-time)

A standalone script (e.g. `mcp-server/scripts/backfill-ingredient-links.ts`, next to
the existing `mcp-server/scripts/`) run once at launch to seed the library from
today's manually-added links:

- Scans every existing recipe post's `ingredients` and `affiliateLinkIds`.
- Where a post has exactly one affiliate link and that link's normalized `label` (or
  its `tag`) unambiguously corresponds to exactly one of the post's ingredients,
  writes an inferred `ingredient-links` entry.
- Where a post has multiple ingredients and multiple links with no unambiguous
  1:1 pairing, skips it and prints it in a report for manual resolution — never
  guesses.
- Prints a summary: entries created, posts skipped as ambiguous, and any
  normalization collisions found along the way.

This is why normalization matching is deterministic text transformation (§3) rather
than an LLM call: the backfill script and the runtime tool both need to produce the
*same* answer for the *same* input, reproducibly, and adding a model call here would
introduce a new external dependency and non-determinism to a repo that currently has
no CI at all — not justified when a human reviews every suggestion regardless.

## 7. Error Handling & Edge Cases

- Article drafts: `suggest_affiliate_links` no-ops (§4); not an error.
- Empty or sparse library (early on, before the backfill or much usage): returns
  "no matches" gracefully — an empty `matched` array is a normal result, not a
  failure.
- Duplicate `ingredient` keys across `ingredient-links` entries are rejected by
  content validation (§2) — the same tier of check the site's other collections
  already get.
- `add_affiliate_link` ingredient conflicts (§5) surface as a message back to the
  author rather than corrupting an existing mapping.
- Backfill ambiguity (§6) is reported, never guessed.

## 8. Testing Approach

Following the existing `mcp-server/tests/tools/*.test.ts` pattern:

- `suggestAffiliateLinks.test.ts` — matched ingredients, unmatched ingredients,
  empty library, article-draft no-op.
- Extend `addAffiliateLink.test.ts` — the new `ingredient` param: creates a new
  library entry, reuses an existing link without duplicating the entry, and the
  conflict case (ingredient already mapped elsewhere).
- A direct unit test for `normalizeIngredient` covering the quantity/unit-stripping,
  prep-clause-stripping, pluralization, and "adjective preserved" cases from §3.
- `backfill-ingredient-links` test — seeds correctly from unambiguous posts, skips
  and reports ambiguous ones, doesn't touch posts with no affiliate links at all.
- Schema test fixtures for `ingredientLinkSchema` (valid entry, missing field,
  duplicate `ingredient` across fixtures) alongside the existing schema tests in
  `packages/schemas`.

## Out of Scope

- Live external affiliate-program APIs (§1) — revisit once a program is enrolled.
- Article posts (§1) — no structured ingredients to match against.
- Any CI/PR-based automation — the authoring flow has no PR step (§1).
- LLM-assisted/fuzzy semantic matching (§6) — deterministic text normalization only.
- Automatically resolving `add_affiliate_link` ingredient conflicts (§5) — always
  surfaced to the author, never auto-resolved.
