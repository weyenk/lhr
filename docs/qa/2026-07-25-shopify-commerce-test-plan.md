# Shopify Commerce Integration — User Flows, Acceptance Criteria & Test Plan

**Date:** 2026-07-25
**Source spec:** `docs/superpowers/specs/active/2026-07-13-shopify-commerce-design.md` (architecture settled; not reopened here)
**Status:** Ready for `developer` TDD. Open questions in §8 must be answered before the items tagged `[BLOCKED]` are implemented.

**Business stakes:** all six products in the next seasonal set ship as **owned inventory** through this integration, targeting a **January 2027 launch**. This is money-and-inventory critical path, not a spike. The quality bar in §7 is set accordingly, and §8 flags where the spec's "Out of Scope" list collides with what an actual launch needs.

**Hard constraint (non-negotiable):** no test may require live Shopify credentials or network access. Everything mocks through the single `src/lib/shopify.ts` seam (spec §4). `npm test` must pass on a machine with no Shopify env vars and no outbound network.

---

## 1. Verified baseline

Facts confirmed by running/reading the repo on 2026-07-25, not assumed:

| Fact | Evidence |
| --- | --- |
| `npm test` is green: 11 files, 39 tests | `npm test` output |
| Astro `5.18.2`; no `@astrojs/vercel` installed | `node_modules/astro/package.json`, `ls node_modules/@astrojs` |
| `productSchema` is a flat object with **required** `setId` | `packages/schemas/src/index.ts:42-49` |
| Only one product entry exists, with no `type` field | `src/content/products/coastal-blue-platter.json` |
| Tests import schemas via `src/content/schemas.ts`, a bare `export * from '@lhr/schemas'` | `tests/content/schemas.test.ts:8` |
| `ProductCard.astro` reads `vendorUrl`/`image`/`imageAlt`/`priceCents` unconditionally and hardcodes `rel="noopener sponsored"` + "Shop this piece (affiliate link)" | `src/components/ProductCard.astro` |
| `vercel.json` currently pins `"outputDirectory": "dist"` | `vercel.json` |
| Regression `9ded348` was a `builds` array in `mcp-server/vercel.json` that made Vercel skip Project Settings and emit **zero deployable output** | `git show 9ded348` |
| `@astrojs/vercel@10/11` require Astro `^6`/`^7`. **Astro 5 needs `@astrojs/vercel@^8` or `^9`** | `npm view @astrojs/vercel@N peerDependencies` |
| With the adapter, built HTML is written to `dist/client/` and copied to `.vercel/output/static/`; the SSR function lands in `.vercel/output/functions/_render.func` | adapter source `dist/index.js` (v8/v9/v11 all identical here) |

**Consequence of the last row — read this before starting.** Every existing page test reads `dist/index.html`, `dist/about/index.html`, `dist/posts/<slug>/index.html`. Switching to `output: 'server'` + adapter moves those to `dist/client/...`. Six existing test files break the moment the adapter lands. This is a *migration task the spec does not mention*; it is covered by **AC-E5** and must be handled with a shared path helper, not by weakening assertions.

---

## 2. User flows

### 2.1 Happy paths

**F1 — Reader on a static post buys a set piece.** Reader opens `/posts/<slug>/`, sees kitchenware cards (build-time snapshot data for `shopify` items, local JSON for `affiliate` items), clicks Add to Cart on a `shopify` card. The island calls Shopify from the browser with the public token, creates a cart, stores the cart ID cookie, and reflects "added". Reader clicks through to `/cart`, sees line items rendered server-side on first paint, clicks Proceed to Checkout, and is redirected to Shopify's `checkoutUrl` on Shopify's domain.

**F2 — Shopper browses the catalog.** Shopper opens `/shop`. Server renders each product: `shopify` entries with live price/image/stock fetched at request time, `affiliate` entries from local content. Shopper opens `/shop/<handle>`, sees fully live detail, adds to cart, proceeds as in F1.

**F3 — Reader clicks an affiliate product.** Identical to today. Outbound `vendorUrl` link, `rel="noopener sponsored"`, FTC disclosure text, `kitchenware-click` Umami event. No cart, no Shopify call.

