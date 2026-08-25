# Trends Watcher — Design

**Date:** 2026-08-24
**Status:** Draft — third of five sub-projects in a larger automation initiative (recipe variant
generator and affiliate sourcing agent are spec'd/in progress separately; weekly competitor
analysis, product-in-photo placement, and a local orchestrator are separate, later specs)

**Note on shared infrastructure:** while this spec was being brainstormed, the agent implementing
the affiliate sourcing spec independently scaffolded `apps/lhr-office` (server-output Astro via
`@astrojs/vercel`) plus two shared workspace packages: `@lhr/db` (Postgres client, Neon-hosted) and
`@lhr/github` (the GitHub-as-database commit helper extracted from `mcp-server/src/github.ts`).
This spec builds on top of those rather than re-establishing them — this spec's job is to define
the shared app's **admin auth** (§3, used by every route in the app, not just trends) and its own
**trends** feature (§4-§7). `@lhr/github` is not used by this sub-project — trends data lives
entirely in Postgres, nothing is committed to git.

**Amendment (2026-08-25, from the local-orchestrator spec):** §2's "Local weekly cron —
mcp-server/scripts/source-weekly-trends.ts" is superseded on execution model. Scheduling moved to
Vercel Cron Jobs — see `2026-08-25-local-orchestrator-design.md`. The sourcing/synthesis pipeline
must be an exported async function (e.g. `sourceWeeklyTrends()`), not a standalone CLI script —
the orchestrator's Vercel Cron-triggered endpoint imports and calls it directly, in-process.
Everything else (SerpApi sourcing, seed-topic promotion, report storage) is unaffected.

## 1. Overview & Goals

