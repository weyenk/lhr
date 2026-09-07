# lhr-office Admin SPA — Design

**Date:** 2026-09-07

**Prior art:** an earlier attempt at real multi-admin auth for `apps/lhr-office` (`office_admins`/
`office_sessions` tables, a standalone Astro rewrite) was built and abandoned — its PR was closed
unmerged in favor of the single shared HTTP Basic Auth credential that's live today (see the
2026-09-06 trends-watcher and competitor-analysis designs). This spec avoids the reasons that one
stalled: it does not hand-roll account/session tables (Supabase Auth, already-provisioned
infrastructure for this project's Postgres, owns user identity) and it does not rewrite the app off
Express (the SPA is additive to the existing Express server, not a framework swap).

## 1. Overview & Goals

`apps/lhr-office` today is a single Express serverless function rendering one long, unstyled HTML
page (`/status`, `statusPage.ts`) gated by a shared HTTP Basic Auth credential
(`STATUS_AUTH_USER`/`STATUS_AUTH_PASSWORD`). It covers four automation agents' human-in-the-loop
surfaces (recipe candidates, affiliate candidates, trend topics, competitor tracking/SEO keywords)
plus job run history, all as one scrolling page with plain HTML forms.

This spec replaces that with a proper single-page admin app: a styled, sidebar-navigated dashboard
with real per-user authentication, live-updating job status, and a JSON API behind it — while
keeping every existing piece of business logic (`orchestrate.ts`, `competitorAnalysis.ts`,
`trendsWatcher.ts`, the `@lhr/db`/`@lhr/jobs` contracts) completely untouched.

**Primary success criteria:**
- The author can sign in with a real account (not a shared password) and see a live-updating view
  of what the site's agents are doing, without needing to memorize which of four sections has what
  she's waiting on.
- Every action currently possible on `/status` (approve/reroll/deny/promote/demote/run-now/add/
  remove) is possible in the new dashboard, with no loss of capability.
- Adding a second admin later requires zero application code changes — inviting a user in the
  Supabase dashboard is sufficient.
- The author can click through a real Vercel preview deployment of the whole flow (login through
  every view) before merging to `main` — not just a passing test suite.

**Explicitly out of scope for this phase:**
- Role/permission tiers (viewer vs. admin, etc.) — every signed-in user gets identical full access;
  explicitly confirmed with the author as not needed yet.
- Any change to the underlying job/orchestrator logic, the `@lhr/db`/`@lhr/jobs` contracts, or the
  cron endpoint (`/api/cron/orchestrator`) — this is a presentation- and auth-layer rework only.
- Browser/e2e test automation — component/unit-level client tests only this phase (see §6).
- Self-service sign-up — accounts are created for admins directly in the Supabase dashboard.

## 2. Information Architecture

A sidebar of panels, replacing the single scrolling page. The site already adds new automation
agents regularly (recipe generator, affiliate sourcing, trends watcher, competitor analysis — with
a 5th agent's admin surface being built as of this spec, and more expected), so the sidebar is
driven by a **panel registry** rather than a fixed, hardcoded set of views: a single ordered list of
`{ id, label, icon, route, component }` entries that both the sidebar nav and the client router are
generated from. Adding a new panel means adding one entry to that list and writing its page
component — no changes to the sidebar, router, or layout code itself.

**Initial panels:**

- **Overview** — landing view: one status card per registered job (last run status, when it ran,
  next due), badge counts for anything awaiting a decision across the other panels, and a recent-run
  activity feed. No dedicated endpoint: this view fetches the same `/api/jobs`,
  `/api/candidates/recipe`, `/api/candidates/affiliate`, and `/api/competitors` responses the other
  panels use, and derives its counts/feed client-side (job run history is already timestamped, so
  the activity feed is that history merged across jobs and sorted).
- **Approvals** — the human-in-the-loop inbox: pending recipe candidate (approve/reroll), affiliate
  candidates (approve/deny), competitor candidates (approve/reject). One queue for everything
  needing a yes/no.
- **Agents & Jobs** — the job registry and full run history per job, plus a manual "run now"
  trigger. The "manage our agents" surface.
- **Research** — trend reports and seed-topic promote/demote, tracked competitors and their latest
  reports, SEO keyword add/remove. Lower-urgency browsing/management, kept separate from the
  Approvals inbox.

**Adding a panel or a source, going forward:** a new agent whose human-in-the-loop surface is just
another kind of yes/no decision (like the three candidate types already sharing Approvals today)
should extend the existing **Approvals** panel with a new candidate-card type, not create a new
sidebar entry — that's the same pattern the current three candidate types already follow. A new
panel is only warranted when the new agent's data doesn't fit any existing panel's shape (as
Overview/Approvals/Agents & Jobs/Research don't today) — in that case it's a new registry entry plus
its own `GET`/mutation routes (see §4's routing note), following the same shape as any panel here.
Either path is additive: no existing panel, route, or component needs to change to accommodate it.

## 3. Visual Design — "Slate Console"

Utility-first but sleek: a dark, blue-gray "control room" aesthetic (closer to Grafana/terminal
tooling than the consumer food-blog brand in `docs/BRAND.md`, which this deliberately diverges
from).

- Background: `#151B23`; sidebar/panel surfaces: `#1B2430`; borders: `#2A3542`.
- Primary accent (nav highlight, primary actions, focus states): `#3FC7E0` (cyan).
- Semantic states: warning `#E0B93F` (amber), success `#4CAF7D` (muted green), error `#E0574F`
  (muted red).
- Typography: system sans stack (`-apple-system, "Segoe UI", sans-serif`) for UI text; a monospace
  stack (`ui-monospace, "SF Mono", Menlo, monospace`) for data-dense content — timestamps, run
  summaries, job/candidate IDs — to reinforce the "control room" read. No custom web fonts.
- Spacing: 8px base unit (8/16/24/32/48/64), matching the general scale convention used elsewhere
  in this repo, defined fresh for this app rather than importing `docs/BRAND.md`'s tokens.

## 4. Architecture & Data Flow

```
apps/lhr-office/
  client/                 — new: Vite + React + TypeScript SPA
    src/
      main.tsx, App.tsx   — router + auth gate; both generated from panels/index.ts
      panels/index.ts     — the panel registry ({ id, label, icon, route, component }[])
      lib/supabase.ts     — Supabase client (anon key)
      lib/api.ts          — typed fetch wrapper, attaches bearer token
      pages/              — Overview, Approvals, AgentsAndJobs, Research — one per panel
      components/         — Sidebar, StatusBadge, etc.
      hooks/usePolling.ts — interval-based refresh for job status
  src/
    server.ts             — existing Express app; mounts one router per resource area
    routes/                — new: jobs.ts, candidates.ts, trends.ts, competitors.ts — one
                              Express Router module per resource area, each mounted in server.ts
                              under its own path prefix (e.g. app.use('/api/jobs', jobsRouter))
    authMiddleware.ts      — new: requireSupabaseAuth (replaces requireStatusAuth)
    statusPage.ts          — deleted; HTML rendering no longer needed
```

- The client build (`vite build`) is served as static files by the *same* Express app
  (`express.static` + an SPA fallback that serves `client/dist/index.html` for any unmatched
  non-API GET route, so client-side routes survive a hard refresh). One deployable function — no
  change to the Vercel project shape or `vercel.json`'s rewrite-everything-to-`/api` setup.
  `scripts/bundle.mjs` gains a `vite build` step alongside its existing `esbuild` calls.
- The static shell (`index.html` + JS/CSS assets) is served without a server-side gate — it's just
  UI code, no data. Every data-bearing response comes from the JSON API, which *is* gated. The
  client shows a login screen whenever it has no valid Supabase session; no protected data is ever
  requested without one.
- `/health` and `/api/cron/orchestrator` (bearer-secret protected, unrelated to admin auth) are
  unchanged.

### API endpoints

Every `/status/*` route is replaced by a JSON equivalent under `/api/*`, gated by
`requireSupabaseAuth`. New GET endpoints are added since `/status` previously rendered everything
server-side in one pass; each view now fetches only what it needs.

| Old (removed) | New |
|---|---|
| `GET /status` | `GET /api/jobs`, `GET /api/candidates/recipe`, `GET /api/candidates/affiliate`, `GET /api/trends`, `GET /api/competitors`, `GET /api/competitors/keywords` |
| `POST /status/run/:jobName` | `POST /api/jobs/:jobName/run` |
| `POST /status/candidate/:id/approve` | `POST /api/candidates/recipe/:id/approve` |
| `POST /status/candidate/:id/reroll` | `POST /api/candidates/recipe/:id/reroll` |
| `POST /status/affiliate-candidates/:id/approve` | `POST /api/candidates/affiliate/:id/approve` |
| `POST /status/affiliate-candidates/:id/deny` | `POST /api/candidates/affiliate/:id/deny` |
| `POST /status/trends/topics/:id/promote` | `POST /api/trends/topics/:id/promote` |
| `POST /status/trends/topics/:id/demote` | `POST /api/trends/topics/:id/demote` |
| `POST /status/trends/topics/add` | `POST /api/trends/topics` |
| `POST /status/competitors/:id/approve` | `POST /api/competitors/:id/approve` |
| `POST /status/competitors/:id/reject` | `POST /api/competitors/:id/reject` |
| `POST /status/competitors/keywords/add` | `POST /api/competitors/keywords` |
| `POST /status/competitors/keywords/:id/remove` | `DELETE /api/competitors/keywords/:id` |

Each resource area's routes (jobs, candidates, trends, competitors) live in their own router module
under `src/routes/`, mounted onto the app under a path prefix in `server.ts`, rather than as inline
handlers in one growing file as today. Adding a new source's endpoints later — whether it's a new
candidate type folded into the existing `/api/candidates` router or a wholly new resource area — is
then one new (or extended) router module plus one `app.use(...)` line, not an edit to a monolith.

Every mutation returns the updated resource (or `{ ok: true }`) as JSON with a 2xx status instead
of a 303 redirect; every failure returns `{ error: string }` with the same status codes the current
handlers already use (404 for unknown job, 500 for a thrown error, etc.) — `escapeHtml` and
HTML-string error bodies go away with `statusPage.ts`.

### Live updates

- Agents & Jobs, and Overview's job-health strip, poll their endpoint every 5 seconds while
  mounted; the interval is cleared on unmount. Every other view fetches on mount/navigation only —
  no polling for approvals or research data, which don't change on their own.
- Mutations (approve/reject/run-now/etc.) POST, then refetch that view's data. No optimistic-update
  layer — this is a single-digit-user internal tool; simplicity wins over perceived snappiness.

## 5. Authentication

- No login endpoint on our server. The SPA talks to Supabase Auth directly via
  `@supabase/supabase-js` (public anon key) for the login screen (a dedicated `/login` route, not
  just an inline gate) and session/token management — sign-in, refresh, sign-out all handled by the
  SDK.
- `lib/api.ts` reads the current access token from the Supabase client before every request and
  sends it as `Authorization: Bearer <token>`.
- New Express middleware, `requireSupabaseAuth`, replaces `requireStatusAuth` on every `/api/*`
  route (except `/api/cron/orchestrator`, which keeps its own bearer-secret check). It verifies the
  JWT's signature and expiry locally against `SUPABASE_JWT_SECRET` (HS256) — no network round-trip
  to Supabase per request, which matters given the 5-second polling load.
- **Access model:** flat — any user with a valid Supabase-issued token for this project has full
  access, identical to every other signed-in user. No roles, no per-user permission checks. Adding
  a second admin later means inviting them as a user in the Supabase dashboard; no code change.
  (Confirmed explicitly with the author as sufficient for now — see §1.)
- A 401 from any API call clears local client state and redirects to `/login` (covers both an
  invalid token and a session that expired mid-session).

### New/changed environment variables

- Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (client-exposed by Vite's `VITE_` prefix
  convention; safe to expose — this is the anon/publishable key, not the service role key).
- `SUPABASE_JWT_SECRET` already exists in `apps/lhr-office`'s env files (server-only, used by the
  new middleware) — no new secret to provision.
- Remove `STATUS_AUTH_USER`, `STATUS_AUTH_PASSWORD` once the new middleware is live everywhere.
- These need to be set on the Vercel project's Preview environment (not just Production) for the
  pre-merge verification pass in §7 to work.

## 6. Error Handling & Testing

- **Error handling:** API errors return `{ error: string }`; the client shows an inline banner
  scoped to the current view rather than crashing, with one root React error boundary as a last
  resort. Polling failures retry silently on the next tick — a banner only appears after a few
  consecutive failures, so one dropped request doesn't flash an error every 5 seconds.
- **Server tests:** `tests/server.test.ts` (and `tests/statusPage.test.ts`, which gets deleted along
  with `statusPage.ts`) get updated from HTML/redirect assertions to JSON-response assertions,
  following the existing mocking pattern (`vi.mock('@lhr/db', ...)` etc.). New tests cover
  `requireSupabaseAuth`: valid token, expired token, malformed token, missing header.
- **Client tests:** component/hook-level tests with `@testing-library/react` + the existing vitest
  setup (`environmentMatchGlobs` pointed at `client/**` for `jsdom`, rather than a second vitest
  project) — covering the login gate, the polling hook's interval/cleanup behavior, and the API
  wrapper's 401-redirect behavior. No browser/e2e automation this phase (§1).

## 7. Verification Before Merge

This work happens on a branch/PR rather than direct-to-`main`, so Vercel's existing per-branch
preview deployment for the `lhr-office` project gives a real, clickable preview URL. Before
merging:

1. `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` must be set on the
   Preview environment in Vercel (one-time manual setup).
2. At least one user must exist in Supabase Auth for this project (created directly in the Supabase
   dashboard) to sign in with.
3. The author clicks through the preview: sign in, all four views load real data, the Agents & Jobs
   view visibly live-updates, and at least one action in each of Approvals/Agents & Jobs/Research
   round-trips correctly.

No autonomous merge — this is a manual go/no-go by the author on the preview, same posture as every
other change in this repo (Constitution #1).
