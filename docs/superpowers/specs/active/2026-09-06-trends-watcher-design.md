# Trends Watcher — Design

**Date:** 2026-09-06
**Status:** Draft — third of five sub-projects in the automation initiative (recipe variant
generator and affiliate sourcing are merged and live; weekly competitor analysis and
product-in-photo placement are separate, later specs). This supersedes an earlier
2026-08-24 draft of the same name that was built against a since-abandoned architecture
(a standalone Astro app with its own database-backed multi-admin accounts) — that draft's
PR was closed unmerged once the shared-orchestrator spec (2026-08-25) landed a different,
simpler design (a single Express app, one shared HTTP Basic Auth credential, a `@lhr/jobs`
registry) that this spec now builds against instead.

## 1. Overview & Goals

Adds a weekly-refreshed trends report — web design, cooking, and nutrition — sourced from Google
Trends (via SerpApi, since there's no official Google Trends API), synthesized by an LLM into
"what's worth knowing this week," and viewable on `apps/lhr-office`'s existing `/status` page
alongside the site's other three automation agents. The seed topics driving each category's
search aren't a static list the author maintains forever: an LLM proposes adjacent topics each
cycle, and any topic that keeps showing up gets automatically promoted into the permanent curated
list — the concrete mechanism for staying current without manual upkeep, while the author can
still directly manage the curated list at any time from `/status`.

This is the fourth entry in the `@lhr/jobs` registry (alongside `recipe-variant-generator`,
`recipe-variant-finisher`, `affiliate-sourcing`), reusing the orchestrator, cron trigger,
due-check/overlap-guard, and Basic-Auth-gated `/status` page that already exist — none of that is
built by this spec, only consumed.

**Primary success criteria:**
- Every week, a new report appears per category (web design, cooking, nutrition) with an LLM
  summary of what's worth knowing, plus the raw signal (rising queries, trending-now items) behind
  it, visible on `/status`.
- A topic the author never explicitly added can still show up as a permanent seed once it's proven
  itself across several cycles — the promotion mechanism from §5 — while the author can also
  promote, demote, or add a curated topic directly from `/status` at any time.
- SerpApi usage stays inside the free tier (~100 searches/month) at the topic caps in §6.
- The `/status` sections this adds are unstyled, plain semantic HTML — matching the page's
  existing convention (no CSS anywhere on it yet) — so a single future styling pass can cover all
  four agents' sections at once rather than three done and one left over.

**Explicitly out of scope for this phase:**
- Automatically triggering any other agent off trends findings. The report is a human-readable
  input for planning, not a pipeline that writes content on its own.
- Non-Amazon-Associates-adjacent commerce trend data. This is purely Google Trends interest data
  across the three named categories.
- Any notification/alerting (email, Slack, push) when a new report lands — checking `/status` is
  the only surface for now, consistent with the shared-orchestrator spec's posture.
- Historical trend-report analytics/charting beyond listing past cycles' reports as-is.
- A local-LLM backend or availability-based LLM routing (see §2's `@lhr/llm` extraction) — deferred
  until the author's forthcoming local hardware and its actual server software exist; building
  that now would mean guessing at an interface with nothing real to validate it against.
- Weekly competitor analysis and product-in-photo placement — separate, later specs.

## 2. Architecture & Data Flow

```
Vercel Cron (daily) → POST /api/cron/orchestrator (apps/lhr-office, already built)
  → due-check picks trends-watcher when it's the most overdue registered job
  → apps/lhr-office/src/trendsWatcher.ts: sourceWeeklyTrends(): Promise<JobResult>
      1. Read current `trend_seed_topics` (status='curated') per category from @lhr/db
      2. One @lhr/llm call per category: given the curated list + the site's niche
         (docs/CONSTITUTION.md), suggest up to 2 adjacent topics to try this cycle
         (deduped against curated + itself — not persisted as curated yet, see §5)
      3. For every curated + suggested topic: SerpApi call via
         apps/lhr-office/src/serpapiTrends.ts (interest-over-time + rising related
         queries)
      4. One SerpApi "trending now" call per category (wildcard layer, independent
         of the seed list — see §4)
      5. Update `trend_seed_topics`: increment times_seen for repeated suggested
         topics, insert new candidates, auto-promote any candidate crossing the
         promotion threshold (§5)
      6. One @lhr/llm call per category: synthesize this cycle's raw data (curated +
         suggested + wildcard) into a short "what's worth knowing" summary
      7. Write one `trends_reports` row per category to Postgres (@lhr/db)
      8. Return a JobResult (§9) summarizing the cycle across all three categories
  → orchestrator records the JobResult to `orchestrator_runs`, same as every other job

apps/lhr-office/src/registry.ts (existing file, gets a 4th entry):
  { name: 'trends-watcher', cadenceDays: 7, run: sourceWeeklyTrends }

apps/lhr-office's /status page (existing, extended — see §8):
  - Trends section: latest summary + raw findings per category, history below
  - Seed topics section: every topic with Promote/Demote buttons, plus a form to
    add a curated topic directly (§5)
```

**Two prerequisite refactors this spec requires, both driven by the same root cause — trends-watcher
is the first agent whose pipeline needs an LLM call but has no reason to touch git/GitHub, unlike
the other two:**

- **`packages/llm` (new package, `@lhr/llm`).** Today, `callOpenRouter` lives in
  `mcp-server/src/openrouter.ts` and is reused by other workspace members only because
  `mcp-server` compiles a `dist-lib/` for its own *authoring* machinery (GitHub client, draft
  storage) to be imported elsewhere. Recipe-variant-generator and affiliate-sourcing legitimately
  need that authoring machinery (both end their pipeline by writing to git), so importing from
  mcp-server's dist-lib is the right call for them. Trends-watcher needs none of that — its only
  connection to mcp-server would be a single stateless, third-party-API wrapper, which isn't
  authoring-domain logic any more than it's orchestrator-domain logic. Rather than add a third
  case of "import mcp-server as if it were a generic library" (or worse, wrap a stateless function
  in a network call to mcp-server purely to avoid a direct import — which would add a real failure
  mode, mcp-server's own uptime/cold-start, for zero decoupling benefit, since there's no shared
  state or security boundary to protect), this spec extracts the OpenRouter-calling logic verbatim
  into a proper shared package, matching how `@lhr/db`/`@lhr/schemas` already work.

  Interface, deliberately backend-agnostic (not named after OpenRouter) so a local-model backend
  can be added later without a second interface migration:

  ```ts
  // packages/llm/src/index.ts
  export interface LlmMessage {
    role: 'system' | 'user';
    content: string;
  }

  export async function callLLM(messages: LlmMessage[], options?: { deadline?: number }): Promise<string>;
  ```

  Implemented today with exactly one backend (the current `openrouter.ts` logic — multi-model
  fallback, rate-limit backoff, deadline support — moved here unchanged). `mcp-server`'s two
  existing callers (`dietSubstitutions.ts`, `narrative.ts`) switch their import from
  `./openrouter.js` to `@lhr/llm`; `mcp-server/src/openrouter.ts` is deleted, not kept as a
  re-export, since nothing outside mcp-server ever depended on that specific module path (unlike
  `mcp-server/src/github.ts`'s history of staying a re-export for import-path compatibility).

- **`packages/jobs/src/registry.ts` relocates to `apps/lhr-office/src/registry.ts`.** The concrete
  job array is app-specific wiring (only `apps/lhr-office/src/server.ts` ever reads it), not shared
  logic — `@lhr/jobs` otherwise holds only generic types and pure functions (`isDue`,
  `selectMostOverdue`, `validateJobRegistrations`) that have no opinion about which jobs exist.
  Today this doesn't matter, since every job's `run` function is importable from mcp-server's
  dist-lib without circularity. It matters starting now: trends-watcher's `run` function lives in
  `apps/lhr-office` itself, and `apps/lhr-office` already depends on `@lhr/jobs` (for `isDue`/
  `selectMostOverdue`) — if the registry stayed in `@lhr/jobs`, it would need to import back from
  `apps/lhr-office`, a circular package↔app dependency. Relocating the registry into the app that
  actually owns it avoids that entirely, and only touches one file move, one import-path change in
  `server.ts`, and one moved test file — see the Global Constraints in the implementation plan for
  the exact diff.

## 3. Data Model (added to `@lhr/db`, appended to `packages/db/src/schema.sql`)

```sql
CREATE TABLE trend_seed_topics (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,             -- 'web-design' | 'cooking' | 'nutrition'
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',  -- 'curated' | 'candidate'
  times_seen INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at TIMESTAMPTZ,
  UNIQUE (category, topic)
);

CREATE TABLE trends_reports (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  category TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  topics_used JSONB NOT NULL,      -- [{topic, source: 'curated'|'suggested'}, ...]
  raw_findings JSONB NOT NULL,     -- interest/related-queries/trending-now data, per topic
  summary TEXT NOT NULL            -- LLM-synthesized "what's worth knowing"
);
```

New query modules `packages/db/src/trendSeedTopics.ts` / `trendsReports.ts`, following the
package's current convention exactly: row types are `type X = {...}` (a type alias, not an
`interface` — interfaces have no implicit index signature, and `Queryable.query<T extends
Record<string, unknown>>` needs one), every exported function takes `db: Queryable` as its first
parameter, and both modules are re-exported from `packages/db/src/index.ts`. Applied to the
database the same way the existing tables were: `psql "$DATABASE_URL" -f
packages/db/src/schema.sql`, run once after this merges (idempotent — `CREATE TABLE IF NOT
EXISTS` — safe to re-run against a database that already has the other tables).

## 4. Trends Data Source (SerpApi)

New module `apps/lhr-office/src/serpapiTrends.ts` (app-local — nothing else needs it):

- `fetchInterestAndRelatedQueries(topic, geo='US')` — wraps SerpApi's `google_trends` engine,
  returning interest-over-time direction (rising/falling/flat) and the top + rising related
  queries. Coerces a numeric `value` field to a string rather than dropping it, and logs (via
  `console.warn`, including the raw shape) whenever a non-empty response yields zero usable
  items or fewer than 2 parseable timeline points — so a SerpApi response-shape mismatch is
  visible in logs instead of silently reading as "nothing interesting happened this week."
- `fetchTrendingNow(category)` — wraps SerpApi's trending-now/daily-trends engine, using the
  `category_id` values confirmed from SerpApi's own published category list (`18` = Technology
  for web-design, `5` = Food and Drink for cooking, `7` = Health for nutrition) — this is the
  wildcard layer (§1) that finds things no seed list would think to search for.
- Requires a `SERPAPI_KEY` env var on the `apps/lhr-office` Vercel project (already anticipated by
  `docs/DEPLOYMENT.md`'s operational-setup section; the author has already signed up for SerpApi's
  free tier and can add the key).

## 5. Seed Topic Management & Promotion

- **Curated rows** are used as permanent base seeds every cycle (§2 step 1).
- Each cycle's LLM-suggested topics (§2 step 2) are normalized (lowercase, trim — no fuzzy
  semantic matching) and matched against existing rows by `(category, normalized topic)` via an
  `INSERT ... ON CONFLICT (category, topic) DO UPDATE SET times_seen = times_seen + 1` upsert —
  the `UNIQUE (category, topic)` constraint makes this a safe, race-proof operation, not something
  the application needs to guard separately.
