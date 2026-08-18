# Instacart "Buy the Meal" Button — Design

**Date:** 2026-08-18
**Status:** Active — not started. No implementation plan written yet; no Instacart code exists in `src/` or `mcp-server/`.

## 1. Overview & Goals

Today a recipe post can link out to individual affiliate products (Amazon-style outbound links, one per item) via `affiliateLinkIds`, but there's no way for a reader to get every ingredient for a recipe in one shopping trip. This spec adds a "Buy the Meal on Instacart" button to recipe posts, using Instacart's Developer Platform (IDP) "Create a Recipe Page" API to turn a recipe's ingredient list into one Instacart cart the reader can check out from directly.

Instacart was chosen over Amazon's unofficial multi-ASIN cart-URL trick, and over building real cart/checkout in this repo (see the parallel Shopify commerce spec), because it's an officially documented API that genuinely merges every ingredient into one cart, and — like the Shopify spec's core trade — it requires no payment/checkout code in this repo at all, since Instacart's own site handles store selection and checkout.

**Primary success criteria:**
- A published recipe post has a "Buy the Meal on Instacart" button that sends the reader to an Instacart page with every one of the recipe's ingredients already added to a cart.
- Generating that link requires no server infrastructure in the public site (`src/`) — the site stays fully static, unlike the Shopify spec's SSR routes.
- The Instacart partner API key is never exposed to the browser.
- A recipe with no Instacart link (API failure, feature not yet built, or access not yet granted) degrades to today's behavior — no broken button, no blocked publish.

**Prerequisite — the actual go/no-go gate:** Access to Instacart's IDP recipe-page endpoint requires applying as a developer partner (business info, use case, integration review); reported turnaround is roughly 30–40 days, and it's unconfirmed whether Instacart is currently accepting new applications at all. **This must be confirmed directly with Instacart before any implementation work starts.** Everything below assumes partner access has been granted; in the meantime, repo-side work (schema, layout, tests) can be built and verified against a mocked client per §6.

## 2. Where the integration lives: `mcp-server`, not the Astro site

This is the key architectural decision, and a deliberate departure from the Shopify spec's approach.

Instacart's Create Recipe Page API is a **server-to-server call requiring a secret partner API key** — it can't be called from the browser the way Shopify's public Storefront token can, and it doesn't need to be: Instacart resolves store selection, pricing, and availability entirely on their own side when the reader opens the link. So this integration needs exactly one authenticated call per recipe, made once, producing a stable URL that can be stored as ordinary static content.

This site already has the right place for that call: `mcp-server/`, the single-author authoring backend that turns chat-driven drafts into committed content (`mcp-server/src/tools/confirmAndPublish.ts`). Extending its `publishPost()` step to also call Instacart, and commit the resulting URL as part of the post's frontmatter, means:
- The public Astro site (`src/`) never talks to Instacart, never needs `output: 'server'`, and has no dependency on the Shopify spec's SSR work.
- The secret Instacart API key lives only in `mcp-server`'s existing server environment, alongside the GitHub App credentials it already holds — no new secret-handling surface on the public site.
- The "Buy the Meal" button ends up a plain static link, the same kind as today's `AffiliateLink.astro`.

## 3. Content Schema Changes

`recipePostSchema` (`packages/schemas/src/index.ts`) gains one new optional field:

```ts
export const recipePostSchema = z.object({
  type: z.literal('recipe'),
  ...basePostFields,
  yields: z.number().int().positive().optional(),
  yieldsUnit: z.string().optional(),
  prepMinutes: z.number().int().positive().optional(),
  cookMinutes: z.number().int().positive().optional(),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).min(1),
  steps: z.array(z.string()).min(1),
  instacartUrl: z.string().url().optional(),
});
```

- Optional, not required: a recipe with no Instacart link renders exactly as it does today.
- No changes to `articlePostSchema`, `productSchema`, `affiliateLinkSchema`, or `ingredientLinkSchema`. This is additive and orthogonal to the existing `ingredient-links` collection, which maps specific ingredient *names* to specific Amazon-style affiliate *products* (a curated, per-ingredient concept). Instacart instead takes the recipe's whole `ingredients` array as-is — no per-ingredient curation needed.

## 4. Publish-time flow

New module `mcp-server/src/instacart.ts` — a thin client, mirroring the `src/lib/shopify.ts` seam proposed in the Shopify spec so it can be mocked in tests:

```ts
export async function createInstacartRecipePage(input: {
  title: string;
  imageUrl: string;
  ingredients: { item: string; amount?: string }[];
}): Promise<{ url: string }>
```

