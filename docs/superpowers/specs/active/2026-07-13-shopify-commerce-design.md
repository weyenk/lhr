# Shopify Commerce Integration — Design

**Date:** 2026-07-13
**Status:** Active — not started. No implementation plan written yet; no Shopify code exists in `src/`. Listed as backlog item 1 in `docs/BACKLOG.md`.

## 1. Overview & Goals

The site today is content-first: recipes and articles reference kitchenware products (`src/content/products`), but every product is purely affiliate-style — it links out to an external `vendorUrl` and the site never handles money, inventory, or checkout. This spec adds real e-commerce: some products will be sold directly through a Shopify store, while others remain affiliate links to third-party vendors, coexisting side by side.

Shopify was chosen over BigCommerce, a cart-as-a-service (Snipcart/Swell), and a fully custom (Stripe-based) build because it hands off payment security (PCI compliance), fraud checks, sales-tax calculation, and inventory tracking entirely — the most first-time-owner-friendly option, at the cost of a monthly platform fee and needing to sync product data with an external system.

**Primary success criteria:**
- A recipe/article can reference a product that is either `affiliate` (today's behavior, unchanged) or `shopify` (real inventory, live price, add-to-cart), with both types coexisting under the same `kitchenwareIds` list.
- A shopper can browse a full `/shop` catalog, view an individual product, add Shopify-backed products to a cart, and check out through Shopify's own hosted checkout — no payment code lives in this repo.
- Content pages (posts, home) remain fully static; only commerce routes render per-request.
- The existing affiliate flow keeps working with no behavior change for any content that isn't migrated to `shopify` type.

**Prerequisite:** A live Shopify store must exist before this integration is functional (store creation is an external signup step, not part of this repo — as of 2026-07-13 no store exists yet). Repo-side work can be built and tested against a Shopify sandbox/dev store in the meantime, gated behind environment variables so nothing here requires production credentials to develop.

## 2. Rendering Architecture

- Astro stays on static output (`output: 'static'`, today's default) for all content pages — posts and home are unaffected.
- Only commerce routes (`/shop`, `/shop/[handle]`, `/cart`) opt into server rendering via Astro 5's per-page `export const prerender = false`, which requires switching the top-level Astro config to `output: 'server'` plus adding the `@astrojs/vercel` adapter to `astro.config.mjs`.
- Vercel hosting is unchanged — no new hosting provider is needed. The adapter builds commerce routes as serverless functions while content pages remain static assets from the same build.
- `vercel.json` stays minimal, relying on Vercel's zero-config detection of the Astro adapter rather than a hand-written `builds` array — this repo already hit a real regression from that pattern in `mcp-server/vercel.json` (commit `9ded348`: a custom `builds` array made Vercel skip Project Settings and ship no deployable output).
- SSR's value here is freshness and UX (always-current price/stock at view time, no stale-then-patched flash), not secret-keeping — the Shopify Storefront API token used is a public/publishable token, safe to expose client-side, regardless of rendering mode.

## 3. Content Schema Changes

`productSchema` (`packages/schemas/src/index.ts`) becomes a discriminated union on `type`, mirroring the existing `recipe`/`article` split in `postSchema`:

```ts
const affiliateProductSchema = z.object({
  type: z.literal('affiliate'),
  name: z.string(),
  priceCents: z.number().int().positive(),
  image: z.string().url(),
  imageAlt: z.string(),
  vendorUrl: z.string().url(),
  setId: z.string().optional(),
});

const shopifyProductSchema = z.object({
  type: z.literal('shopify'),
  shopifyHandle: z.string(),    // join key into Shopify's Storefront API
  setId: z.string().optional(),
  blurb: z.string().optional(), // editorial copy Shopify has no place for
});

export const productSchema = z.discriminatedUnion('type', [affiliateProductSchema, shopifyProductSchema]);
```

- **Affiliate branch is today's schema unchanged**, just tagged `type: 'affiliate'` — no behavior change for existing content.
- **Shopify branch drops `priceCents`/`image`/`imageAlt`/`vendorUrl` entirely.** Those become facts fetched live from Shopify via `shopifyHandle`, never hand-authored, so they can't drift from the real store.
- `setId` remains purely editorial (site-side curation grouping for storytelling); it is not required to map 1:1 onto a real Shopify collection. `setSchema` is unchanged.
- **Migration:** the one existing product, `src/content/products/coastal-blue-platter.json`, needs `"type": "affiliate"` added to keep validating and rendering exactly as it does today.

## 4. Pages, Routes & Cart/Checkout Flow

**New routes**, all server-rendered per §2:
- `/shop` — catalog listing of all products (both `affiliate` and `shopify` type, pulled from the `products` collection). For `shopify`-type entries, fetches live price/image/stock from the Shopify Storefront API on each request.
- `/shop/[handle]` — individual product detail page. Live data for `shopify`-type; local content data for `affiliate`-type (served under the same route, just without an external call).
- `/cart` — cart view, server-rendered so it can read the cart-ID cookie server-side and render actual cart contents on first paint rather than shipping an empty shell that fills in after hydration.
- **No checkout page exists in this repo.** "Proceed to Checkout" redirects the browser to the `checkoutUrl` returned by Shopify's Cart API — payment happens entirely on Shopify's own domain. No PCI/payment code is ever written here.

**Add-to-cart mechanics:** a small client-side island (hydrated component) calls the Shopify Storefront API directly from the browser using the public/publishable token, creating or updating a Shopify Cart object and storing the cart ID in a cookie. This button behaves identically whether it sits on a static recipe post page or an SSR shop page — the static/SSR distinction only affects how the surrounding page shell is built, not how the cart interaction works.

**Product cards embedded in existing recipe/article posts** (today's `RecipeLayout`/`ArticleLayout` behavior) are architecturally unchanged: for `shopify`-type products they show data fetched once at *build* time (the same freshness tier the affiliate cards already have), with the same live add-to-cart island. Clicking through to `/shop/[handle]` gets the fully live, server-rendered version. This avoids forcing the static content pages into server rendering just because they reference a Shopify product.

**All Shopify Storefront API calls go through one thin client module** (e.g. `src/lib/shopify.ts`) — a single seam for both the build-time snapshot fetch and the request-time SSR fetch, and the mock point for tests (see §6).

## 5. Error Handling & Edge Cases

- **Build-time snapshot fetch failure** (fetching a `shopify`-type product's data for an embedded static card) fails the build loudly, naming the offending `shopifyHandle` — silently shipping stale or wrong price data is worse than a blocked deploy.
- **Request-time SSR failure** (Shopify unreachable while a shopper is on `/shop` or `/shop/[handle]`) degrades gracefully to an inline "unable to load product info right now" state, not a 500. Because only commerce routes are server-rendered, a Shopify outage never affects the static content/blog side of the site.
- **Invalid or stale `shopifyHandle`** (typo, or the product was deleted/unpublished in Shopify) is caught before reaching real visitors via a validation check — run in CI alongside the existing zod schema checks — confirming every `shopifyHandle` in the `products` collection resolves against Shopify.
- **Expired/invalid cart-ID cookie:** silently create a fresh empty cart rather than erroring.
- **Out-of-stock items:** the add-to-cart control reflects unavailability (disabled/hidden) rather than allowing an add that will fail at checkout.
- **Affiliate-type products never participate in the cart.** They only ever render an outbound "Shop at [vendor]" link, exactly as today — cart/checkout logic only ever touches `shopify`-type line items.

## 6. Testing Approach

Matches the existing `tests/` structure (`tests/content`, `tests/pages`, `tests/lib`, `tests/deployment`):
- `tests/content/schemas.test.ts` — new fixtures covering both branches of the `productSchema` discriminated union (valid/invalid affiliate and shopify entries).
- `tests/lib/shopify.test.ts` (new) — tests the thin Shopify client module in isolation.
- `tests/pages` — new cases for `/shop`, `/shop/[handle]`, `/cart`, rendered against a mocked Shopify client (via the `src/lib/shopify.ts` seam) — no test ever needs live Shopify credentials or network access. Covers the happy path plus the failure states in §5 (API down, invalid handle, expired cart, out-of-stock).
- `tests/deployment/vercel-config.test.ts` (existing) — extended to assert the `@astrojs/vercel` adapter and `output: 'server'` config are wired correctly, given this repo's history of silent Vercel build breakage.

## Out of Scope

- The full `/shop` catalog and cart/checkout UI's visual design (layout, styling) — this spec covers architecture and data flow, not the visual design pass.
- Customer accounts / order history on the site itself — guest checkout via Shopify's hosted checkout only; account features are part of the separately-planned community/engagement roadmap, not this spec.
- Mapping editorial `setId` groupings onto real Shopify collections — `setId` stays a site-side-only curation concept for now.
- A Shopify webhook to auto-trigger a Vercel rebuild on product/price changes in Shopify (would improve staleness of the build-time snapshot data used in embedded post cards) — worth revisiting later, not required at launch.
- Actual Shopify store creation/configuration — external signup step, not repo work.