- Suggested topics are deduped against both the curated list and themselves *before* that upsert
  runs, so a topic the LLM re-suggests that's already curated is never fetched from SerpApi twice
  in one cycle (wasted budget) and never has `times_seen` incremented more than once per cycle
  (the promotion rule below is specifically about separate cycles, not repeats within one).
- **Promotion**: a candidate crossing **`times_seen >= 3`** (three separate cycles, not three
  mentions in one cycle) flips to `status='curated'` and sets `promoted_at`. Run once per category
  per cycle, after that category's suggested-topic upserts.
- The author can also directly promote, demote, or add a curated topic via `/status` (§8) —
  automatic promotion is a convenience, not the only path.

## 6. Budget Cap

To stay inside SerpApi's 250 searches/month free tier (the author's actual plan): curated seeds
are expected to settle around 4-5 per category; the LLM adds up to 2 candidate suggestions per
category per cycle (§2 step 2); that's up to ~7 topic calls/category × 3 categories = 21, plus 3
trending-now calls = 24 calls/week ≈ 104/month at the high end — comfortably inside the 250/month
budget, with room for curated lists to grow well past the ~4-5/category estimate before this
becomes a concern. Still called out explicitly as a cap to watch rather than assumed safe forever:
if the curated lists grow large enough to push the monthly total past ~250 (roughly 12+/category
at the current suggestion rate), either the LLM-suggestion count or the SerpApi tier needs
revisiting. Not auto-enforced in this phase; a log line each cycle reports the call count so
growth is visible before it becomes a problem.

