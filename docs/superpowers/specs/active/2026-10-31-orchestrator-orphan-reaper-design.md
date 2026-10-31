# Orchestrator orphan reaper

**Status:** approved  
**Date:** 2026-10-31  
**Related:** `2026-08-25-shared-orchestrator-design.md` (overlap guard treats `running` older than 10 minutes as stale, but never rewrites the row)

## Problem

`orchestrator_runs` inserts `status='running'` at job start and only updates to a terminal status when the Node process calls `finishRun` / `failRun`. If the process dies mid-job (local Ctrl+C, `tsx watch` restart, Vercel kill), the row stays `running` forever. Agents & Jobs polls that table and shows a permanent “running” line even when Airlie LLM sub-jobs already finished. The overlap guard already ignores runs older than 10 minutes, so cadence is fine — only history/UI is wrong.

## Decision

**Approach A:** Reap stale `running` rows to `failure` with a fixed orphan message.  
**Deferred (B):** Heartbeats / `heartbeat_at` — revisit only if healthy jobs regularly exceed the 10-minute window.

## Behavior

- A row is orphaned when `status = 'running'` and `started_at` is older than **10 minutes** (same threshold as the existing overlap window).
- Reaping updates in place: `status = 'failure'`, `error_message = 'orphaned: process exited before finish'`, `finished_at = now()`.
- Recent `running` rows (< 10 minutes) are left alone.
- Terminal rows are untouched.

## Call sites

1. **Shared helper** in `@lhr/db`: `reapOrphanedRunningRuns(db, olderThanMs)` → number of rows reaped.
2. **Stale threshold** exported once from `@lhr/db` (e.g. `ORCHESTRATOR_STALE_RUNNING_MS = 10 * 60 * 1000`) and used by both the reaper and `getRecentRunning` callers in `orchestrate.ts` so the two never drift.
3. **Due-job / run-now path** in `apps/lhr-office/src/orchestrate.ts`: call the reaper at the start of `runDueJob` and `runJobNow` (before overlap check / work).
4. **Process entrypoints**: call the reaper on boot in `scripts/dev.ts` and on module load in `api/index.ts` (Vercel cold start), so the UI clears orphans without waiting for cron or a manual run.

## One-shot cleanup

Existing orphans (including competitor-analysis #82 and older August `running` rows) are cleaned by the same helper — no separate migration. First boot/cron after deploy is enough; optionally run the helper once against prod during rollout.

## Out of scope

- Heartbeats, job wall-clock timeouts, Airlie hub changes, UI copy beyond reflecting the reaped `failure` row.

## Tests

- `@lhr/db`: reaper SQL/args; only old `running` rows; returns count.
- `orchestrate`: reaper invoked before overlap / insert on both `runDueJob` and `runJobNow`.
