# Weekly Competitor Analysis — Design

**Date:** 2026-09-06 (redesign — supersedes the 2026-08-24 draft, which was built against
`apps/lhr-office` as an Astro app with per-admin accounts; that infrastructure never shipped.
Rewritten the same way trends-watcher was: against the shared orchestrator as it actually merged.)

**Builds on shared infrastructure, as it actually exists today (not as originally speculated):**
`@lhr/jobs` (`Job`/`JobResult`/`JobRegistration` contract, `apps/lhr-office/src/registry.ts`),
`@lhr/db` (`Queryable` + `getPool()`, Postgres/Supabase via `packages/db/src/schema.sql`),
`@lhr/llm` (`callLLM`, built-in timeout/retry/multi-model fallback), and `apps/lhr-office`'s single
Basic-Auth-gated `/status` page (`requireStatusAuth`, `statusPage.ts`) — not a separate Astro app
with its own page tree and admin-account system. No new auth work here; no new page tree either.
This mirrors exactly how trends-watcher (the closest sibling: SerpApi-driven, weekly, admin-reviewed
candidates) actually shipped.

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
  covering all four dimensions, viewable on `/status`.
- New candidate competitors surface periodically for approval/rejection rather than needing to be
  manually sourced.
- SEO signal tracking works without a $99-500+/month dedicated SEO tool subscription, at the cost
  of being lighter-weight (ranking position only, no backlink/domain-authority data).
- The author can run and validate the whole pipeline herself with one command before it merges
  (Constitution rule 7) — not just a passing test suite.

**Explicitly out of scope for this phase:**
- Backlink data, domain authority, keyword volume/difficulty — the territory of a real SEO suite
  (Ahrefs/SEMrush/Moz), deliberately not taken on for this phase.
- Pixel/screenshot-based visual diffing for design/UX changes — text-described snapshots only, to
  avoid needing headless-browser rendering infrastructure.
- Auto-approving discovered competitors — always an explicit admin action.
- Any action taken *in response to* a competitor's move (e.g. auto-adjusting pricing or content
  plans) — this is observation and reporting only, same posture as the trends watcher.
- A dedicated page tree for competitors — everything lives on the one shared `/status` dashboard,
  same posture as every other job's review UI (recipe/affiliate candidates, trend topics).

## 2. Architecture & Data Flow

```
apps/lhr-office/src/competitorAnalysis.ts — exported analyzeCompetitors(): Promise<JobResult>,
registered in apps/lhr-office/src/registry.ts with cadenceDays: 7. The shared orchestrator
(already built) decides when it runs, guards against overlap, and records the outcome —
no cron/scheduling work of this feature's own.

Phase A — Discovery
  1. A handful of niche-discovery search queries via SerpApi's regular
     Google Search engine (e.g. "gluten free recipe blog",
     "kitchenware affiliate roundup" — a small curated list, not
     auto-expanding)
  2. Any resulting domain not already in `competitors` is inserted with
     status='candidate'
  3. No further action until an admin approves/rejects it from the
     "Competitor candidates" section on /status

Phase B — Weekly analysis (status='tracked' competitors only)
  For each tracked competitor:
  a. Content: fetch their RSS feed if one exists, else their blog
     listing page; extract post titles/URLs/dates; diff against the
     cumulative set of previously-seen posts across recent
     `competitor_reports` rows for this competitor (not just the latest
     row's own delta — see §6 for why that distinction matters)
  b. SEO: (see Phase C — shared across all competitors, not repeated
     per-competitor)
  c. Monetization/product: fetch their homepage; one LLM call produces
     a short structured snapshot (what they sell, price range, visible
     affiliate/ad programs), stored as this cycle's snapshot; a second,
     separate LLM call diffs it against the prior cycle's stored
     snapshot to describe what changed (the diff's output is never
     itself persisted as the snapshot — see §6)
  d. Design/UX: fetch their homepage (same fetch as monetization; one
     fetch, two LLM calls;) one LLM call produces a short
     structural/visual description (layout, prominent CTAs, visual
     style), stored and diffed the same way as (c)
  One further LLM call per competitor synthesizes a-d into a "what
  changed this week" summary.

Phase C — SEO signal tracking (once per cycle, not per competitor)
  For each keyword in the admin-managed `competitor_seo_keywords` list:
  one SerpApi Google Search call, recording which tracked competitors'
  domains appear in the results and at what position.

Write one `competitor_reports` row per tracked competitor per cycle,
folding in that cycle's relevant SEO positions from Phase C.

apps/lhr-office's existing /status page (statusPage.ts) gains three sections, following the exact
pattern already established for trend seed topics / affiliate candidates:
  "Competitors" — tracked list + latest report summary
  "Competitor candidates" — pending discovery approvals (approve/reject buttons)
  "Competitor SEO keywords" — manage the tracked keyword list (add/remove)
Each section's mutating actions are new POST routes on apps/lhr-office/src/server.ts, gated by the
same requireStatusAuth Basic Auth middleware every other /status route already uses.
```