**F4 — Author adds a seventh product.** Author writes `src/content/products/<id>.json` with `type: "shopify"` and a `shopifyHandle`. Schema validation passes, `/shop` lists it, the build-time snapshot resolves, and the CI handle check confirms it exists in Shopify.

### 2.2 Edge and failure flows

| ID | Flow | Expected |
| --- | --- | --- |
| F5 | Shopify unreachable during `npm run build` | Build **fails loudly**, exit ≠ 0, message names every offending `shopifyHandle` |
| F6 | Shopify unreachable during a request to `/shop` or `/shop/[handle]` | Inline "unable to load product info right now", HTTP **200**, never a 500; static content side unaffected |
| F7 | `shopifyHandle` typo'd or product unpublished in Shopify | Caught by a CI validation step naming the handle *and* the content file, before real visitors |
| F8 | Cart cookie expired / invalid / forged | Fresh empty cart created silently; no error surfaced |
| F9 | Product out of stock | Add-to-cart control disabled with a visible reason; no add attempt possible |
| F10 | Affiliate product reached via any cart code path | Impossible — affiliate products render no cart control and cannot become line items |
| F11 | No Shopify env vars set at all (today's repo state) | `npm run build` and `npm test` both still succeed |
| F12 | `/shop/<handle>` for a handle in no content collection | 404, not 500 |
| F13 | Empty `products` collection | `/shop` renders an empty state, does not crash |
| F14 | Double-click Add to Cart | One line added, not two |

---

## 3. Acceptance criteria

Every criterion below is written so a single test can assert it. IDs are referenced by the test plan in §5.

### A. Schema — `productSchema` discriminated union (spec §3)

- **AC-A1** A valid `affiliate` fixture (`type`, `name`, `priceCents`, `image`, `imageAlt`, `vendorUrl`, `setId`) parses successfully.
- **AC-A2** An affiliate fixture missing `type` is rejected, and the issue path includes `type`.
- **AC-A3** `priceCents` rejects negative, zero, and non-integer values on the affiliate branch.
- **AC-A4** Malformed `image` or `vendorUrl` (non-URL string) is rejected on the affiliate branch.
- **AC-A5** A minimal valid `shopify` fixture (`type: 'shopify'`, `shopifyHandle`) parses successfully — no `priceCents`/`image`/`imageAlt`/`vendorUrl` required.
- **AC-A6** A `shopify` fixture with optional `setId` and `blurb` parses successfully.
- **AC-A7** A `shopify` fixture missing `shopifyHandle`, or with `shopifyHandle: ''`, is rejected. *(Empty-string rejection tightens the spec's bare `z.string()`; an empty handle is an invalid-handle vector that would otherwise reach the Shopify call. See §8 Q3.)*
- **AC-A8** A `shopify` fixture that also carries `priceCents` or `vendorUrl` is **rejected**, not silently stripped. Hand-authored prices on owned inventory are exactly the drift spec §3 exists to prevent. *(Requires `.strict()` on the shopify branch — see §8 Q3.)*
- **AC-A9** An entry with an unrecognized `type` (e.g. `"dropship"`) is rejected with a discriminator error naming `type`.
- **AC-A10** Both branches parse successfully with `setId` omitted. *(Per spec §3. Note this **loosens** today's required `setId` — see §8 Q1.)*
- **AC-A11** `ProductData` narrows on `type` at the type level: `if (p.type === 'shopify')` gives access to `shopifyHandle` and denies `vendorUrl`, and vice versa. Asserted by a typecheck that must pass.

### B. Content migration

- **AC-B1** `src/content/products/coastal-blue-platter.json` contains `"type": "affiliate"` and all its existing fields unchanged (`priceCents: 4800`, `setId: "coastal-blue"`).
- **AC-B2** `getCollection('products')` loads every entry without a validation error.
- **AC-B3** All `shopifyHandle` values across the collection are unique — two content entries pointing at one Shopify product is a merchandising bug that silently double-lists a SKU.
- **AC-B4** The existing recipe post page still renders `Coastal Blue Serving Platter`, `$48.00`, and `data-umami-event="kitchenware-click"` — byte-for-byte behavior parity for the affiliate path (spec §1 success criterion 4).

### C. Shopify client seam — `src/lib/shopify.ts` (spec §4)

- **AC-C1** The module can be imported with **no Shopify env vars set** without throwing. Config (store domain, public token, API version) and `fetch` are injected into a factory, not read at module scope. This is what makes AC-F11 and the no-credentials constraint achievable.
- **AC-C2** `getProductByHandle(handle)` returns a normalized object — at minimum `{ handle, title, priceCents, currencyCode, image, imageAlt, availableForSale, variantId }` — from a mocked Storefront response.
- **AC-C3** Price normalization converts Shopify's decimal-string money (`"48.00"`, `"19.99"`, `"0.10"`) to exact integer cents (`4800`, `1999`, `10`) with no floating-point drift.
- **AC-C4** `getProductByHandle` returns `null` for a handle Shopify does not know, rather than throwing.
- **AC-C5** A non-2xx HTTP response throws a typed error whose message includes the offending `handle` and the HTTP status.
- **AC-C6** A 200 response carrying a top-level GraphQL `errors` array is treated as a failure (typed error), never as an empty/absent product.
- **AC-C7** Requests carry the **public/publishable** Storefront token header. No Admin API token, and no non-`PUBLIC_`-prefixed secret, is read anywhere in the module — asserted by a source-level check so a private key can never leak into the client bundle.
- **AC-C8** `createCart()`, `addCartLines(cartId, lines)`, and `getCart(cartId)` each return normalized shapes including `checkoutUrl` and `totalCents`.
- **AC-C9** `getCart` with an expired/unknown cart ID returns `null`, never throws.
- **AC-C10** Every network call goes through the injected `fetch`; tests assert the injected mock was called and that no global `fetch` is used.
- **AC-C11** Requests are bounded by an explicit timeout/abort so a hung Shopify call cannot hang a Vercel serverless invocation to its platform limit.

### D. Build-time snapshot for embedded post cards (spec §4, §5)

- **AC-D1** A `shopify`-type product referenced by a post's `kitchenwareIds` renders a card whose name and price come from the (mocked) Shopify snapshot, not from content JSON.
- **AC-D2** If the snapshot fetch fails for any handle, `npm run build` exits non-zero and stderr contains the offending `shopifyHandle`.
- **AC-D3** When multiple handles fail, the failure message names **all** of them, not just the first. With six SKUs, one-per-build debugging is unacceptable.
- **AC-D4** With zero `shopify`-type products in the collection (today's state) and no Shopify env vars set, `npm run build` succeeds and makes no Shopify call.
- **AC-D5** A `shopify`-type card rendered inside a post does **not** display affiliate-disclosure text and does **not** carry `rel="sponsored"`. Owned inventory is not an affiliate placement; mislabeling it violates Constitution principle 2's intent (disclosure must be *accurate*).

### E. Rendering split (spec §2)

- **AC-E1** After `npm run build`, static HTML exists for `/`, `/about`, and every `/posts/<slug>/`.
- **AC-E2** After `npm run build`, **no** prerendered HTML exists for `/shop`, `/shop/<handle>`, or `/cart`.
- **AC-E3** After `npm run build`, at least one serverless function directory exists at `.vercel/output/functions/*.func` containing a `.vc-config.json`.
- **AC-E4** `.vercel/output/config.json` exists and routes non-static requests to that function.
- **AC-E5** All six existing page/layout/style test files continue to pass after the output location moves from `dist/` to `dist/client/` + `.vercel/output/static/`, via a single shared path helper rather than per-file hardcoded paths.
- **AC-E6** `astro.config.mjs` sets `output: 'server'` and registers the `@astrojs/vercel` adapter.

### F. `/shop` catalog

- **AC-F1** Lists every product in the collection, both types.
- **AC-F2** `shopify` entries display price/image/availability from the mocked client; `affiliate` entries display them from content JSON.
- **AC-F3** When the mocked client throws, the response status is **200**, the page shell renders, affiliate entries still render fully, and each failed `shopify` entry shows the inline unavailable state.
- **AC-F4** With an empty products collection, the page renders an empty state and returns 200.
- **AC-F5** Affiliate cards render an outbound `vendorUrl` link with `rel` containing `noopener` and `sponsored`, plus disclosure text, and render **no** add-to-cart control.
- **AC-F6** Shopify cards render an add-to-cart control and **no** affiliate-disclosure text.

### G. `/shop/[handle]`

- **AC-G1** A `shopify` product renders live title/price/image plus an add-to-cart control bound to the returned `variantId`.
- **AC-G2** An `affiliate` product renders from content data and the mocked Shopify client is asserted **not called** (zero calls).
- **AC-G3** A handle present in no content collection returns **404**, not 500.
- **AC-G4** A handle present in content but unresolvable in Shopify at request time returns the degraded "currently unavailable" state with **no** add-to-cart control. *(Status code choice — see §8 Q5.)*
- **AC-G5** `availableForSale: false` renders a disabled add-to-cart control with visible "Out of stock" copy, and the control carries no submittable `variantId`.
- **AC-G6** A thrown client error yields the degraded state at HTTP **200** — never a 500.

### H. Add-to-cart island

- **AC-H1** The identical component is used on static post pages and SSR shop pages: the same root marker (custom element / `data-` attribute set) appears in both the built static post HTML and the SSR `/shop/[handle]` HTML.
- **AC-H2** No add-to-cart control is emitted for an `affiliate`-type product — not a disabled one, none at all.
- **AC-H3** With no cart cookie present, a click calls `createCart` exactly once and writes the cart-ID cookie.
- **AC-H4** With a valid cart cookie, a click calls `addCartLines` with that cart ID and does **not** call `createCart`; the cookie value is unchanged.
- **AC-H5** With an expired/invalid cart cookie (client returns `null`), a click silently calls `createCart`, overwrites the cookie, completes the add, and surfaces **no** error to the user.
- **AC-H6** The cart cookie is written with `Path=/`, `SameSite=Lax`, `Secure`, **not** `HttpOnly` (the island must read it from JS), and a `Max-Age` no longer than Shopify's cart lifetime. *(Values — see §8 Q4.)*
- **AC-H7** The control is disabled while a request is in flight; two rapid clicks produce exactly one `addCartLines` call.
- **AC-H8** On network failure the user sees an error, the control is re-enabled, and the existing cookie is left intact (not cleared).
- **AC-H9** A successful add emits a Umami event following the existing `kitchenware-click`/`affiliate-click` convention. *(Event name — see §8 Q6.)*

### I. `/cart`

- **AC-I1** With no cart cookie, the page renders an empty-cart state and makes zero Shopify calls.
- **AC-I2** With a valid cart cookie, line items appear in the **server-rendered HTML** (asserted on the raw response body, before any hydration) — spec §4's stated reason for SSR'ing this route.
- **AC-I3** With an expired cookie, the page renders the empty state, sets a fresh cart cookie, returns 200, and shows no error.
- **AC-I4** "Proceed to Checkout" links to the `checkoutUrl` returned by the mocked client, on a Shopify-owned domain.
- **AC-I5** The repo contains no payment-collection code: a source-level scan finds no card-number/CVV inputs and no payment-processor dependency in `package.json`.
- **AC-I6** A cart response containing a line item that maps to an `affiliate`-type content product is not rendered as a purchasable line — the affiliate/cart boundary holds even against unexpected upstream data.
- **AC-I7** A thrown client error yields a degraded message at HTTP 200, never a 500.

### J. `shopifyHandle` validation (spec §5)

- **AC-J1** A pure validator function takes `(products, client)` and returns a list of unresolvable handles — fully mockable, no network of its own.
- **AC-J2** Returns an empty list when every handle resolves.
- **AC-J3** For each failure, reports both the `shopifyHandle` and the content entry id / filename.
- **AC-J4** The validator is exposed as a **separate npm script** (e.g. `npm run check:shopify-handles`) that is **not** part of `npm test`. `npm test` passes with zero Shopify env vars and no network.
- **AC-J5** CI invokes that script as its own step, distinct from the `npm test` step, so a Shopify outage can never masquerade as a unit-test failure.

### K. Deployment config (spec §2, regression `9ded348`)

- **AC-K1** `package.json` depends on an `@astrojs/vercel` major whose declared `peerDependencies.astro` range accepts the installed Astro major (`^8` or `^9` for Astro 5).
- **AC-K2** `npm install` resolves cleanly with no `--legacy-peer-deps` / `--force`.
- **AC-K3** `vercel.json` contains **no `builds` array** — the literal shape of `9ded348`.
- **AC-K4** `vercel.json` does **not** pin `outputDirectory` to `dist`. The adapter emits `.vercel/output`; leaving the current `"outputDirectory": "dist"` in place is the same class of failure as `9ded348` — a hand-written override that makes Vercel ship the wrong (or no) output.
- **AC-K5** `vercel.json` still declares `framework: "astro"` and otherwise relies on zero-config detection.
- **AC-K6** **The deployable-output assertion.** After a real `npm run build`, `.vercel/output/config.json` exists, `.vercel/output/static/index.html` exists, and at least one `.vercel/output/functions/*.func/` directory exists. This is the check whose absence let `9ded348` ship. Config-file assertions alone are insufficient; this one must run against real build output.

### L. Non-regression

- **AC-L1** All 39 pre-existing tests pass unchanged in intent (path updates per AC-E5 are the only permitted edit).
- **AC-L2** Typecheck / `astro check` is clean.
- **AC-L3** The full `npm test` suite passes with networking unavailable.

---

## 4. Level definitions

- **unit** — pure functions and schemas, no build, no filesystem. Fast.
- **integration** — runs `npm run build` and/or renders a route with the `src/lib/shopify.ts` seam mocked. Slower; follows the existing `execSync('npm run build')` + read-output pattern.
- **config** — asserts on `astro.config.mjs`, `vercel.json`, `package.json`, and real build artifacts under `.vercel/output/`.

There is no browser/e2e layer in this repo today and this feature does not justify introducing one. Island behavior (§H) is tested at unit level against a jsdom-style DOM environment plus a mocked client — **except AC-H1**, which is an integration assertion on rendered markup from both page types. If the developer finds jsdom unavailable, raise it rather than dropping §H coverage; the cart is the highest-stakes surface in this feature.

---

## 5. Test plan — criteria to cases

### `tests/content/schemas.test.ts` (unit, extend existing)

| Case | AC |
| --- | --- |
| valid affiliate fixture parses | A1 |
| affiliate missing `type` rejected, path includes `type` | A2 |
| `priceCents` rejects −100, 0, 48.5 | A3 |
| non-URL `image` / `vendorUrl` rejected | A4 |
| minimal shopify fixture parses | A5 |
| shopify fixture with `setId` + `blurb` parses | A6 |
| shopify missing handle rejected; empty-string handle rejected | A7 |
| shopify fixture carrying `priceCents` / `vendorUrl` rejected | A8 |
| `type: 'dropship'` rejected with discriminator error | A9 |
| both branches parse with `setId` omitted | A10 |
| type-narrowing fixture compiles (typecheck) | A11 |

### `tests/content/collections.test.ts` (integration, extend existing)

| Case | AC |
| --- | --- |
| platter entry has `type: 'affiliate'`, `priceCents` 4800, `setId` coastal-blue | B1 |
| `getCollection('products')` resolves with no validation error | B2 |
| all `shopifyHandle` values unique across collection | B3 |

### `tests/lib/shopify.test.ts` (unit, **new**)

| Case | AC |
| --- | --- |
| module imports with no env vars set, does not throw | C1 |
| `getProductByHandle` normalizes a mocked Storefront payload | C2 |
| money strings `"48.00"`/`"19.99"`/`"0.10"` → `4800`/`1999`/`10` | C3 |
| unknown handle → `null` | C4 |
| non-2xx → typed error naming handle + status | C5 |
| 200 with GraphQL `errors` → typed error, not empty product | C6 |
| public token header sent; source contains no Admin token / non-`PUBLIC_` secret read | C7 |
| `createCart` / `addCartLines` / `getCart` normalize, expose `checkoutUrl` + `totalCents` | C8 |
| `getCart` with dead cart ID → `null` | C9 |
| injected fetch is the only network path | C10 |
| request aborts at the configured timeout | C11 |

### `tests/lib/shopify-handle-check.test.ts` (unit, **new**)

| Case | AC |
| --- | --- |
| validator returns [] when all handles resolve | J1, J2 |
| validator names handle + content file id for each failure | J3 |
| `npm test` passes with Shopify env vars unset (suite-level) | J4, L3 |

### `tests/pages/shop.test.ts` (integration, **new**)

| Case | AC |
| --- | --- |
| lists both product types | F1 |
| shopify entries use mocked live data; affiliate use content JSON | F2 |
| client throws → 200, shell + affiliate items render, per-item unavailable state | F3, F6 |
| empty collection → empty state, 200 | F4 |
| affiliate card: `rel` has `noopener sponsored` + disclosure, no cart control | F5, F10 |
| shopify card: cart control present, no disclosure text | F6 |

### `tests/pages/shop-detail.test.ts` (integration, **new**)

| Case | AC |
| --- | --- |
| shopify detail renders live data + cart control bound to `variantId` | G1 |
| affiliate detail renders content data; mocked client asserted **not called** | G2 |
| unknown handle → 404 | G3 |
| content handle unresolvable in Shopify → degraded state, no cart control | G4 |
| `availableForSale: false` → disabled control, "Out of stock", no variantId | G5 |
| client throws → degraded state at 200 | G6 |

### `tests/pages/cart.test.ts` (integration, **new**)

| Case | AC |
| --- | --- |
| no cookie → empty state, zero Shopify calls | I1 |
| valid cookie → line items present in raw SSR body | I2 |
| expired cookie → empty state, fresh cookie set, 200, no error | I3, F8 |
| checkout link points at mocked `checkoutUrl` | I4 |
| repo scan: no card inputs, no payment-processor dependency | I5 |
| affiliate-mapped line item not rendered purchasable | I6 |
| client throws → degraded message at 200 | I7 |

### `tests/components/add-to-cart.test.ts` (unit + integration, **new**)

| Case | AC | Level |
| --- | --- | --- |
| same root marker in static post HTML and SSR shop HTML | H1 | integration |
| affiliate product emits no control at all | H2 | integration |
| no cookie → `createCart` once, cookie written | H3 | unit |
| valid cookie → `addCartLines` with that id, no `createCart`, cookie unchanged | H4 | unit |
| dead cookie → silent `createCart`, cookie overwritten, add completes, no user error | H5 | unit |
| cookie attrs: `Path=/`, `SameSite=Lax`, `Secure`, not `HttpOnly`, bounded `Max-Age` | H6 | unit |
| in-flight guard: two rapid clicks → one `addCartLines` | H7 | unit |
| network failure → error shown, control re-enabled, cookie intact | H8 | unit |
| success emits the Umami add-to-cart event | H9 | unit |

### `tests/pages/recipe-post.test.ts` / `article-post.test.ts` (integration, extend existing)

| Case | AC |
| --- | --- |
| affiliate card behavior byte-for-byte unchanged: name, `$48.00`, `kitchenware-click` | B4 |
| shopify card in a post shows snapshot name/price from mocked client | D1 |
| shopify card in a post carries no disclosure text and no `rel="sponsored"` | D5 |

### `tests/deployment/build-output.test.ts` (config, **new**)

| Case | AC |
| --- | --- |
| static HTML present for `/`, `/about`, all posts | E1 |
| no prerendered HTML for `/shop`, `/shop/*`, `/cart` | E2 |
| `.vercel/output/functions/*.func/.vc-config.json` exists | E3, K6 |
| `.vercel/output/config.json` routes to the function | E4, K6 |
| `.vercel/output/static/index.html` exists | K6 |
| snapshot fetch failure → non-zero exit, stderr names the handle | D2 |
| multiple failures → stderr names all handles | D3 |
| zero shopify products + no env vars → build succeeds, zero Shopify calls | D4, F11 |

### `tests/deployment/vercel-config.test.ts` (config, extend existing)

| Case | AC |
| --- | --- |
| `astro.config.mjs` sets `output: 'server'` and registers `@astrojs/vercel` | E6 |
| adapter major's `peerDependencies.astro` accepts installed Astro major | K1 |
| lockfile resolves without `--legacy-peer-deps` | K2 |
| `vercel.json` has **no** `builds` key | K3 |
| `vercel.json` does not pin `outputDirectory: "dist"` | K4 |
| `vercel.json` keeps `framework: "astro"` | K5 |

---

## 6. Suggested TDD sequence

Ordered so the riskiest, most reversible-if-wrong decisions land first and the existing suite is never red for long.

1. **§A schema + §B migration.** Pure, fast, zero infrastructure. Establishes the union before anything consumes it.
2. **`ProductCard.astro` branch split.** Not a spec section, but the union makes today's component type-unsafe on day one (it reads `vendorUrl`/`priceCents` unconditionally). Must be handled here or step 1 leaves the tree failing typecheck.
3. **§C client seam.** Everything downstream mocks against it; get the interface right before three call sites depend on it.
4. **§K + §E config/rendering split, with AC-E5 path migration.** Do this as one commit — the existing suite goes red mid-way otherwise.
5. **§F, §G, §I routes** against the mocked seam.
6. **§H island**, last, since it depends on §C's cart methods and §G's rendered markup.
7. **§D build-time snapshot + §J CI handle check.**

---

## 7. Quality bar — definition of done

This feature is done when **all** of the following hold, each confirmed by observed command output (not by reading code):

1. `npm test` passes with **no Shopify env vars set and no network access**. This is the single most important gate; if it can only pass online, the seam is wrong.
2. Every failure mode in spec §5 has a dedicated failing-path test that is red before its fix and green after: build-time fetch failure (D2/D3), request-time SSR failure (F3/G6/I7), invalid handle (J1–J3), expired cart cookie (H5/I3), out-of-stock (G5).
3. `npm run build` succeeds on the current content — zero `shopify`-type products, no credentials — and makes zero Shopify calls (D4). The site must never become unbuildable because Shopify isn't set up yet.
4. AC-K6 passes against real build output. Config-file assertions alone would have passed on `9ded348` too.
5. Both union branches have valid **and** invalid fixtures (A1–A10). A discriminated union with only happy-path fixtures is untested.
6. The affiliate path is provably unchanged: B4 green, and `git diff` shows no behavioral change to affiliate rendering.
7. Affiliate products are structurally incapable of entering the cart (H2, F5, G2, I6) — not merely "not currently wired up".
8. All 39 pre-existing tests pass (L1), typecheck clean (L2).

**Explicitly not the bar:** a numeric coverage percentage. Critical-path and error-state coverage as enumerated above is the bar.

---

## 8. Open questions, scope gaps, and Out-of-Scope collisions

Items marked **[BLOCKED]** need an answer before the corresponding AC can be implemented as written. The rest are risks to schedule, not to code.

### Spec ambiguities

**Q1 — `setId` becomes optional, and nothing surfaces sets anyway. [BLOCKED for AC-A10]**
Spec §3 shows `setId: z.string().optional()` on both branches; today it is **required**. For six owned-inventory products that *are* a seasonal set, optional `setId` means a product can silently fail to appear in its own set. Worse: `getSetProducts()` in `src/lib/content.ts` is currently called by **no page** — the active set has no surface on the site at all. Recommend `setId` stay **required for `shopify`-type** products and optional only for affiliate. Needs the author's call.

**Q2 — What is `[handle]` in `/shop/[handle]`? [BLOCKED for AC-G1/G2/G3]**
Spec §4 serves both types under this route, but affiliate products have no `shopifyHandle`. Is the route param the content entry id (filename slug) or the `shopifyHandle`? They will differ. Recommend **content entry id** — site-owned, stable, works uniformly for both types, and keeps URLs from churning if a Shopify handle is renamed. Needs confirmation; it determines URL structure, which is expensive to change post-launch and has SEO consequences.

**Q3 — Strictness of the shopify branch. [affects AC-A7, AC-A8]**
The spec's literal snippet uses a bare `z.string()` handle and non-strict objects, so `""` would validate and a stray `priceCents` would be silently stripped. I have written A7/A8 to reject both, because on owned inventory a hand-authored price that Shopify disagrees with is a consumer-facing pricing error. Flagging that this is *my* tightening, not the spec's text.

**Q4 — Cart cookie contract is entirely unspecified. [BLOCKED for AC-H6]**
Spec §4 says the island writes a cart-ID cookie and `/cart` reads it server-side, but names no cookie name, lifetime, or attributes. Note the constraint the spec doesn't state: because a browser island must read it, the cookie **cannot be `HttpOnly`**. Proposed: name `lhr_cart_id`, `Path=/`, `SameSite=Lax`, `Secure`, `Max-Age` ≤ 10 days (Shopify carts expire after ~10 days of inactivity, so a longer cookie guarantees AC-H5's silent-recreate path fires routinely). Confirm before implementing.

**Q5 — Status code for "in content, gone from Shopify". [affects AC-G4]**
A discontinued SKU is arguably a 404 (SEO-correct, de-indexes cleanly) but a temporary Shopify outage on the same code path is arguably a 200 with a degraded body. Spec §5 lumps them together. Recommend: **client returned `null`** (product genuinely absent) → 404 with a helpful body; **client threw** (outage) → 200 degraded. AC-G4 and AC-G6 are written that way; confirm.

**Q6 — No commerce analytics anywhere in the spec. [affects AC-H9]**
Rule 1 mandates Umami, and the codebase already has `kitchenware-click` / `affiliate-click` conventions, but the spec defines no add-to-cart or checkout-start event. Launching owned inventory with no funnel instrumentation means no way to tell a traffic problem from a conversion problem. Recommend `add-to-cart` and `checkout-start` events mirroring the existing convention. Low implementation risk; naming needs a nod.

### Out-of-Scope items that collide with a real January 2027 launch

**G1 — Rebuild webhook (spec Out of Scope). This is the sharpest collision.**
For affiliate products, a stale build-time price snapshot in a post card is a mild annoyance. For **owned inventory it is a pricing-accuracy problem**: a post card can advertise $48 while Shopify checkout charges $54, and can promote a sold-out SKU indefinitely. Deferring the webhook is defensible; deferring *any* mitigation is not. Pick one before launch: (a) don't render price/stock in build-time snapshot cards at all, (b) have the add-to-cart island refresh price/stock client-side on hydration, or (c) a scheduled daily rebuild. Option (b) is cheapest and reuses the island that already exists in this plan. **Recommend deciding this now** — it changes AC-D1 and AC-H1.

**G2 — `setId` → Shopify collection mapping (spec Out of Scope).**
Combined with Q1, this means the six-product seasonal set exists as a site-side editorial grouping with no counterpart in Shopify and no page that renders it. Acceptable for a technical spec; **not** acceptable for a launch whose entire merchandising story is "the seasonal set". Needs a separate spec for a set/collection landing page. Flagging as a launch-scope gap, not a defect in this plan.

**G3 — `/shop` visual design (spec Out of Scope).**
Correctly deferred — but `docs/BACKLOG.md` item 2 (visual/brand design system) is still unstarted, and this plan's tests assert structure and data, never appearance. A design pass on `/shop`, `/shop/[handle]`, and `/cart` must be scheduled as its own spec before January, or the launch ships architecture with no storefront.

**G4 — Customer accounts (spec Out of Scope).**
Guest-checkout-only is a reasonable launch posture; Shopify sends order confirmations itself. Accepted risk: no on-site order status means all post-purchase support is email. No test impact.

**G5 — Not in the spec at all: launch-blocking legal/operational work.**
Selling owned inventory triggers items already sitting in `docs/BACKLOG.md`: **sales tax registration** (explicitly conditioned on "products are sold directly"), **business entity + bank account**, **business insurance** ("mainly relevant if the site ever sells or ships physical products directly"), and **legal pages** (BACKLOG item 3 — Privacy Policy, ToS, plus shipping and returns/refund policies that Shopify checkout expects and consumers are owed). None are code, none are testable here, and all are January blockers. Raising them because the spec's silence could read as "handled".

**G6 — Rule 6 (multi-supplier sourcing) is unverifiable in this repo.**
`RULES.md` Rule 6 requires each set to draw from several distinct suppliers. Neither branch of the new `productSchema` records a supplier, so no test in this repo can check it — supplier data will live only in Shopify. Not proposing a schema change (that's product/sourcing territory), but flagging that Rule 6 compliance for the six-product set is a manual check with no automated guard.

### Documentation drift found while writing this plan

- `tests/docs/governance.test.ts` asserts "rules includes all **five** evolvable rules" while `docs/RULES.md` now has **six** (Rule 6, multi-supplier sourcing, added since). The test still passes — it just never checks Rule 6 — so the drift is silent. This is a test file and therefore a `developer` task, not a doc fix: update the title to six and add an assertion for the Rule 6 text.
- `docs/DEPLOYMENT.md` step 1 says "Vercel reads `vercel.json` automatically — no further config needed." Once `output: 'server'` + the adapter land, this needs a note about `.vercel/output` and about **not** reintroducing `outputDirectory`/`builds`. Deferred until the change actually ships, to avoid documenting a state that doesn't exist yet.
