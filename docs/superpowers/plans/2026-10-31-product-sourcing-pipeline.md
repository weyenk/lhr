# Product Sourcing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-job Chinese wholesale product-sourcing pipeline to `apps/lhr-office` (criteria → search → monetize → brand) with human green-lights on Approvals and a configurable `strict`/`trust` gating profile.

**Architecture:** New Postgres tables in `@lhr/db` hold cycles and candidates. Four `@lhr/jobs` registrations in `apps/lhr-office` run LLM personas from `.claude/agents/*.md` (via GitHub + `@lhr/llm`, same as trends-watcher) and SerpAPI site searches. Gate actions live on `/api/sourced-products/*` and a new Approvals section; profile is an env snapshot per cycle so A→B migration is a config flip, not a rewrite.

**Tech Stack:** TypeScript, Vitest, `@lhr/db` / `@lhr/jobs` / `@lhr/llm`, Express + React SPA in `apps/lhr-office`, SerpAPI (`fetchSearchResults`), Octokit helpers from `lhr-authoring-mcp-server/dist-lib/github.js`.

**Spec:** [docs/superpowers/specs/active/2026-10-31-product-sourcing-pipeline-design.md](../specs/active/2026-10-31-product-sourcing-pipeline-design.md)

## Global Constraints

- **No Amazon affiliate / Keepa** in this pipeline; do not register `affiliate-sourcing`.
- **Final Approve/Deny = decision only** — no Shopify write, no `src/content/products` commit.
- **Gating profile:** env `PRODUCT_SOURCING_GATING_PROFILE` = `strict` | `trust` (default `strict` if unset/invalid). Snapshotted onto each cycle at create time; never mutate mid-cycle.
- **Gate matrix:** after criteria — pause in `strict`, auto in `trust`; after search (pick products) — always pause; after monetize — pause in `strict`, auto in `trust`; final Approvals — always pause.
- **Cadence:** `product-sourcing-criteria` `cadenceDays: 7`; `product-sourcing-search`, `product-sourcing-monetize`, `product-sourcing-brand` each `cadenceDays: 1` (daily cron picks up work after gates clear, same idea as `recipe-variant-finisher`).
- **SerpAPI caps per search job run:** max **6** queries, **8** organic results per query; default platforms `alibaba.com` and `dhgate.com` unless criteria JSON lists others.
- **Blocked-not-ready jobs** return `JobResult` `{ status: 'success', summary: 'blocked: waiting for gate' }` (or a more specific blocked reason) and **must not** mutate candidates/cycles.
- **Row types in `@lhr/db` are `type X = {...}`, never `interface`** (Queryable index-signature rule).
- **Repo reads at runtime use GitHub API**, never local `fs` (office is a separate Vercel root).
- **Test gate (from repo `AGENTS.md`):** after substantive work, changes must still pass root `npm ci` / build / test and workspace builds/tests for mcp-server and lhr-office when those packages are touched.

## File map

| Path | Responsibility |
|------|----------------|
| `packages/db/src/schema.sql` | Tables + indexes + RLS |
| `packages/db/src/sourcedProductCycles.ts` | Cycle CRUD + status/gate transitions |
| `packages/db/src/sourcedProductCandidates.ts` | Candidate CRUD + status transitions |
| `packages/db/src/index.ts` | Re-exports |
| `apps/lhr-office/src/productSourcing/gating.ts` | Read env profile; which gates auto-clear |
| `apps/lhr-office/src/productSourcing/loadPersona.ts` | Load agent markdown via GitHub |
| `apps/lhr-office/src/productSourcing/parseLlmJson.ts` | JSON parse + one retry wrapper |
| `apps/lhr-office/src/productSourcing/criteriaJob.ts` | Job 1 |
| `apps/lhr-office/src/productSourcing/searchJob.ts` | Job 2 |
| `apps/lhr-office/src/productSourcing/monetizeJob.ts` | Job 3 |
| `apps/lhr-office/src/productSourcing/brandJob.ts` | Job 4 |
| `apps/lhr-office/src/registry.ts` | Register four jobs |
| `apps/lhr-office/src/routes/sourcedProducts.ts` | Gate + list APIs |
| `apps/lhr-office/src/server.ts` | Mount router |
| `apps/lhr-office/client/src/pages/Approvals.tsx` (+ types, tests) | Stage tabs UI |
| `apps/lhr-office/client/src/pages/AgentsAndJobs.tsx` (optional light copy) | Blocked/ready hint if easy; history already works via registry |
| `.claude/agents/designer-experience.md` | Product-sourcing duties section |

---

### Task 1: Schema + `@lhr/db` cycle/candidate modules