## 7. LLM Synthesis & Report Storage

One `@lhr/llm` call per category synthesizes that cycle's raw findings into a short summary,
explicitly given the site's current content focus (`docs/CONSTITUTION.md` and recent post titles)
so it can flag both "this aligns with what you already cover" and "you don't cover this yet."
The `/status` trends section renders `summary` prominently per category/cycle, with
`raw_findings` available as supporting detail underneath.

## 8. `/status` Page Extensions

Two new render functions in `apps/lhr-office/src/statusPage.ts`, following the page's existing
convention exactly — plain semantic HTML, no `<style>` tag, no classes, matching
`renderCandidateSection`/`renderAffiliateCandidatesSection`:

- `renderTrendsSection(reports)` — grouped by category, latest cycle's summary + date shown
  prominently, older cycles listed below.
- `renderTrendSeedTopicsSection(topics)` — every topic (category, topic, status, times seen) with
  a Promote or Demote button (`<form method="post">`, mirroring the candidates' approve/deny
  buttons), plus one form at the bottom to add a curated topic directly.

Three new routes in `apps/lhr-office/src/server.ts`, matching the existing routes' shape exactly
(`requireStatusAuth` middleware, try/catch → 500 with `escapeHtml` on failure, success →
`res.redirect(303, '/status')`):