## 3. Data Model (added to `packages/db/src/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS competitors (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',  -- 'candidate' | 'tracked' | 'rejected'
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS competitor_seo_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitor_reports (
  id SERIAL PRIMARY KEY,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  cycle_id TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  new_content JSONB NOT NULL,        -- [{title, url, publishedAt}]
  seo_positions JSONB NOT NULL,      -- [{keyword, position}]
  monetization_snapshot TEXT NOT NULL,  -- this cycle's CURRENT snapshot, not a diff (see §6)
  design_snapshot TEXT NOT NULL,        -- ditto
  summary TEXT NOT NULL
);
```

`competitor_seo_keywords` is deliberately a plain admin-managed list (unlike the trends watcher's
auto-promoted seed topics) — these are keywords the author already knows matter to her business,
not something that needs organic discovery.

## 4. SEO Signal Tracking Detail

Calls SerpApi's regular Google Search engine (not the Trends engine `serpapiTrends.ts` already
uses) once per keyword in `competitor_seo_keywords` — **one call per keyword, not per
keyword-per-competitor** — then scanning that keyword's result set for any tracked competitor's
domain and recording its position (or `null`/"not in top results" if absent). This keeps call
volume proportional to the keyword list size, not the competitor count. Reuses the same
`SERPAPI_KEY` the trends watcher already requires.

## 5. Content, Monetization, and Design Snapshots

- **Content diffing**: RSS feeds are structured and preferred when available; falling back to
  parsing a blog listing page's HTML is inherently more fragile since every site's structure
  differs. A competitor whose content can't be reliably parsed this cycle is flagged
  "unreachable this cycle" in its report rather than the pipeline crashing or guessing. The
  baseline diffed against is the union of previously-seen post URLs across several recent cycles
  (not just the immediately-prior cycle) — see §6.
- **Monetization/design snapshots**: both are free-text LLM output, not structured data. The
  column stores the CURRENT cycle's snapshot; the diff between cycles is a *separate* LLM call
  (given this cycle's snapshot + last cycle's stored snapshot, describe what changed), and that
  diff's output feeds only the final synthesis summary — it is never itself written back into the
  snapshot column. Prose rephrasing without substantive change shouldn't be reported as a
  "change," which is why this is LLM-driven rather than a mechanical text diff.
- These fetches are read-only requests to public pages — no account creation, no scraping behind
  auth walls.

## 6. Error Handling & Edge Cases

- A competitor's site is unreachable or blocks the fetch this cycle: that competitor's report for
  the cycle notes "unreachable this cycle" for the affected dimension(s) rather than blocking
  other competitors' reports or the whole run.
- SerpApi failure on a keyword call: that keyword is skipped (logged) for this cycle; other
  keywords and the rest of the pipeline continue.
- A discovered candidate domain is already `tracked` or `rejected`: discovery skips re-inserting
  it (unique constraint on `domain` makes this a safe no-op).
- LLM synthesis call failure for a competitor: the report row is still written with whatever raw
  data (content/SEO/snapshots) was gathered, and `summary` is set to the literal placeholder
  `"[Summary generation failed this cycle]"` rather than the report being dropped entirely.
- No tracked competitors yet (before any candidate is approved): Phase B and the SEO scan simply
  produce no reports — not an error state, just an empty cycle.
- **Storage/baseline correctness (learned the hard way on the first attempt at this feature):** a
  per-cycle *change description* (the LLM diff output, or a single cycle's new-content delta) must
  never be persisted into the column the NEXT cycle reads back as its baseline. Doing so silently
  corrupts every cycle after the first: a quiet week's empty delta becomes next cycle's "everything
  is new again," and a snapshot column holding change-text instead of the actual current state
  makes the following diff compare change-text against a full snapshot, which is meaningless. The
  fix pattern: persist the actual current state (full snapshot; content diffed against a
  multi-cycle union of prior URLs, not just the latest row); keep any derived "what changed"
  text local to the synthesis prompt for that cycle only.
- Every outbound fetch this pipeline makes (SerpApi, competitor homepage, competitor RSS feed)
  carries a request timeout, so one slow or hanging competitor site can't stall the whole
  orchestrator invocation past its function budget. `@lhr/llm`'s `callLLM` already bounds its own
  requests and supports an optional pipeline-wide deadline.
- Missing `SERPAPI_KEY` (or `OPENROUTER_API_KEY`, transitively via `@lhr/llm`) fails the job
  immediately with a clear error rather than silently degrading every query/keyword to "failed"
  and reporting `'partial'` indefinitely — matches the trends watcher's own fail-fast behavior.

## 7. Testing Approach

- Discovery unit tests: candidate insertion, unique-domain no-op on rediscovery of an
  already-tracked/rejected domain, one SerpApi call per curated query.
- Content-diff tests: RSS-available path, HTML-fallback path, unparseable-site path (flagged, not
  crashed), and a regression test proving the baseline is the union of several recent cycles' new
  content, not just the latest cycle's own delta.
- SEO scan tests: keyword → SerpApi call → position extraction for a tracked domain present/absent
  in mocked results; one call per keyword regardless of tracked-competitor count.
- Snapshot tests: the stored snapshot is the raw current-cycle output (not the diff text); the
  diff is a separate mocked LLM call, including the "no substantive change" case.
- Job-level unit test (mocking every collaborator) plus an integration test (mocking only
  fetch/`callLLM`/`@lhr/db`) asserting a `competitor_reports` row is written per tracked
  competitor even when one dimension fails for one competitor, and that two consecutive cycles
  with unchanged content don't re-report old posts as new.
- Route tests for the three new `/status` sections and their POST actions (approve/reject
  candidate, add/remove keyword), all behind `requireStatusAuth`, using the existing
  `createApp(db, registry, ...)` + supertest pattern.
- A single command the author can run herself against a real `DATABASE_URL`/`SERPAPI_KEY`/
  `OPENROUTER_API_KEY` to execute one real cycle and see real output (Constitution rule 7).

## Out of Scope

- Real SEO suite data (backlinks, domain authority, keyword volume/difficulty).
- Screenshot/pixel-based visual diffing — text-described snapshots only.
- Auto-approving discovered competitors — always an explicit admin action.
- Acting on findings (adjusting pricing/content strategy automatically) — reporting only.
- A dedicated page tree — everything lives on the shared `/status` dashboard.