**Files:**
- Modify: `packages/db/src/schema.sql`
- Create: `packages/db/src/sourcedProductCycles.ts`
- Create: `packages/db/src/sourcedProductCandidates.ts`
- Create: `packages/db/tests/sourcedProductCycles.test.ts`
- Create: `packages/db/tests/sourcedProductCandidates.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces:
  - `SourcedProductCycleStatus` = `'drafting_criteria' | 'awaiting_criteria_approval' | 'searching' | 'awaiting_product_picks' | 'monetizing' | 'awaiting_monetize_approval' | 'branding' | 'awaiting_final' | 'closed'`
  - `SourcedProductCandidateStatus` = `'sourced' | 'picked' | 'skipped' | 'monetize_pass' | 'monetize_fail' | 'monetize_confirmed' | 'dropped' | 'brand_pass' | 'brand_fail' | 'pending_final' | 'approved' | 'denied'`
  - `GatingProfile` = `'strict' | 'trust'`
  - `createSourcedProductCycle(db, { gatingProfile }): Promise<SourcedProductCycle>`
  - `getOpenSourcedProductCycle(db): Promise<SourcedProductCycle | null>` — any status except `closed`
  - `getSourcedProductCycle(db, id): Promise<SourcedProductCycle | null>`
  - `setCycleCriteria(db, id, criteriaJson): Promise<void>` — also moves status toward approval/search per caller (or expose `setCycleStatus`)
  - `setCycleStatus(db, id, status): Promise<void>`
  - `approveCycleCriteria(db, id): Promise<void>` — sets `criteria_approved_at = now()`, status → `searching`
  - `closeSourcedProductCycle(db, id): Promise<void>`
  - `insertSourcedProductCandidate(db, NewCandidate): Promise<SourcedProductCandidate | null>` — ON CONFLICT `(cycle_id, source_url)` DO NOTHING
  - `listSourcedProductCandidates(db, cycleId, status?: …): Promise<SourcedProductCandidate[]>`
  - `setCandidateStatus(db, id, status): Promise<void>`
  - `setCandidateMonetizeResult(db, id, { pass, rationale }): Promise<void>`
  - `setCandidateBrandResult(db, id, { pass, rationale }): Promise<void>`
  - `decideSourcedProductCandidate(db, id, 'approved' | 'denied'): Promise<void>` — sets status + `decided_at`

- [ ] **Step 1: Append schema**

Add to `packages/db/src/schema.sql` (before or after other RLS blocks; enable RLS with no policies like sibling tables):

```sql
CREATE TABLE IF NOT EXISTS sourced_product_cycles (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL,
  criteria_json JSONB,
  criteria_approved_at TIMESTAMPTZ,
  gating_profile TEXT NOT NULL,
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sourced_product_candidates (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES sourced_product_cycles(id),
  title TEXT NOT NULL,
  image_url TEXT,
  source_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  moq TEXT,
  unit_cost_cents INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'sourced',
  monetize_pass BOOLEAN,
  monetize_rationale TEXT,
  brand_pass BOOLEAN,
  brand_rationale TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sourced_product_candidates_cycle_source_url_key
  ON sourced_product_candidates (cycle_id, source_url);

CREATE INDEX IF NOT EXISTS sourced_product_cycles_status_idx
  ON sourced_product_cycles (status);

CREATE INDEX IF NOT EXISTS sourced_product_candidates_cycle_status_idx
  ON sourced_product_candidates (cycle_id, status);

ALTER TABLE sourced_product_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sourced_product_candidates ENABLE ROW LEVEL SECURITY;
```

Apply the same SQL to the office Postgres used in prod/dev (manual/`psql` — this repo treats `schema.sql` as source of truth the same way other tables were added).

- [ ] **Step 2: Write failing tests**

Use the `mockDb` pattern from `packages/db/tests/competitors.test.ts`. Cover: create cycle with profile; get open cycle ignores `closed`; `insertSourcedProductCandidate` conflict returns null; `approveCycleCriteria` sets timestamp + status; `decideSourcedProductCandidate` sets `decided_at`; monetize/brand setters write pass + rationale.

- [ ] **Step 3: Implement modules + export from `index.ts`**

Follow `candidates.ts` snake_case row → camelCase mapping. Use `type` aliases for rows.

- [ ] **Step 4: Run tests**

```bash
npm test --workspace=@lhr/db
```

Expected: PASS for new files.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/sourcedProductCycles.ts packages/db/src/sourcedProductCandidates.ts packages/db/src/index.ts packages/db/tests/sourcedProductCycles.test.ts packages/db/tests/sourcedProductCandidates.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add sourced product cycle and candidate tables

EOF
)"
```

---

### Task 2: Gating helpers + persona/JSON utilities

**Files:**
- Create: `apps/lhr-office/src/productSourcing/gating.ts`
- Create: `apps/lhr-office/src/productSourcing/loadPersona.ts`
- Create: `apps/lhr-office/src/productSourcing/parseLlmJson.ts`
- Create: `apps/lhr-office/tests/productSourcing/gating.test.ts`
- Create: `apps/lhr-office/tests/productSourcing/parseLlmJson.test.ts`

**Interfaces:**
- Produces:
  - `readGatingProfile(): GatingProfile` — from `PRODUCT_SOURCING_GATING_PROFILE`
  - `gateAutoClears(profile, gate: 'criteria' | 'monetize'): boolean` — true for those gates under `trust`; pick-products and final never auto
  - `loadAgentPersona(client: GitHubClient, relativePath: string): Promise<string>` — throws if missing/empty
  - `parseLlmJson<T>(raw: string): T` — strip optional ``` fences; throw on invalid
  - `callLlmJson<T>(messages, options, parse: (u: unknown) => T): Promise<T>` — call `callLLM`, parse, on failure one more `callLLM` then throw

- [ ] **Step 1: Failing tests for profile defaults and auto-clear matrix**

```ts
expect(readGatingProfile()).toBe('strict'); // unset
process.env.PRODUCT_SOURCING_GATING_PROFILE = 'trust';
expect(gateAutoClears('trust', 'criteria')).toBe(true);
expect(gateAutoClears('strict', 'criteria')).toBe(false);
expect(gateAutoClears('trust', 'monetize')).toBe(true);
```

- [ ] **Step 2: Implement gating + parse helpers; mock GitHub in persona test (or unit-test throw path only)**

`loadPersona.ts` uses `getFile(client, path, 'main')` like `trendsWatcher.ts` `readContentStrategistPersona`.

- [ ] **Step 3: Run**

```bash
npm test --workspace=lhr-office -- tests/productSourcing/gating.test.ts tests/productSourcing/parseLlmJson.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(office): product-sourcing gating and LLM JSON helpers

EOF
)"
```

---

### Task 3: Criteria job

**Files:**
- Create: `apps/lhr-office/src/productSourcing/criteriaJob.ts`
- Create: `apps/lhr-office/tests/productSourcing/criteriaJob.test.ts`
- Modify: `.claude/agents/designer-experience.md` (add Product sourcing section — criteria + brand fit; keep UX review)

**Interfaces:**
- Consumes: Task 1 cycle APIs, Task 2 gating/persona/json, `callLLM`, GitHub client, `getPool`
- Produces: `runProductSourcingCriteria(): Promise<JobResult>`

**Criteria JSON shape (lock this):**

```ts
type SearchCriteria = {
  keywords: string[];           // 1–6 short phrases
  platforms: string[];          // hostnames without scheme, e.g. "alibaba.com"
  aestheticNotes: string;       // free text for scout
  categoryHints: string[];      // e.g. "serveware", "knives"
};
```

- [ ] **Step 1: Extend designer-experience agent**

Append a section titled `## Product sourcing (office pipeline)` describing: draft `SearchCriteria` JSON from `docs/BRAND.md` + existing products; later pass/fail brand fit on marketplace listings with rationale. State that when used as a job persona, reply with JSON only for the tool prompt that asks for it.

- [ ] **Step 2: Failing tests**

Mock db + `callLLM` + GitHub:
- No open cycle → creates cycle with `readGatingProfile()`, status `drafting_criteria`, writes criteria, then if `gateAutoClears(profile,'criteria')` → `approveCycleCriteria` / status `searching`, else status `awaiting_criteria_approval`
- Open cycle not in criteria stage → `{ status: 'success', summary: 'blocked: waiting for gate' }` (or `blocked: cycle busy`) without LLM call
- Open cycle in `drafting_criteria` or `awaiting_criteria_approval` → re-runs criteria replace

- [ ] **Step 3: Implement `runProductSourcingCriteria`**

Load persona `.claude/agents/designer-experience.md`, `docs/BRAND.md`, list `src/content/products/*.json` via GitHub (titles/names only is enough). Prompt for `SearchCriteria` JSON. Persist. Apply auto-clear when `trust`.

- [ ] **Step 4: Run tests + commit**

```bash
npm test --workspace=lhr-office -- tests/productSourcing/criteriaJob.test.ts
git commit -m "$(cat <<'EOF'
feat(office): product-sourcing criteria job and designer persona extension

EOF
)"
```

---

### Task 4: Search job

**Files:**
- Create: `apps/lhr-office/src/productSourcing/searchJob.ts`
- Create: `apps/lhr-office/tests/productSourcing/searchJob.test.ts`

**Interfaces:**
- Consumes: `fetchSearchResults` from `../serpapiSearch.js`, cycle in `searching`, scout persona, Task 1 inserts
- Produces: `runProductSourcingSearch(): Promise<JobResult>`

**Behavior:**
1. Open cycle must be `searching` (criteria already approved); else blocked success.
2. Require `SERPAPI_KEY` (via `fetchSearchResults`) and `GITHUB_TOKEN` for persona.
3. Build queries: for each keyword (cap so total queries ≤ 6) × each platform in criteria (default `['alibaba.com','dhgate.com']`): `q = \`${keyword} site:${platform}\``.
4. Insert candidates (`status: 'sourced'`, platform inferred from domain); skip duplicates.
5. Optional LLM pass with product-sourcing-scout to rank/annotate top hits (MOQ/notes when model invents unknowns — prefer leaving null over fabricating; prompt must say so). If LLM fails after retry → `partial` but keep inserted rows.
6. Set cycle status → `awaiting_product_picks` (pick gate always on).

- [ ] **Step 1: Failing tests** — blocked when not `searching`; inserts from mocked SerpAPI; respects 6-query cap; empty hits still move to `awaiting_product_picks` with success summary.

- [ ] **Step 2: Implement + test + commit**

```bash
npm test --workspace=lhr-office -- tests/productSourcing/searchJob.test.ts
git commit -m "$(cat <<'EOF'
feat(office): product-sourcing search job via SerpAPI

EOF
)"
```

---

### Task 5: Monetize + brand jobs

**Files:**
- Create: `apps/lhr-office/src/productSourcing/monetizeJob.ts`
- Create: `apps/lhr-office/src/productSourcing/brandJob.ts`
- Create: `apps/lhr-office/tests/productSourcing/monetizeJob.test.ts`
- Create: `apps/lhr-office/tests/productSourcing/brandJob.test.ts`

**Interfaces:**
- Produces: `runProductSourcingMonetize(): Promise<JobResult>`, `runProductSourcingBrand(): Promise<JobResult>`

**Monetize:**
- Eligible when cycle `monetizing` OR when cycle `awaiting_product_picks` is wrong — actually: human pick advances cycle to `monetizing` (Task 6 API). Job runs only if status === `monetizing`.
- Process candidates with `status === 'picked'` only.
- LLM (monetization-scout) returns per-id `{ id, pass, rationale }`; write `monetize_pass` / `monetize_fail`.
- If `gateAutoClears(profile, 'monetize')`: auto-set all `monetize_pass` → `monetize_confirmed`, cycle → `branding`; else cycle → `awaiting_monetize_approval`.

**Brand:**
- Eligible when status === `branding`.
- Process `monetize_confirmed` only.
- designer-experience persona; `brand_pass` → set status `pending_final`; `brand_fail` terminal.
- Cycle → `awaiting_final` when done (even if zero passes).

- [ ] **Step 1: Failing tests for eligibility, only correct statuses processed, trust auto-confirm, brand_pass → pending_final**

- [ ] **Step 2: Implement both jobs**

- [ ] **Step 3: Test + commit**

```bash
npm test --workspace=lhr-office -- tests/productSourcing/monetizeJob.test.ts tests/productSourcing/brandJob.test.ts
git commit -m "$(cat <<'EOF'
feat(office): product-sourcing monetize and brand jobs

EOF
)"
```

---

### Task 6: Register jobs + gate API routes

**Files:**
- Modify: `apps/lhr-office/src/registry.ts`
- Modify: `apps/lhr-office/tests/registry.test.ts`
- Create: `apps/lhr-office/src/routes/sourcedProducts.ts`
- Create: `apps/lhr-office/tests/routes/sourcedProducts.test.ts`
- Modify: `apps/lhr-office/src/server.ts`
- Modify: `apps/lhr-office/tests/server.test.ts` (auth mount smoke if needed)

**Interfaces:**
- Registry entries:
  - `{ name: 'product-sourcing-criteria', cadenceDays: 7, run: runProductSourcingCriteria }`
  - `{ name: 'product-sourcing-search', cadenceDays: 1, run: runProductSourcingSearch }`
  - `{ name: 'product-sourcing-monetize', cadenceDays: 1, run: runProductSourcingMonetize }`
  - `{ name: 'product-sourcing-brand', cadenceDays: 1, run: runProductSourcingBrand }`
- Keep asserting `affiliate-sourcing` is undefined.
- Router mounted at `/api/sourced-products` behind `requireSupabaseAuth`:

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/cycle` | Open cycle + candidates (or null) |
| POST | `/cycle/:id/criteria/approve` | Body optional `{ criteriaJson }`; save if present; `approveCycleCriteria`; status `searching` |
| POST | `/cycle/:id/candidates/pick` | Body `{ pickIds: number[], skipIds: number[] }`; set statuses; cycle → `monetizing` |
| POST | `/cycle/:id/monetize/confirm` | Body `{ confirmIds: number[], dropIds: number[] }`; only from `monetize_pass`; cycle → `branding` |
| POST | `/candidates/:id/approve` | Final approve |
| POST | `/candidates/:id/deny` | Final deny |
| POST | `/cycle/:id/close` | Optional abandon |

After final decisions, if no remaining `pending_final`, set cycle `closed` (helper ok).

- [ ] **Step 1: Registry tests first (fail), then register**

- [ ] **Step 2: Route tests with mocked `@lhr/db` functions (vi.mock) + `supertest` like `tests/routes/competitors.test.ts`**

- [ ] **Step 3: Mount in `createApp`**

- [ ] **Step 4: Run office tests for registry + routes + commit**

```bash
npm test --workspace=lhr-office -- tests/registry.test.ts tests/routes/sourcedProducts.test.ts
git commit -m "$(cat <<'EOF'
feat(office): register product-sourcing jobs and gate API

EOF
)"
```

---

### Task 7: Approvals UI (Sourced products stage tabs)

**Files:**
- Modify: `apps/lhr-office/client/src/lib/types.ts`
- Modify: `apps/lhr-office/client/src/pages/Approvals.tsx`
- Modify: `apps/lhr-office/client/src/pages/Approvals.test.tsx`
- Optionally light status text on `AgentsAndJobs.tsx` — **skip unless trivial**; job history alone is enough for v1

**Interfaces (client types):**
- `SourcedProductCycle`, `SourcedProductCandidate` mirroring API JSON (camelCase as returned by Express).

**UI:**
- Section “Sourced products” with tabs: Brief | Pick | Monetize | Final (show/hide based on cycle status + candidate statuses).
- Brief: render criteria keywords; Approve button → `POST .../criteria/approve`.
- Pick: list `sourced`; checkboxes; Advance selected.
- Monetize: list monetize results; confirm passes.
- Final: `pending_final` Approve/Deny.
- Empty: “No open sourcing cycle” / “Nothing at this stage”.

- [ ] **Step 1: Failing client tests** (mock `apiFetch` / `useApiResource` like existing Approvals tests)

- [ ] **Step 2: Implement UI**

- [ ] **Step 3: Run client + office tests**

```bash
npm test --workspace=lhr-office
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(office): Approvals stage tabs for sourced products

