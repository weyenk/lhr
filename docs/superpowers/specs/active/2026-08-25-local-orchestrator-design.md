# Shared Orchestrator — Design

**Date:** 2026-08-25
**Status:** Draft — final piece of the automation initiative. Ties together all five previously
spec'd agents (recipe variant generator, affiliate sourcing, trends watcher, competitor analysis,
product-in-photo placement), each amended the same day to match the execution model defined here.

**Naming note:** originally conceived as a "local orchestrator" (a script run via the author's own
cron/launchd). That changed during brainstorming: the author wants scheduling that doesn't depend
on her personal Mac being on, and this repo is already fully Vercel-hosted, so this spec uses
Vercel Cron Jobs instead. Kept as "orchestrator" in the title since the role is the same — this
doc is the spec for *what schedules and runs the five agents*, wherever that turns out to run.

## 1. Overview & Goals

Each of the five agent specs defines its own pipeline as an exported async function (per the
amendments landed alongside this spec) rather than a standalone script. This spec defines the one
thing that actually calls them on a schedule: a Vercel Cron-triggered endpoint in `apps/lhr-office`
that checks which jobs are due and runs (at most) one per invocation, recording results so their
health is visible without digging through logs.

**Primary success criteria:**
- All five agents run automatically on a roughly-weekly cadence with no dependency on any specific
  machine being powered on.
- A missed day (Vercel having a bad day, a due-check window closing) doesn't permanently skip a
  job — it just runs next time the daily check fires and finds it still overdue.
- `office.loveheatrelationship.com/status` shows, at a glance, whether each of the five agents is
  healthy and when it last ran successfully.
- Adding a sixth agent later is registering one more entry, not building new scheduling
  infrastructure.

**Explicitly out of scope for this phase:**
- Real-time/sub-daily scheduling — a daily due-check is frequent enough for weekly-cadence jobs.
- Alerting/notifications on failure (email, Slack, push) — consistent with the rest of this
  initiative's "check the office app" posture (per the trends-watcher spec's explicit decision).
- Parallel execution of multiple due jobs in one invocation — deliberately one-at-a-time, see §3.
- Retrying a failed job automatically within the same day — a failure is visible on `/status` and
  picked up again on the next due-check where it's still overdue; no separate retry-with-backoff
  logic in this phase.

## 2. Job Contract & Registry

New shared workspace package `packages/jobs` (`@lhr/jobs`):

```ts
// packages/jobs/src/types.ts
export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;                     // short human-readable outcome, shown on /status
  details?: Record<string, unknown>;   // optional structured info (counts, ids, etc.)
}

export type Job = () => Promise<JobResult>;

export interface JobRegistration {
  name: string;
  cadenceDays: number;
  run: Job;
}
```

```ts
// packages/jobs/src/registry.ts
export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates },
  { name: 'trends-watcher', cadenceDays: 7, run: sourceWeeklyTrends },
  { name: 'competitor-analysis', cadenceDays: 7, run: analyzeCompetitors },
  { name: 'product-placement', cadenceDays: 7, run: matchProductsToRecipes },
];
```

Each pipeline's actual logic stays wherever its own spec put it (Keepa client, substitution
engine, SerpApi client, etc.); the exported function named in each amendment is the single entry
point this registry references. Exact internal file/module organization for each pipeline is an
implementation-plan concern, not fixed by this spec.

## 3. Trigger & Execution Model