Adds a weekly-refreshed trends report — web design, cooking, and nutrition — sourced from Google
Trends (via SerpApi, since there's no official Google Trends API), synthesized by an LLM into
"what's worth knowing this week," and viewable at `office.loveheatrelationship.com/trends` behind
real admin login. The seed topics driving each category's search aren't a static list the author
maintains forever: an LLM proposes adjacent topics each cycle, and any topic that keeps showing up
gets automatically promoted into the permanent curated list — the concrete mechanism for staying
current without manual upkeep, while an admin can still directly manage the curated list at any
time.

**Primary success criteria:**
- Every week, a new report appears per category (web design, cooking, nutrition) with an LLM
  summary of what's worth knowing, plus the raw signal (rising queries, trending-now items) behind
  it.
- A topic an admin never explicitly added can still show up as a permanent seed once it's proven
  itself across several cycles — the promotion mechanism from §5.
- SerpApi usage stays inside the free tier (~100 searches/month) at the topic caps in §6.
- Report content is admin-only, behind real login — never publicly reachable.

**Explicitly out of scope for this phase:**
- Automatically triggering `content-strategist` or any other agent off trends findings. The report
  is a human-readable input for planning, not a pipeline that writes content on its own.
- Non-Amazon-Associates-adjacent commerce trend data. This is purely Google Trends interest data
  across the three named categories.
- Any notification/alerting (email, Slack, push) when a new report lands — checking the office app
  is the only surface for now.
- Historical trend-report analytics/charting beyond listing past cycles' reports as-is.
- The shared local orchestrator/scheduler runner, weekly competitor analysis, and product-in-photo
  placement — separate specs.

## 2. Architecture & Data Flow

```
Local weekly cron — mcp-server/scripts/source-weekly-trends.ts
  1. Read current `trend_seed_topics` (status='curated') per category from
     @lhr/db, plus recent candidates for context
  2. One OpenRouter LLM call per category: given the curated list + the
     site's niche (docs/CONSTITUTION.md), suggest up to 2 adjacent topics
     to try this cycle (not persisted as curated yet — see §5)
  3. For every curated + suggested topic: SerpApi `google_trends` call
     (interest-over-time + rising related queries)
  4. One SerpApi "trending now" call per category (wildcard layer,
     independent of the seed list — see §6)
  5. Update `trend_seed_topics`: increment times_seen for repeated
     suggested topics, insert new candidates, auto-promote any candidate
     crossing the promotion threshold (§5)
  6. One OpenRouter LLM call per category: synthesize all of this cycle's
     raw data (curated + suggested + wildcard) into a short "what's worth
     knowing" summary, referencing the site's existing content focus
  7. Write one `trends_reports` row per category to Postgres (@lhr/db)

apps/lhr-office (already scaffolded) — this spec adds:
  - Admin auth: office_admins / office_sessions tables, login/logout
    pages, requireAdminSession() helper (§3) used by every route in the
    app, including the affiliate-review routes being built in parallel
  - /trends: lists recent cycles per category, each showing the LLM
    summary + the raw rising-queries/trending-now data behind it
  - /admin: manage admin accounts (§3) and manage curated seed topics
    directly (§5)
```

## 3. Admin Authentication (shared by the whole office app)

Real username/password accounts — chosen specifically because access is being given to
non-technical people unfamiliar with GitHub, and a shared platform password (the originally
considered Vercel Deployment Protection) doesn't give individually-managed accounts.

**Schema** (added to `@lhr/db`):

```sql
CREATE TABLE office_admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,       -- node:crypto scrypt, salt+hash combined
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES office_admins(id)  -- null for the bootstrap admin
);

CREATE TABLE office_sessions (
  id TEXT PRIMARY KEY,               -- random token, stored as the cookie value
  admin_id INTEGER NOT NULL REFERENCES office_admins(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

- **Password hashing**: Node's built-in `crypto.scrypt` — no new dependency, well-vetted KDF.
- **Bootstrap**: `mcp-server/scripts/create-office-admin.ts` (same one-off pattern as
  `backfill-ingredient-links.ts`) — run once, locally, by the author to create the first account
  from CLI args.
- **Adding more admins**: an `/admin` page, reachable only when already logged in — set a
  username/password directly for the new person and share it with them out of band. No
  self-service signup, no email/invite flow (no email infra needed for this phase).
- **Login**: `/login` posts credentials, verifies the scrypt hash, creates an `office_sessions`
  row, sets an httpOnly + secure + `sameSite=lax` cookie holding the session id. 7-day expiry with
  sliding renewal on use.
- **Lockout**: 5 consecutive failed attempts locks the account for 15 minutes
  (`locked_until`); a successful login resets `failed_attempts` to 0.
- **`requireAdminSession()`**: a shared helper (`apps/lhr-office/src/lib/auth.ts`) every route —
  page or API — calls first; no route in this app is reachable without a valid session. This is
  also what the affiliate-review routes (being built in parallel, per the amended sub-project 2
  spec) depend on instead of Vercel Deployment Protection.

## 4. Trends Data Source (SerpApi)

New module `mcp-server/src/serpapiTrends.ts`:

- `fetchInterestAndRelatedQueries(topic, geo='US')` — wraps SerpApi's `google_trends` engine,
  returning interest-over-time direction (rising/falling/flat) and the top + rising related
  queries.
- `fetchTrendingNow(category)` — wraps SerpApi's trending-now/daily-trends engine, filtered as
  closely as the API allows to a category's relevant topics; this is the wildcard layer (§1) that
  finds things no seed list would think to search for.
- Requires a `SERPAPI_KEY` env var (added to `.env.example`).

## 5. Seed Topic Management & Promotion

New table (added to `@lhr/db`):

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
```

- **Curated rows** are used as permanent base seeds every cycle (§2 step 1).
- Each cycle's LLM-suggested topics (§2 step 2) are matched against existing rows by
  `(category, normalized topic)` — reusing the same normalization spirit as
  `normalizeIngredient.ts` (lowercase, trim, no fuzzy semantic matching). A match increments
  `times_seen`/`last_seen_at`; no match inserts a new `status='candidate'` row.
- **Promotion**: a candidate crossing **`times_seen >= 3`** (three separate cycles, not three
  mentions in one cycle — the increment only happens once per cycle's suggestion pass) flips to
  `status='curated'` and sets `promoted_at`. This is the concrete "shows up enough times, gets
  added to the curated list" mechanism from the brainstorm.
- Admins can also directly promote, demote, or add a curated topic via the `/admin` page —
  automatic promotion is a convenience, not the only path.

## 6. Budget Cap

To stay inside SerpApi's ~100 searches/month free tier: curated seeds are expected to settle
around 4-5 per category; the LLM adds up to 2 candidate suggestions per category per cycle
(§2 step 2); that's up to ~7 topic calls/category × 3 categories = 21, plus 3 trending-now calls =
24 calls/week ≈ 104/month at the high end. This is called out explicitly as a cap to watch —
if the curated lists grow past ~5/category as promotions accumulate, either the LLM-suggestion
count or the SerpApi tier needs revisiting. Not auto-enforced in this phase; a log line each cycle
reports the call count so it's visible before it becomes a problem.

## 7. LLM Synthesis & Report Storage

```sql
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

One OpenRouter LLM call per category (default free model, configurable via env var, consistent
with the other two sub-projects) synthesizes that cycle's raw findings into a short summary,
explicitly given the site's current content focus (from `docs/CONSTITUTION.md` and recent post
categories) so it can flag both "this aligns with what you already cover" and "you don't cover
this yet." `/trends` renders `summary` prominently per category/cycle, with `raw_findings`
available as supporting detail underneath.

## 8. Error Handling & Edge Cases

- SerpApi failure/rate-limit for a given topic: that topic is skipped (logged), not fatal to the
  whole cycle — a partial report (fewer topics) still gets synthesized and stored rather than
  losing the week entirely.
- LLM synthesis call failure: report row is still written with `raw_findings` populated and
  `summary` set to a placeholder (`"[Summary generation failed this cycle]"`) — never silently
  drops the underlying data.
- Duplicate seed-topic insert race (two cycles' candidate upserts overlapping): the `UNIQUE
  (category, topic)` constraint makes this a safe upsert (increment on conflict), not a crash.
- Login lockout expiry: `locked_until` in the past is treated as unlocked — no separate cleanup
  job needed.
- Session expired or missing: `requireAdminSession()` redirects to `/login`, never renders
  protected content on a failed check.

## 9. Testing Approach

- `serpapiTrends.test.ts` — mocked API responses for both `fetchInterestAndRelatedQueries` and
  `fetchTrendingNow`, including an error/rate-limit case.
- Seed-topic promotion unit tests: new candidate insert, repeated-suggestion increment, promotion
  at the threshold (and not before), normalization matching (case/whitespace).
- Auth unit tests: password hash verify (correct/incorrect), lockout after 5 failures and reset on
  success, session creation/expiry, `requireAdminSession()` redirect behavior on missing/expired
  session.
- Integration test for `source-weekly-trends.ts`: mocked SerpApi + OpenRouter, asserts a
  `trends_reports` row per category is written even when one topic's SerpApi call fails (partial
  report, not a crash).
- Page-level test for `/trends` (auth-gated, renders report content) and `/admin` (seed topic
  list, promote/demote actions, admin account creation).

## Out of Scope

- Auto-triggering other agents from trends findings (§1) — human-read input only.
- Notifications/alerting on new reports (§1) — check the office app.
- Non-Google-Trends data sources (§1).
- The shared local orchestrator, weekly competitor analysis, and product-in-photo placement
  (§1) — separate specs.
