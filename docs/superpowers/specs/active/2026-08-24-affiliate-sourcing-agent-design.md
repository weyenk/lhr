# Affiliate Sourcing Agent — Design

**Date:** 2026-08-24
**Status:** Draft — second of five sub-projects in a larger automation initiative (recipe variant
generator is spec'd/in progress separately; trends watcher, competitor analysis, product-in-photo
placement, and a local orchestrator are separate, later specs)

**Amendment (2026-08-24, during sub-project 3 brainstorming):** §3 below originally called for a
standalone `lhr-affiliate-review` Vercel project. The author has since decided all internal tools
(this one, the trends report, and future ones) should live under one shared, password-protected
hub at `office.loveheatrelationship.com` instead of a separate deployed project per sub-project.
**§3 is superseded** — build the approval UI as a route inside the shared internal app (see the
trends-watcher spec, `2026-08-24-trends-watcher-design.md`, for where that shared app is
established) rather than its own Vercel project. Everything else in this spec (Postgres schema,
Keepa sourcing, scoring model, approve-writes-to-affiliate-links flow) is unaffected.

## 1. Overview & Goals

Today every affiliate link is added by hand, one at a time, during post authoring (`site-help` /
`add_affiliate_link`). This spec adds a standing weekly pipeline: source ~20 candidate products
from Amazon (the author's active affiliate program), estimate each one's commission and sales
potential, and present them for approval on a password-protected review page reachable from any
device. Approved products land directly in `src/content/affiliate-links` — ready inventory for
manual linking today, and for the later product-in-photo placement sub-project. Every decision
(approve or deny) feeds a transparent scoring model that shapes future candidate selection without
ever fully locking onto past choices.

**Ground truth established during brainstorming** (worth restating since it reframes the original
ask): the site has **no formally enrolled affiliate program** per `docs/BACKLOG.md`, but Amazon
Associates is confirmed active in practice. Amazon doesn't expose *personal* commission-earned or
*personal* sales-history data for products never before linked — those numbers only exist after a
product has actually been sold through your tag. So for new candidates, "commission" and "sales
volume" are necessarily **estimates**, not personal account data:
- **Commission** = Amazon's public Associates category rate-card lookup (e.g. Kitchen 3%,
  Grocery 1%), not a personal/negotiated rate.
- **Sales volume** = Keepa's estimated-monthly-sales metric and Best Sellers Rank, a market
  popularity proxy — not units *you've* sold.

Both are labeled clearly as estimates in the review UI so they're never mistaken for real
personal earnings data. This is revisited once products have real sales history through this
site's tag.

**Primary success criteria:**
- Every week, ~20 new candidate products appear on the review page with category, price,
  estimated commission, and estimated sales volume shown.
- Approving a product immediately creates a real `affiliate-links` entry in the repo; denying
  just records the decision — neither blocks on anything else.
- Over many cycles, candidates increasingly reflect what's actually been approved before, while a
  reserved slice of each cycle stays unweighted so the system can't ossify into only re-showing
  variations of past approvals.

**Explicitly out of scope for this phase:**
- Any affiliate network besides Amazon Associates. Revisit if/when another program is enrolled.
- The Product Advertising API. The author doesn't have qualifying-sales-based PA API access yet;
  Keepa is the data source instead (§4).
- Attaching approved products to actual recipe posts/photos — that's the separate
  product-in-photo placement sub-project, which consumes this one's output.
- Real personal earnings/sales-history data (§1) — not available for un-sold candidates via any
  API; this phase uses public/estimated proxies only, clearly labeled as such.
- The shared local orchestrator/scheduler runner and the other three agents — separate specs.

## 2. Architecture & Data Flow

Two components, split by where they need to run:

```
Local weekly cron — mcp-server/scripts/source-affiliate-candidates.ts
  1. Query Keepa for trending/rising products in niche categories
     (seeded from existing src/content/products categories + recipe
     ingredient themes)
  2. Filter out ASINs already in affiliate-links or already decided
     (approved or denied) in decision_history
  3. Score remaining candidates against the learned preference model (§5)
  4. Take the top candidates, reserving ~20% of the 20 slots as
     unweighted "wildcards" straight from the trending list (§5)
  5. Look up each candidate's category commission rate (static rate-card
     table) and Keepa's estimated-monthly-sales figure
  6. Write the cycle's 20 candidates into Postgres (`candidates` table,
     status='pending')

Deployed approval app — new small Astro app, its own separate Vercel
project (kept separate from the public site so enabling Vercel
Deployment Protection here never touches the public site's access)
  1. Reads this cycle's pending candidates from Postgres
  2. Renders each with image, price, category, estimated commission,
     estimated sales volume — all estimate fields visibly labeled
  3. Approve → API route commits a new affiliate-links/*.json file to
     main via the same GitHub-commit helper mcp-server/src/github.ts
     already exposes (commitFilesToMain), then writes status='approved'
     to the candidate row and a row to decision_history. The approval
     click is the explicit confirmation — no separate publish step,
     unlike posts (which still always require confirm_and_publish).
  4. Deny → writes status='denied' + a decision_history row only, no
     repo write.
```

The "brain" (sourcing, scoring, rate lookups) stays local and cron-driven, matching the rest of
this initiative's local-orchestrator direction; the only deployed surface is a thin, password-gated
review UI reading/writing the same Postgres database the local job populates.

## 3. Hosting & Access Control

A new, separate Vercel project (e.g. `lhr-affiliate-review`), not a route inside the public
`lhr-site` project. Protected with Vercel's built-in Deployment Protection (password), which is a
platform feature — no custom auth code to build or maintain. Keeping it a fully separate project
means the public site's access is never at risk of being accidentally gated by a misconfigured
route-level check.