```
POST /status/trends/topics/:id/promote
POST /status/trends/topics/:id/demote
POST /status/trends/topics/add          (body: category, topic)
```

Unlike the affiliate-candidates approve/deny routes, these call `packages/db`'s `setTopicStatus`/
`addCuratedTopic` directly against the `db: Queryable` already passed into `createApp` — no
injectable ops interface, since (unlike approving an affiliate candidate) none of these three
actions make an external call of any kind to fake out in tests.

## 9. Error Handling & Edge Cases

- SerpApi failure/rate-limit for a given topic: that topic is skipped (logged via `console.warn`
  with the topic name and error), not fatal to the whole cycle — a partial report (fewer topics)
  still gets synthesized and stored rather than losing the week entirely.
- LLM synthesis call failure: the category's report row is still written with `raw_findings`
  populated and `summary` set to the literal placeholder `"[Summary generation failed this
  cycle]"` — never silently drops the underlying data.
- Duplicate seed-topic insert race (two cycles' candidate upserts overlapping): the `UNIQUE
  (category, topic)` constraint makes this a safe upsert (increment on conflict), not a crash.
- **`JobResult` mapping** (§2 of the shared-orchestrator spec defines the contract; this is
  trends-watcher's specific mapping onto it): all three categories wrote a report with no
  per-topic failures → `status: 'success'`. Any category had a partial (a skipped topic or a
  fallback summary) → `status: 'partial'`. Nothing could be written at all (e.g. `SERPAPI_KEY`
  missing, caught by `requireEnv` before any category starts) → `status: 'failure'`, thrown before
  any category is attempted. `summary` names which categories, if any, were partial and why.
- `SERPAPI_KEY` missing: fails fast via `requireEnv`, same pattern as the other jobs' required env
  vars — the orchestrator records this as a `failure` row, exactly like a missing `KEEPA_API_KEY`
  would for affiliate-sourcing today.

## 10. Testing Approach

- `apps/lhr-office/tests/serpapiTrends.test.ts` — mocked API responses for both
  `fetchInterestAndRelatedQueries` and `fetchTrendingNow`, including a rate-limit/error case and
  the numeric-`value`/malformed-shape logging paths from §4.
- `packages/db/tests/trendSeedTopics.test.ts` — new candidate insert, repeated-suggestion
  increment, promotion at the threshold (and not before), normalization matching
  (case/whitespace), dedup-before-upsert.
- `packages/db/tests/trendsReports.test.ts` — insert/list, JSONB serialization round-trip.
- `packages/llm/tests/*.test.ts` — the existing `openrouter.test.ts` cases (model fallback,
  rate-limit backoff, deadline handling), moved onto `@lhr/llm`'s public `callLLM` entry point.
- `apps/lhr-office/tests/trendsWatcher.test.ts` — integration test (mocked `serpapiTrends` +
  `callLLM` + `@lhr/db` functions): asserts a `trends_reports` row per category is written even
  when one topic's SerpApi call fails (partial, not a crash), the placeholder summary path, the
  suggested-topic dedup-against-curated behavior, and the `JobResult` status mapping from §9.
- `apps/lhr-office/tests/statusPage.test.ts` — extended: the two new render functions produce the
  expected plain HTML (summary text present, Promote/Demote buttons present, add-topic form
  present) for representative report/topic fixtures.
- `apps/lhr-office/tests/server.test.ts` — extended: the three new routes (promote, demote, add),
  each asserting the auth gate (401 without valid Basic Auth), the redirect on success, and a 500
  with an escaped error message on a thrown DB error.
- `apps/lhr-office/tests/registry.test.ts` (relocated from `packages/jobs/tests/registry.test.ts`,
  which is deleted) — the three existing cases unchanged, plus a fourth: `trends-watcher` is
  registered on a 7-day cadence with a callable `run`.

## Out of Scope

- Auto-triggering other agents from trends findings (§1) — human-read input only.
- Notifications/alerting on new reports (§1) — check `/status`.
- Non-Google-Trends data sources (§1).
- A local-LLM backend or availability-based routing in `@lhr/llm` (§1, §2) — the interface is
  designed to accommodate it later; nothing beyond the OpenRouter backend is built now.
- Styling `/status` (§1, §8) — every section on that page, old and new, stays plain unstyled HTML;
  a dedicated future pass covers all four agents' sections at once.
- The shared local orchestrator/scheduler runner, weekly competitor analysis, and product-in-photo
  placement (§1) — separate specs (the orchestrator itself is already built, per the
  shared-orchestrator spec).
