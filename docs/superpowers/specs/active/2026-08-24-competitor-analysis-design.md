# Weekly Competitor Analysis — Design

**Date:** 2026-08-24
**Status:** Draft — fourth of five sub-projects in a larger automation initiative (recipe variant
generator, affiliate sourcing agent, and trends watcher are spec'd/in progress separately;
product-in-photo placement and a local orchestrator are separate, later specs)

**Builds on shared infrastructure:** like the trends watcher, this lands in the already-scaffolded
`apps/lhr-office` (server-output Astro) and the shared `@lhr/db` (Postgres/Neon) package, and every
route it adds goes through the `requireAdminSession()` check established by the trends-watcher
spec. No new auth work here.

**Amendment (2026-08-25, from the local-orchestrator spec):** §2's "Local weekly cron —
mcp-server/scripts/analyze-competitors.ts" is superseded on execution model. Scheduling moved to
Vercel Cron Jobs — see `2026-08-25-local-orchestrator-design.md`. The discovery/analysis pipeline
must be an exported async function (e.g. `analyzeCompetitors()`), not a standalone CLI script —
the orchestrator's Vercel Cron-triggered endpoint imports and calls it directly, in-process.
Everything else (discovery, four-dimension analysis, SEO tracking) is unaffected.

## 1. Overview & Goals

Adds a weekly, always-current view of named competitors — other recipe/food content creators and
kitchenware curators — across four dimensions: new content published, SEO keyword-ranking signals,
monetization/product strategy, and design/UX changes. Competitors aren't hand-entered once and
forgotten: the pipeline periodically searches for candidates and surfaces them for explicit
approval, similar in spirit to the trends watcher's seed-topic discovery but with a manual approval
gate rather than auto-promotion, since tracking a whole competitor is a bigger commitment than
trying a search topic.

**Primary success criteria:**
- Every week, each *tracked* (approved) competitor gets a short "what changed this week" summary
  covering all four dimensions, viewable at `office.loveheatrelationship.com/competitors`.
- New candidate competitors surface periodically for approval/rejection rather than needing to be
  manually sourced.
- SEO signal tracking works without a $99-500+/month dedicated SEO tool subscription, at the cost
  of being lighter-weight (ranking position only, no backlink/domain-authority data).

**Explicitly out of scope for this phase:**
- Backlink data, domain authority, keyword volume/difficulty — the territory of a real SEO suite
  (Ahrefs/SEMrush/Moz), deliberately not taken on for this phase (§1, per brainstorm).
- Pixel/screenshot-based visual diffing for design/UX changes — text-described snapshots only,
  to avoid needing headless-browser rendering infrastructure.
- Auto-approving discovered competitors — always an explicit admin action.
- Any action taken *in response to* a competitor's move (e.g. auto-adjusting pricing or content
  plans) — this is observation and reporting only, same posture as the trends watcher.
- The shared local orchestrator/scheduler runner and product-in-photo placement — separate specs.

## 2. Architecture & Data Flow

```
Local weekly cron — mcp-server/scripts/analyze-competitors.ts

Phase A — Discovery
  1. A handful of niche-discovery search queries via SerpApi's regular
     Google Search engine (e.g. "gluten free recipe blog",
     "kitchenware affiliate roundup" — a small curated list, not
     auto-expanding)
  2. Any resulting domain not already in `competitors` is inserted with
     status='candidate'
  3. No further action until an admin approves/rejects it on
     /competitors in apps/lhr-office

Phase B — Weekly analysis (status='tracked' competitors only)
  For each tracked competitor:
  a. Content: fetch their RSS feed if one exists, else their blog
     listing page; extract post titles/URLs/dates; diff against the
     most recent prior `competitor_reports` row for this competitor to
     find genuinely new posts
  b. SEO: (see Phase C — shared across all competitors, not repeated
     per-competitor)
  c. Monetization/product: fetch their shop/product pages; one LLM
     call produces a short structured snapshot (what they sell, price
     range, visible affiliate/ad programs); diffed textually against
     the prior cycle's stored snapshot
  d. Design/UX: fetch their homepage; one LLM call produces a short
     structural/visual description (layout, prominent CTAs, visual
     style); diffed textually against the prior cycle's snapshot
  One further LLM call per competitor synthesizes a-d into a "what
  changed this week" summary.

Phase C — SEO signal tracking (once per cycle, not per competitor)
  For each keyword in the admin-managed `competitor_seo_keywords` list:
  one SerpApi Google Search call, recording which tracked competitors'
  domains appear in the results and at what position.

Write one `competitor_reports` row per tracked competitor per cycle,
folding in that cycle's relevant SEO positions from Phase C.

apps/lhr-office adds:
  /competitors            — tracked competitor list + latest reports
  /competitors/candidates — pending discovery approvals
  /competitors/keywords   — manage the SEO keyword list
```