`publishPost()` in `confirmAndPublish.ts` gains one step, after today's schema validation and before committing files: if `draft.postType === 'recipe'`, call `createInstacartRecipePage()` with the draft's title, cover photo, and ingredients, and fold the returned URL into the frontmatter as `instacartUrl` before `src/content/posts/${slug}.mdx` is written.

**Failure handling (Constitution principle 4 — never silently discard a draft on error):** if the Instacart call fails or times out, publishing continues without `instacartUrl` — the post still publishes as a normal recipe, just without the button — and `confirmAndPublish`'s response text tells the author the call failed, so they can decide whether to retry later. It never blocks or discards the draft.

**No regeneration path is needed initially.** There is currently no tool in `mcp-server` for editing an already-published post at all (only draft → publish, once) — see Out of Scope.

## 5. Rendering

`RecipeLayout.astro` gains one new conditional section, alongside the existing "Shop this set" / "Used in this Recipe" strips:

```astro
{data.instacartUrl && (
  <a
    href={data.instacartUrl}
    target="_blank"
    rel="noopener sponsored"
    data-umami-event="instacart-buy-the-meal"
    class="block rounded-lg bg-white p-3 text-center font-heading text-sm font-medium text-text shadow-md transition-shadow hover:shadow-lg"
  >
    Buy the Meal on Instacart →
  </a>
)}
```

- Same click-tracking convention as `AffiliateLink.astro` (`data-umami-event`), so `analytics-reviewer` can measure it alongside other affiliate placements.
- The existing `{(linkedProducts.length > 0 || linkedAffiliateLinks.length > 0) && <AffiliateDisclosureBanner />}` condition is extended to also trigger on `data.instacartUrl` — this is a paid affiliate placement and needs the same FTC disclosure (Constitution principle 2) as any other, regardless of being a single button rather than a card grid.
- No client-side JS, no hydrated island, no cart state on this site — it's a static outbound link, just like today's affiliate links, pointed at a URL that happens to pre-fill a multi-item cart on Instacart's end.

## 6. Error Handling & Edge Cases

- **Instacart API down/erroring at publish time:** publish proceeds without `instacartUrl` (§4) — never blocks publishing a recipe.
- **Ingredient list too sparse/freeform for Instacart to match well:** treated the same as any other API error for now — degrade to no button rather than block publish. Exact matching behavior needs confirming against IDP docs once partner access exists.
- **Recipe has zero ingredients:** can't happen — `recipePostSchema.ingredients` already requires `.min(1)`.
- **Reader has no Instacart account or no delivery coverage in their area:** entirely Instacart's own post-handoff UX; nothing this repo can or should account for.
- **Link expiry:** unconfirmed whether Instacart's generated recipe-page links expire over time. Needs verifying against current IDP docs before implementation — if they do expire, this one-shot, publish-time-only design (§4) would need a periodic regeneration job instead.
- **Affiliate/commission attribution** (the mechanism that credits this site's Impact/Instacart affiliate account for orders placed through the button, e.g. a `partner_linkback_url`-style parameter): assumed possible but not designed in detail here — needs confirming against live IDP docs once partner access exists (see Out of Scope).

## 7. Testing Approach

Matches the existing test structure:
- `mcp-server`'s test suite — new tests for `instacart.ts`'s client in isolation (mocked HTTP), and for `confirmAndPublish.ts`'s new "Instacart call fails" path, confirming the post still publishes without `instacartUrl`.
- `tests/content/schemas.test.ts` — new fixtures covering `recipePostSchema` with and without `instacartUrl`.
- `tests/pages` (Astro side) — a recipe fixture with `instacartUrl` set renders the button and the disclosure banner; one without renders neither, unchanged from today.

## Out of Scope

- Actually applying for/obtaining Instacart IDP partner access — an external business step, not repo work (see Prerequisite in §1).
- Confirming the exact Instacart affiliate/commission attribution wiring — needs verification against live IDP docs once partner access exists.
- Regenerating a recipe's Instacart link when its ingredients change after publish — no tool for editing a published post exists in `mcp-server` today, so this stays out of scope until that capability exists.
- Any on-site cart/checkout UI — all cart/checkout happens on Instacart's own site, matching the Shopify spec's principle of never writing payment code in this repo.
- Uber Eats or other delivery vendors — researched and ruled out; no comparable recipe-to-cart API exists today.
- A detailed task-by-task implementation plan (`docs/superpowers/plans/`) — per this repo's convention, that follows once Instacart partner access is confirmed, the same way the Shopify commerce spec is waiting on a live store before its plan is written.