- **Vercel Cron** hits `POST /api/cron/orchestrator` in `apps/lhr-office`, once daily (schedule
  configured in that app's `vercel.ts`, e.g. `crons: [{ path: '/api/cron/orchestrator', schedule:
  '0 13 * * *' }]` — a fixed daily UTC time, adjustable).
- **Auth**: the endpoint checks the request's authorization header against a `CRON_SECRET` env var
  (Vercel's documented convention for protecting cron endpoints) — rejects with 401 if missing or
  wrong, so it can't be triggered by an arbitrary public request.
- **Due-check, not fixed-day scheduling**: for each registered job, query `orchestrator_runs` (§4)
  for its most recent `status='success'` row. Due if none exists, or its `finished_at` is
  `>= cadenceDays` old. This is deliberately resilient to a missed day rather than assuming exact
  calendar-day firing.
- **One due job per invocation** — whichever is *most* overdue, not all of them. Rationale: on
  first-ever setup all five jobs are simultaneously "due" (no prior success rows), and running all
  five sequentially in one request risks exceeding Vercel's function timeout (300s default). A
  daily due-check naturally drains this backlog over the following days without needing batching,
  parallel execution, or a background-job queue.
- **Overlap guard**: before starting, check for a `status='running'` row for that job created
  within the last 10 minutes (well past any single job's realistic duration under the 300s
  timeout) — if found, skip this invocation rather than risk a double-run. A `running` row older
  than that is treated as crashed/stale and doesn't block a new attempt.
- **Manual override**: `/status` in `apps/lhr-office` has a "run now" button per job, calling a
  separate protected endpoint that invokes that job's function directly, bypassing the due-check —
  for testing and for triggering something ahead of its normal cadence.

## 4. Data Model (added to `@lhr/db`)

```sql
CREATE TABLE orchestrator_runs (
  id SERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'running' | 'success' | 'partial' | 'failure'
  summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
```

A `running` row is inserted at start; updated in place to `success`/`partial`/`failure` with the
job's `JobResult` (or a caught exception's message) at completion. `/status` renders, per job, its
most recent row plus a short recent-history list.

## 5. Error Handling & Edge Cases

- A job function throws an uncaught exception: the orchestrator catches it at the call site,
  records `status='failure'` with the error message, and returns normally (HTTP 200) — a thrown
  error inside one job never crashes the endpoint or is mistaken by Vercel for an infra failure.
- `CRON_SECRET` missing/mismatched: 401, no job runs, no `orchestrator_runs` row written (never
  attempted).
- No job is due: endpoint returns quickly with "nothing due" — cheap enough to fire daily
  indefinitely even when there's nothing to do.
- Overlap guard trips (recent `running` row for that job): endpoint returns "already in progress,
  skipped" rather than starting a second concurrent attempt.
- A job's own `JobResult.status` is `'partial'` (e.g. the recipe-variant pipeline flagged some
  diets as "couldn't generate," per that spec's own error handling): still counts as a completed,
  due-clearing run — `'partial'` is not the same as `'failure'` for due-check purposes, since the
  job did productive work and shouldn't be retried the same day.

## 6. Testing Approach

- Due-check unit tests: no prior success → due; recent success → not due; success older than
  `cadenceDays` → due; recent `running` row → overlap-skipped.
- "Most overdue first" selection test, given multiple simultaneously-due jobs.
- Endpoint auth test: missing/wrong `CRON_SECRET` → 401, no job invoked.
- Uncaught-exception handling test: a job that throws still produces a `failure` row and a normal
  endpoint response, not a 500.
- `/status` page test: renders run history per job, "run now" invokes the correct job directly and
  bypasses the due-check.
- Registry shape test: every entry has a valid `name`/`cadenceDays`/callable `run`.

## 7. Operational Setup (documentation, not code)

A new section in `docs/DEPLOYMENT.md` (or a dedicated doc) covering: setting all required env vars
(`DATABASE_URL`, `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `KEEPA_API_KEY`, `SERPAPI_KEY`,
`CRON_SECRET`, and the image-edit provider's key) once on the `apps/lhr-office` Vercel project,
and confirming the Vercel Cron schedule is enabled for that project — the same one-time manual
setup pattern the rest of this site's deployment already follows.

## Out of Scope

- Sub-daily scheduling, alerting/notifications, parallel multi-job execution per invocation, and
  automatic same-day retry (§1) — all deliberately deferred; the daily due-check model is simple
  and sufficient for five weekly-cadence jobs.
- A sixth (or later) agent's own pipeline design — only registering it here once it has its own
  spec.
