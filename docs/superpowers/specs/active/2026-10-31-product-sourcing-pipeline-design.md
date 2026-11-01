# Product sourcing pipeline (Chinese wholesale) — Design

**Date:** 2026-10-31  
**Status:** Approved — implementation plan: `docs/superpowers/plans/2026-10-31-product-sourcing-pipeline.md`  
**Related:** `2026-08-25-shared-orchestrator-design.md`, `2026-09-06-trends-watcher-design.md` (persona + `@lhr/llm` pattern), `2026-07-13-shopify-commerce-design.md` (future sink; not written by this pipeline)

## 1. Overview & Goals

Adds a multi-stage product-sourcing workflow to `apps/lhr-office`, driven from Agents & Jobs and gated on Approvals. The pipeline finds Chinese marketplace wholesale/dropship candidates (Alibaba, DHgate, and similar via search), filters them through monetization and brand-fit judgment, and parks survivors for a human final decision.

Agent judgment uses the existing `.claude/agents/*.md` files as LLM personas (same pattern as trends-watcher), not Cursor subagents. Humans green-light between stages while trust is low (`strict` gating); the same jobs support a looser profile (`trust`) later without rewriting the pipeline.

**Primary success criteria:**
- From Agents & Jobs, the author can start a sourcing cycle and advance it stage-by-stage with explicit green-lights under the `strict` profile.
- Passing products appear under Approvals → Sourced products; final Approve/Deny records a decision only (no Shopify write, no `src/content/products` commit).
- Gating profile is configurable (`strict` | `trust`) and snapshotted per cycle so mid-cycle profile changes cannot scramble state.
- Amazon affiliate / Keepa sourcing is explicitly out of this pipeline (existing affiliate candidates UI may remain; this work does not revive `affiliate-sourcing`).

**Explicitly out of scope (v1):**
- Amazon affiliate matching, Keepa, Associates commits
- Shopify product creation, supplier contact, sample orders, placing inquiries
- Notifications when a gate needs attention
- Auto-chaining into content or commerce systems

## 2. Architecture & data flow

Four registered jobs in `apps/lhr-office/src/registry.ts`. Cadence/run-now on the **criteria** job starts a cycle; later jobs are eligible only when the cycle is at the matching stage (and the prior gate is cleared, or auto-cleared under `trust`).

```
Agents & Jobs / cron
  → product-sourcing-criteria
       persona: designer-experience (+ BRAND.md, catalog)
       writes: sourced_product_cycles.criteria_json
  → [GATE: approve/edit brief]     # ON in strict; OFF in trust
  → product-sourcing-search
       persona: product-sourcing-scout
       SerpAPI site searches → sourced_product_candidates (status=sourced)
  → [GATE: pick products]          # ON in both profiles
  → product-sourcing-monetize
       persona: monetization-scout (wholesale sellability only)
  → [GATE: confirm monetizable]    # ON in strict; OFF in trust
  → product-sourcing-brand
       persona: designer-experience (product vibe / brand fit)
  → [GATE: final Approvals]        # always ON
```

**Gating profiles** (office config — env or small DB setting; default `strict`):

| Gate | `strict` (v1 default) | `trust` (future landing) |
|------|------------------------|---------------------------|
| After criteria | pause | auto-advance |
| After search (pick products) | pause | pause |
| After monetize | pause | auto-advance |
| Final Approvals | pause | pause |

When a gate is OFF, completing the upstream job immediately marks that gate cleared and leaves the cycle ready for the next job (cron or Run now). When ON, Approvals stage UI (or an Advance action) must clear it before the next job may run.

Orchestrator overlap/due-check behavior is unchanged: each job name is independent in `orchestrator_runs`. Downstream jobs that are not yet eligible return a clear `JobResult` (`success`/`partial` with summary “blocked: waiting for gate”) without mutating candidate rows — they do not throw as hard failures unless misconfigured.

## 3. Data model

New tables in `@lhr/db` (Postgres; RLS consistent with sibling tables):

### `sourced_product_cycles`

| Column | Notes |
|--------|--------|
| `id` | serial PK |
| `started_at` | timestamptz |
| `status` | see cycle statuses below |
| `criteria_json` | jsonb — designer search brief |
| `criteria_approved_at` | null until criteria gate cleared |
| `gating_profile` | `strict` \| `trust` — snapshotted at cycle start |
| `closed_at` | nullable |

**Cycle statuses:** `drafting_criteria` → `awaiting_criteria_approval` → `searching` → `awaiting_product_picks` → `monetizing` → `awaiting_monetize_approval` → `branding` → `awaiting_final` → `closed`.

Under `trust`, statuses that would be “awaiting_*” for auto-cleared gates are skipped (e.g. criteria completion goes `searching` / ready-for-search without an awaiting_criteria_approval dwell).