EOF
)"
```

---

### Task 8: Spec status + end-to-end verification notes

**Files:**
- Modify: `docs/superpowers/specs/active/2026-10-31-product-sourcing-pipeline-design.md` — Status → `Approved`; note plan path

- [ ] **Step 1: Update spec status line**

- [ ] **Step 2: Manual checklist (author or implementer against a real DB)**

1. Apply schema SQL.
2. Set `PRODUCT_SOURCING_GATING_PROFILE=strict`, LLM + SerpAPI + GitHub env on office.
3. Agents & Jobs → Run `product-sourcing-criteria` → Approvals Brief → Approve.
4. Run search → Pick products → Run monetize → Confirm → Run brand → Final approve/deny.
5. Flip env to `trust`, close/start new cycle; confirm criteria + monetize auto-advance.

- [ ] **Step 3: Full test gate from repo root**

```bash
npm ci
npm run build
npm test
npm run build --workspace=mcp-server
npm test --workspace=mcp-server
npm run build --workspace=lhr-office
npm test --workspace=lhr-office
```

- [ ] **Step 4: Commit docs**

```bash
git commit -m "$(cat <<'EOF'
docs: mark product-sourcing pipeline spec approved

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Four jobs, personas, SerpAPI | 3–5, 6 |
| `strict`/`trust` snapshot + gate matrix | 1–2, 5–6 |
| Approvals stage tabs; approve = record only | 6–7 |
| No affiliate in pipeline | Global + Task 6 registry assert |
| Designer persona extended | Task 3 |
| Caps / cadence / profile env | Global Constraints |
| Blocked job non-mutating | Tasks 3–5 tests |
| Out of scope Shopify/affiliate/notify | not scheduled |

Deferred from spec §9 resolved here: env for profile; caps 6×8; cadence 7/1/1/1.