## 3. Data Model (added to `@lhr/db`)

```sql
CREATE TABLE competitors (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',  -- 'candidate' | 'tracked' | 'rejected'
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE competitor_seo_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE competitor_reports (
  id SERIAL PRIMARY KEY,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  cycle_id TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  new_content JSONB NOT NULL,        -- [{title, url, published_at}]
  seo_positions JSONB NOT NULL,      -- [{keyword, position}]
  monetization_snapshot TEXT NOT NULL,
  design_snapshot TEXT NOT NULL,
  summary TEXT NOT NULL
);
```

`competitor_seo_keywords` is deliberately a plain admin-managed list (unlike the trends watcher's
auto-promoted seed topics) — these are keywords the author already knows matter to her business,
not something that needs organic discovery.

## 4. SEO Signal Tracking Detail

Reuses the SerpApi account already established for the trends watcher, calling its regular Google
Search engine (not the Trends engine) once per keyword in `competitor_seo_keywords` — **one call
per keyword, not per keyword-per-competitor** — then scanning that keyword's result set for any
tracked competitor's domain and recording its position (or "not in top results" if absent). This
keeps call volume proportional to the keyword list size, not the competitor count.

**Budget reality:** combined with the trends watcher's own usage (~100/month estimated there),
this feature's discovery + keyword-tracking calls push total SerpApi usage past the free tier.
Plan to move the SerpApi account to a paid tier (their next tier is ~$75/month for 5,000 searches)
once both features are live, rather than trying to fit both under the free 100/month.

## 5. Content, Monetization, and Design Snapshots

- **Content diffing**: RSS feeds are structured and preferred when available; falling back to
  parsing a blog listing page's HTML is inherently more fragile since every site's structure
  differs. A competitor whose content can't be reliably parsed this cycle is flagged
  "couldn't determine new content" in its report rather than the pipeline crashing or guessing.
- **Monetization/design snapshots**: both are free-text LLM output, not structured data — the
  diff between cycles is also LLM-driven (given this cycle's snapshot + last cycle's snapshot,
  describe what changed), not a mechanical text diff, since prose rephrasing without substantive
  change shouldn't be reported as a "change."
- These fetches are read-only requests to public pages, same posture as the existing
  `monetization-scout`/`product-sourcing-scout` agents' research approach — no account creation,
  no scraping behind auth walls.

## 6. Error Handling & Edge Cases

- A competitor's site is unreachable or blocks the fetch this cycle: that competitor's report for
  the cycle notes "unreachable this cycle" for the affected dimension(s) rather than blocking
  other competitors' reports or the whole run.
- SerpApi failure on a keyword call: that keyword is skipped (logged) for this cycle; other
  keywords and the rest of the pipeline continue.
- A discovered candidate domain is already `tracked` or `rejected`: discovery skips re-inserting
  it (unique constraint on `domain` makes this a safe no-op).
- LLM synthesis call failure for a competitor: the report row is still written with whatever raw
  data (content/SEO/snapshots) was gathered, and `summary` is set to a placeholder rather than
  the report being dropped entirely.
- No tracked competitors yet (before any candidate is approved): Phase B and the SEO scan simply
  produce no reports — not an error state, just an empty cycle.

## 7. Testing Approach

- Discovery unit tests: candidate insertion, unique-domain no-op on rediscovery of an
  already-tracked/rejected domain.
- Content-diff tests: RSS-available path, HTML-fallback path, unparseable-site path (flagged, not
  crashed).
- SEO scan tests: keyword → SerpApi call → position extraction for a tracked domain present/absent
  in mocked results; one call per keyword regardless of tracked-competitor count.
- Snapshot-diff tests: LLM-driven change description given two mocked snapshots (mocked LLM call),
  including the "no substantive change" case.
- Integration test for `analyze-competitors.ts`: mocked SerpApi/fetch/LLM, asserts a
  `competitor_reports` row is written per tracked competitor even when one dimension fails for one
  competitor (partial report, not a crashed run).
- Page-level tests for `/competitors`, `/competitors/candidates` (approve/reject), and
  `/competitors/keywords` (add/remove), all behind `requireAdminSession()`.

## Out of Scope

- Real SEO suite data (backlinks, domain authority, keyword volume/difficulty) (§1).
- Screenshot/pixel-based visual diffing (§1) — text-described snapshots only.
- Auto-approving discovered competitors (§1) — always an explicit admin action.
- Acting on findings (adjusting pricing/content strategy automatically) (§1) — reporting only.
- The shared local orchestrator and product-in-photo placement (§1) — separate specs.
