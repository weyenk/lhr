# Orchestrator Orphan Reaper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark stale `orchestrator_runs` with `status='running'` as `failure` so Agents & Jobs never shows permanent “running” after process death.

**Architecture:** Add `reapOrphanedRunningRuns` + shared stale-ms constant in `@lhr/db`; call from orchestrate (due + run-now) and office entrypoints (dev + Vercel).

**Tech Stack:** TypeScript, Vitest, `@lhr/db` / `apps/lhr-office`, existing `orchestrator_runs` table.

## Global Constraints

- Orphan message exact string: `orphaned: process exited before finish`
- Stale threshold: 10 minutes (`10 * 60 * 1000`), shared with overlap guard
- Mark as `failure` (not delete / not partial)
- No heartbeats in this plan

---

### Task 1: `@lhr/db` reaper helper

**Files:**
- Modify: `packages/db/src/orchestratorRuns.ts`
- Modify: `packages/db/tests/orchestratorRuns.test.ts`

- [ ] Write failing tests for `reapOrphanedRunningRuns` (UPDATE older running → failure; pass cutoff + message; return row count)
- [ ] Export `ORCHESTRATOR_STALE_RUNNING_MS` and implement the helper
- [ ] Run `npm test --workspace=@lhr/db`
- [ ] Commit

### Task 2: Wire orchestrate + entrypoints

**Files:**
- Modify: `apps/lhr-office/src/orchestrate.ts`
- Modify: `apps/lhr-office/tests/orchestrate.test.ts`
- Modify: `apps/lhr-office/scripts/dev.ts`
- Modify: `apps/lhr-office/api/index.ts`

- [ ] Mock/assert reaper called at start of `runDueJob` and `runJobNow`; use shared stale-ms for `getRecentRunning`
- [ ] Call reaper on boot in `dev.ts` and module load in `api/index.ts`
- [ ] Run `npm test --workspace=lhr-office` (orchestrate + related)
- [ ] Commit

### Task 3: Clear existing orphans

- [ ] Run `reapOrphanedRunningRuns` once against lhr-office DB (or equivalent SQL) so #82 and August rows flip to failure
- [ ] Confirm Agents & Jobs no longer shows those as running
