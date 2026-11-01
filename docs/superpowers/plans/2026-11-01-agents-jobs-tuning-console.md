# Agents & Jobs Tuning Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Agents & Jobs page with B′ — Chains (gated pipelines) + Jobs rail with Runs/Tune (editable cadence + prose), deep-links to Approvals/Research, no Studio block.

**Architecture:** Persist per-job `cadence_days` overrides and `prose_overrides` JSONB in `@lhr/db`. Jobs API returns effective cadence + prose catalog; PATCH saves tuning. Orchestrator merges cadence overrides before due-check. Job runners resolve prose via a small helper falling back to code defaults. Chains UI derives stage state from `GET /api/sourced-products/cycle` + job histories (client-side).

**Tech Stack:** Express + `@lhr/db` Postgres, React SPA in `apps/lhr-office/client`, Vitest, mockup `docs/mockups/agents-jobs-concepts.html`.

**Reference mockup:** `docs/mockups/agents-jobs-concepts.html` (B′).

## Global Constraints

- No autonomous publish; Approvals remain the human gate surface.
- Remove Studio (Mac) from Agents & Jobs UI/tests (bridge API may remain mounted).
- Rebuild client assets after UI changes: `node apps/lhr-office/scripts/generateClientAssets.mjs`.
- Apply new SQL via `schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`).
- Do not commit unless asked.

---

## File map

| File | Role |
|------|------|
| `packages/db/src/schema.sql` | `job_tuning` table |
| `packages/db/src/jobTuning.ts` | get/upsert/list tuning rows |
| `packages/db/src/index.ts` | re-export |
| `packages/db/tests/jobTuning.test.ts` | DB unit tests |
| `apps/lhr-office/src/jobProseCatalog.ts` | default prose entries per job |
| `apps/lhr-office/src/resolveJobTuning.ts` | effective cadence + prose from DB |
| `apps/lhr-office/src/routes/jobs.ts` | GET enriched + PATCH `/:jobName/tuning` |
| `apps/lhr-office/src/orchestrate.ts` | merge cadence overrides in `runDueJob` |
| `apps/lhr-office/src/trendsWatcher.ts` (+ competitor / productSourcing as needed) | read prose overrides |
| `apps/lhr-office/client/src/lib/jobChains.ts` | pure chain stage derivation |
| `apps/lhr-office/client/src/pages/AgentsAndJobs.tsx` | B′ UI |
| `apps/lhr-office/client/src/theme.css` | workshop + chain styles |
| `apps/lhr-office/client/src/lib/types.ts` | JobStatusRow + tuning types |
| `apps/lhr-office/client/src/pages/AgentsAndJobs.test.tsx` | UI tests |
| `apps/lhr-office/tests/routes/jobs.test.ts` | API tests |

---

### Task 1: DB `job_tuning`

- [ ] Append table to `schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS job_tuning (
  job_name TEXT PRIMARY KEY,
  cadence_days INTEGER,
  prose_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE job_tuning ENABLE ROW LEVEL SECURITY;
```
- [ ] Implement `getJobTuning`, `listJobTuning`, `upsertJobTuning` in `jobTuning.ts`
- [ ] Tests with mock `Queryable`
- [ ] Export from `index.ts`

### Task 2: Prose catalog + resolve helpers

- [ ] `jobProseCatalog.ts`: for each registered job, list `{ id, title, source: 'inline'|'repo', editable, defaultText, note? }`
- [ ] `resolveJobTuning.ts`: `effectiveCadence(db, registry)`, `resolveProse(db, jobName, key, fallback)`
- [ ] Unit tests for merge behavior

### Task 3: Jobs API + orchestrator

- [ ] `GET /api/jobs` includes `defaultCadenceDays`, `cadenceDays` (effective), `prose: [{id,title,source,editable,text,note?}]`, `history`
- [ ] `PATCH /api/jobs/:jobName/tuning` body `{ cadenceDays?: number, prose?: Record<string,string> }` — only editable keys; 404 unknown job
- [ ] `runDueJob` uses effective cadences from DB
- [ ] Route tests

### Task 4: Wire prose into runners (office jobs)

- [ ] trends-watcher: suggest persona + summary template from overrides
- [ ] competitor-analysis: decision + weekly + monetization + design personas
- [ ] product-sourcing *Job.ts: inline `buildPrompt` strings via resolve (repo personas stay read-only in UI)
- [ ] Tests that callLLM/prompt contains override when DB has it (mock)

### Task 5: Client chain helper + UI

- [ ] `jobChains.ts` — product-sourcing stages/gates from cycle status; recipe soft chain; research siblings
- [ ] Rewrite `AgentsAndJobs.tsx` per mockup: page tabs Chains|Jobs; job groups; Runs|Tune; save PATCH; links to `/approvals` and `/research`
- [ ] Remove Studio section
- [ ] CSS under `.agents-jobs-workshop`
- [ ] Update `AgentsAndJobs.test.tsx`
- [ ] Rebuild client assets

### Task 6: Verify

- [ ] `npm test --workspace=@lhr/db`
- [ ] `npm test --workspace=lhr-office`
- [ ] `npm run build --workspace=lhr-office`
- [ ] Apply schema to local office DB if `.env` has `DATABASE_URL`