The two projects share one Postgres database (via Vercel Marketplace, Neon) — the local script
connects with a `DATABASE_URL` env var (added to `.env.example`), the Vercel project gets the same
connection string via its own Vercel-managed environment variable through the Marketplace
integration.

## 4. Candidate Sourcing (Keepa)

New module `mcp-server/src/keepa.ts`:

- Category/keyword seeds derived from `src/content/products` categories and a maintained list of
  recipe-relevant search terms (kitchenware, pantry staples, common recipe ingredients) — not a
  fully open-ended Amazon-wide search.
- Calls Keepa's product-finder/category endpoints filtered to "trending"/rising sales rank within
  those seeds.
- Pulls, per candidate: ASIN, title, category, price, image, current price, Best Sellers Rank,
  rating, review count, and Keepa's estimated-monthly-sales figure.
- Requires a `KEEPA_API_KEY` env var (added to `.env.example`). Keepa's free tier's token budget
  is enough for a weekly 20-candidate cycle; noted as a cost to monitor if cycles are ever made
  more frequent.

**Commission rate-card lookup**: `mcp-server/src/amazonCommissionRates.ts`, a static table mapping
Amazon's published Associates category rates (e.g. `Kitchen: 3%`, `Grocery: 1%`, `Electronics:
1%`) to Keepa's category taxonomy, with a documented default ("everything else" rate) for any
category not explicitly listed — surfaced in the UI as a fallback estimate, not a confident number
(§1).

## 5. Learning Mechanism

A transparent, inspectable scoring function — not an opaque model — computed at candidate-scoring
time (step 3 of §2):

- From `decision_history`, compute rolling approve/deny rates bucketed by **category**, **price
  band** (e.g. under $15 / $15-40 / $40+), and **commission-rate band**.
- Score each candidate as a weighted blend of: its bucket's historical approve rate + its Keepa
  popularity signals (estimated-monthly-sales, rating) — popularity signals matter even for
  never-before-seen categories, so the model isn't purely dependent on history.
- Rank by score, take the top ~80% of the 20 slots.
- The remaining ~20% are filled from the raw trending list *without* the preference weighting —
  concretely how the system avoids collapsing onto only what's been approved before. This is also
  what naturally handles cold start: with zero decision history, every bucket's approve rate is
  undefined/neutral, so the ranked-80% and the wildcard-20% converge to the same thing — pure
  trending-popularity ranking — until enough history accumulates to differentiate them.

## 6. Data Model (Postgres via Neon)

```sql
CREATE TABLE candidates (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  product_url TEXT NOT NULL,
  commission_rate NUMERIC NOT NULL,
  commission_rate_is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_monthly_sales INTEGER,
  bsr INTEGER,
  bsr_category TEXT,
  rating NUMERIC,
  review_count INTEGER,
  score NUMERIC NOT NULL,
  is_wildcard BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE decision_history (
  id SERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  commission_rate NUMERIC NOT NULL,
  estimated_monthly_sales INTEGER,
  decision TEXT NOT NULL, -- 'approved' | 'denied'
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`candidates` is the working queue for the current and past cycles (never deleted — `cycle_id` +
`status` let the review app and the sourcing script both filter to "this week's pending ones"
while keeping history browsable). `decision_history` is a flattened, append-only log purpose-built
for the scoring model's bucketed aggregate queries in §5.

An approved candidate produces a file at `src/content/affiliate-links/<slugified-asin-or-title>.json`
matching the existing `affiliateLinkSchema` (`label`, `url`, `tag`, `image`, `imageAlt`) —
`url` built from the ASIN + the author's Associates tag, `label` from the product title.

## 7. Error Handling & Edge Cases

- Keepa API failure or rate-limit hit: the cycle logs and exits without writing a partial/garbage
  candidate list — better to skip a week than show low-quality picks.
- Fewer than 20 qualifying trending candidates found: ship what's found, log the shortfall; never
  pad with irrelevant filler to hit exactly 20.
- No rate-card entry for a candidate's category: falls back to the default rate, and
  `commission_rate_is_fallback` is set so the UI can visibly flag it as a rough estimate.
- Candidate already exists (ASIN already in `affiliate-links`, or already decided in
  `decision_history`): filtered out before ever reaching the queue — never re-asked.
- Approval click succeeds in Postgres but the GitHub commit fails: candidate stays `status='approved'`
  with no corresponding file; the next cron run reconciles by re-attempting the commit for any
  `approved` candidate with no matching `affiliate-links` file yet, rather than silently losing an
  approved product.
- Deployed app down or Postgres unreachable when a cycle completes: candidates simply wait in
  `pending` status until the app/DB is reachable again — no time-sensitive expiry.

## 8. Testing Approach

- `keepa.test.ts` — candidate fetch/parse (mocked API responses), category-seed filtering.
- `amazonCommissionRates.test.ts` — known-category lookup, fallback-rate path with the flag set.
- Scoring-function unit tests — given a `decision_history` fixture, verify bucketed approve-rate
  weighting, the ~20%-wildcard reservation, and the cold-start (empty-history) case converging to
  pure popularity ranking.
- Integration test for the approval app's approve flow (mocked GitHub client + test DB) —
  confirms both a `decision_history` row and a schema-valid `affiliate-links` file are produced,
  and that a deny produces only the history row.
- Reconciliation-pass test — an `approved` candidate with no matching file gets its commit
  retried on the next run.

## Out of Scope

- Non-Amazon affiliate networks and the Product Advertising API (§1) — Keepa only, for now.
- Attaching approved products to recipe content (§1) — separate product-in-photo sub-project.
- Real personal commission/sales data (§1) — not obtainable for un-sold candidates via any API;
  revisit once this site's tag has real sales history.
- The shared local orchestrator/scheduler runner and the other three remaining agents (§1) —
  separate specs.