### `sourced_product_candidates`

| Column | Notes |
|--------|--------|
| `id` | serial PK |
| `cycle_id` | FK |
| `title`, `image_url`, `source_url` | from search hits |
| `platform` | e.g. `alibaba`, `dhgate`, `other` |
| `moq`, `unit_cost_cents`, `notes` | nullable; scout-filled when available |
| `status` | see below |
| `monetize_pass`, `monetize_rationale` | set by monetize job |
| `brand_pass`, `brand_rationale` | set by brand job |
| `decided_at` | final approve/deny |

Unique index on `(cycle_id, source_url)`.

**Candidate statuses (happy path):** `sourced` → `picked` → `monetize_pass` → `monetize_confirmed` → `brand_pass` → `pending_final` → `approved` | `denied`.

**Terminal / side paths (never reach `pending_final`):** `skipped` (not picked); `monetize_fail` (scout said no — terminal); `dropped` (human declined a `monetize_pass` at the monetize gate); `brand_fail` (designer said no — terminal). Only `monetize_pass` may become `monetize_confirmed`; only `brand_pass` may become `pending_final`.

## 4. Office UI

### Agents & Jobs

Four job cards (`product-sourcing-criteria`, `product-sourcing-search`, `product-sourcing-monetize`, `product-sourcing-brand`). Each shows last run history as today. When the open cycle is waiting on a gate, the next job’s card indicates blocked/ready. Run now on criteria starts a **new** cycle only when no open cycle exists (or the previous is `closed`); otherwise it re-runs criteria for the open cycle only if still in the criteria stage.

### Approvals — Sourced products

New section with **stage tabs**: Brief · Pick products · Monetize · Final.

- **Brief:** show `criteria_json`; Approve / Edit+Approve advances the criteria gate.
- **Pick products:** list `sourced` candidates; multi-select Advance (→ `picked`) / Skip.
- **Monetize:** list monetize results; confirm which `monetize_pass` items continue (`monetize_confirmed`) vs `dropped` (strict only as a required pause; trust auto-confirms passes).
- **Final:** `pending_final` items; Approve / Deny → record decision only.

Existing Recipe / Affiliate / Competitor approval sections unchanged.

## 5. Personas & LLM usage

Load agent markdown from GitHub `main` via existing Octokit helpers (trends-watcher pattern):

- **designer-experience** — extend the agent file with a Product sourcing section: (1) draft structured search criteria from `docs/BRAND.md` + catalog gaps; (2) brand/vibe fit pass/fail on listings. Existing UX-review duties remain.
- **product-sourcing-scout** — use as written for ranking/filtering marketplace hits and supplier-signal notes (read-only).
- **monetization-scout** — for this pipeline, prompt narrows to wholesale/dropship sellability (margin at plausible retail, MOQ risk, channel fit). No affiliate program research in this job.

Structured outputs are JSON; parse failure → one retry → stage fails, cycle remains at prior gate (no silent advance).

## 6. Marketplace search

`product-sourcing-search` turns approved criteria into SerpAPI queries (`site:alibaba.com`, `site:dhgate.com`, optional additional platforms listed in criteria). No marketplace logins, no vendor inquiries.

Per-cycle caps (exact numbers in the implementation plan): bound query count and results per query. Empty hits → successful job with empty list (author can close cycle or re-run criteria). API failures → `partial` or `failure` JobResult; no gate auto-clear on failure.

## 7. Error handling & edge cases

- Missing `GITHUB_TOKEN`, `SERPAPI_KEY`, or LLM credentials → fail fast with named env in JobResult.
- Re-run of a stage while its gate is still pending replaces that stage’s draft output; does not skip gates.
- Gating profile cannot change mid-cycle (snapshot on `sourced_product_cycles`).
- Orphaned `running` orchestrator rows continue to be handled by the existing orphan reaper — no special case.

## 8. Testing

- `@lhr/db`: cycle/candidate insert, unique `(cycle_id, source_url)`, status transitions, gate-clear helpers, profile snapshot.
- Job unit tests: criteria writes brief; search inserts candidates; monetize/brand only process `picked` / `monetize_confirmed`; blocked-when-not-eligible returns non-mutating JobResult.
- Gating profile: `strict` pauses vs `trust` auto-advances the expected gates.
- Approvals/routes: brief approve, pick, monetize confirm, final approve/deny.
- Registry: four new jobs registered; `affiliate-sourcing` remains unregistered.

## 9. Open decisions deferred to implementation plan

- Exact SerpAPI query caps and which platforms are default vs criteria-driven
- Whether gating profile lives in env (`PRODUCT_SOURCING_GATING_PROFILE`) or a DB row editable from the office UI
- Cadence days for the criteria job (likely 7 to match sibling weekly jobs)
