# Competitor Decision Brief + Overview A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist 4-axis overlap scores + decision brief + suggested actions on competitor reports, expose full latest reports via API, and ship Research Overview A (radar hero + chips + modal).

**Architecture:** Additive columns on `competitor_reports`; packaging LLM call after weekly summary in `competitorAnalysis.ts`; SPA types + Research UI rework matching `docs/mockups/competitor-overview-abc.html` layout A.

**Tech Stack:** `@lhr/db` (pg), Express routes, React SPA in `apps/lhr-office/client`, vitest, SVG radar component (no chart library).

**Spec:** `docs/superpowers/specs/active/2026-10-31-competitor-decision-brief-ui-design.md`

## Global Constraints

- Scores are integers 0–100; no revenue/MAU invention.
- Packaging failure: still insert report; scores `{0,0,0,0}`, `decisionBrief = "[Decision brief failed this cycle]"`, `suggestedActions = []`; mark cycle partial.
- `summary` stays “what changed”; `decisionBrief` is Research primary prose.
- Overview A only (not B/C).
- Every change must pass workspace test gate for touched packages (`@lhr/db`, `lhr-office`).

---

### Task 1: DB schema + competitorReports mapping

**Files:**
- Modify: `packages/db/src/schema.sql`
- Modify: `packages/db/src/competitorReports.ts`
- Modify: `packages/db/tests/competitorReports.test.ts`

- [x] Extend `NewCompetitorReport` / row mapping / INSERT with `overlapScores`, `decisionBrief`, `suggestedActions`
- [x] Add columns to `CREATE TABLE competitor_reports` plus `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for existing DBs with defaults
- [x] Update unit tests for insert args + mapped fields
- [x] `npm test --workspace=@lhr/db` and `npm run build --workspace=@lhr/db`

### Task 2: Pipeline decision packaging

**Files:**
- Modify: `apps/lhr-office/src/competitorAnalysis.ts`
- Modify: `apps/lhr-office/tests/competitorAnalysis.test.ts`
- Possibly: `apps/lhr-office/tests/competitorAnalysisContentBaseline.test.ts`

- [x] Add packaging persona + JSON parse/validate helper
- [x] Call after summary; attach fields to `NewCompetitorReport`
- [x] Tests: success writes scores/brief/actions; parse/LLM failure fail-soft; update existing mocks for packaging persona
- [x] `npm test --workspace=lhr-office -- tests/competitorAnalysis`

### Task 3: API + client types

**Files:**
- Modify: `apps/lhr-office/client/src/lib/types.ts`
- Modify: `apps/lhr-office/tests/routes/competitors.test.ts`

- [x] Expand `CompetitorReport` client type to full fields
- [x] Assert GET returns full latest report object (router already passes through)

### Task 4: Research Overview A + modal

**Files:**
- Create: `apps/lhr-office/client/src/components/OverlapRadar.tsx` (+ test if pure helpers)
- Modify: `apps/lhr-office/client/src/pages/Research.tsx`
- Modify: `apps/lhr-office/client/src/pages/Research.test.tsx`
- Modify: `apps/lhr-office/client/src/theme.css`

- [x] Radar hero + threat-sorted chips + modal + collapsed Sources
- [x] Update Research tests for new UX (radar/chips/modal/sources)
- [x] `npm test --workspace=lhr-office`

### Task 5: Spec status + verify

- [x] Mark design spec **approved**
- [x] Run full lhr-office + @lhr/db test/build commands from AGENTS.md for touched workspaces
