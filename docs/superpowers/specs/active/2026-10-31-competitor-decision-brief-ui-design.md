# Competitor decision brief + overlap radar (Research UI)

**Status:** approved  

**Date:** 2026-10-31  
**Related:** `2026-09-06-competitor-analysis-design.md` (pipeline + `competitor_reports` snapshots)  
**Mockup (approved layout):** `docs/mockups/competitor-overview-abc.html` — **Overview A** only

## Problem

Weekly competitor analysis already writes rich per-cycle data (`new_content`, `seo_positions`, monetization/design snapshots, `summary`), but Research → Competitors only shows a flat list with the `summary` string. That is not decision-ready: the author cannot compare overlap at a glance, open a full brief, or get concrete “what should I do” actions. Revenue/MAU axes were rejected for this phase (no trustworthy free data source).

## Decision

Ship **Overview A** (radar hero + threat-sorted chips) and a **large analysis modal**. Defer layouts B (mini-radar cards) and C (scatter). Persist four overlap scores and a decision-oriented brief on each report so the UI is not inventing numbers client-side.

## Goals

- One composition on Research → Competitors: big 4-axis spider for the selected tracked competitor + chip strip sorted by threat.
- Click chip / “Open full analysis” → large modal with radar, numeric scores, decision brief, suggested actions, monetization, design, SEO positions, new content.
- Discovery queries + SEO keywords stay available but collapsed under a Sources footer so they do not dominate the workshop.
- Candidates approval UI stays reachable (same page or adjacent block) without becoming the overview.

## Non-goals

- Layouts B and C.
- Free Similarweb / revenue / MAU axes.
- Pixel screenshot diffs.
- Auto-acting on suggested actions (reporting only).
- Replacing the weekly pipeline’s four observation dimensions — this adds decision packaging on top.

## Overlap axes (0–100 integers)

| Axis | Meaning | Scoring inputs (LLM + structured) |
|------|---------|-----------------------------------|
| **Shared market** | How much audience / niche LHR and this site share | Domain niche, gluten-free / food / kitchenware signals from homepage + content |
| **Content** | How similar the editorial program is | New posts this cycle + historical content shape vs LHR’s recipe/article mix |
| **Product** | How similar the commerce / affiliate posture is | Monetization snapshot (shop, affiliates, books, ads) vs LHR’s kitchenware affiliate model |
| **Threat** | How urgent it is to respond this cycle | Blend of the three axes + SEO presence + “what changed” intensity |

No axis may invent traffic, revenue, or MAU. If a dimension was unreachable this cycle, the scorer uses the prior cycle’s stored snapshot when available and notes thin evidence in the brief (same posture as the Food52 rate-limit case in the mockup).

## Report fields (additive)

Extend `competitor_reports` (and `@lhr/db` `CompetitorReport` / insert path):

```text
overlap_scores JSONB NOT NULL
  -- { market: 0-100, content: 0-100, product: 0-100, threat: 0-100 }

decision_brief TEXT NOT NULL
  -- 2–4 sentences: what this competitor means for LHR this cycle

suggested_actions JSONB NOT NULL
  -- string[] length 1–5, concrete LHR-side actions (not generic advice)
```

Existing columns stay. `summary` remains the short “what changed this week” synthesis for Agents & Jobs / history; `decision_brief` is the Research modal’s primary prose. New columns are written by an extra LLM packaging call after the existing synthesis (or a single combined structured call if cheaper — implementer’s choice as long as both strings stay distinct and scores are validated integers 0–100).

Migration: additive columns with safe defaults for old rows (`overlap_scores` all `0`, empty actions array, `decision_brief = summary` or literal placeholder) so GET never 500s before the next cycle backfills.

## Pipeline change

In `apps/lhr-office/src/competitorAnalysis.ts` `buildCompetitorReport`:

1. Keep current content / SEO / monetization / design / weekly `summary` behavior.
2. After those exist, produce `overlap_scores`, `decision_brief`, and `suggested_actions` with LHR context baked into the prompt (food + kitchenware affiliate blog; gluten-free / relationship-food niche; active set cadence).
3. Validate scores with Zod (or equivalent) before insert; on packaging failure, still write the report with `summary` intact, scores `0`, `decision_brief` = `"[Decision brief failed this cycle]"`, `suggested_actions` = `[]` (same fail-soft pattern as summary failure today).

## API

`GET /api/competitors` already returns `latestReportsByCompetitorId` but the SPA type strips fields to `{ id, competitorId, cycleId, summary }`. Expand the mapped report to the full latest report shape the UI needs:

- `newContent`, `seoPositions`, `monetizationSnapshot`, `designSnapshot`, `summary`
- `overlapScores`, `decisionBrief`, `suggestedActions`
- `generatedAt`, `cycleId`

No new route required for v1. Reject/add/approve/keyword/discovery routes unchanged.

## Research UI (Overview A)

**Layout** (match mockup A):

- Left: “Overlap vs LHR” panel — SVG spider for the selected competitor; domain + threat under chart; “Open full analysis →”.
- Right: “Tracked · sorted by threat” — chips (avatar initial, domain, market/content teaser, threat pill). Selecting a chip updates the hero radar; opening the modal uses the same selection.
- Default selection: highest threat among tracked with a report; if none, first tracked.
- Footer `<details>`: Sources — discovery queries + SEO keywords (existing controls).
- Candidates / add-competitor: keep existing controls nearby without turning the overview into a list dump (candidates can stay above Sources or in Approvals if already linked — do not resurrect a long tracked list as the primary view).

**Modal** (large, same structure as mockup):

- Header: domain, external website link, Remove (existing reject), Close (Esc / backdrop).
- Left rail: radar + score list for the four axes.
- Body: Decision brief → Suggested actions → Monetization → Design → SEO positions (keyword / `#n` or `—`). Optionally New content if `newContent.length > 0`.

Visual language: existing lhr-office dark tokens (`--bg` / accent cyan); no new brand system. Prefer a small shared `OverlapRadar` SVG component used by hero + modal.

## Tests

- DB: insert/list round-trip for new columns; score shape.
- Pipeline unit: packaging success writes scores/brief/actions; packaging failure still inserts report with fail-soft defaults.
- `GET /api/competitors`: response includes full latest report fields (not summary-only).
- Research UI: radar + chips render from scores; modal shows brief/actions/snapshots; Sources collapsed by default; chip sort by threat descending.

## Out of scope

- Historical radar animation / multi-cycle overlay.
- Editing scores or actions by hand in the UI.
- Paying SEO/traffic vendors.
- Layouts B/C (mockup file may keep them for reference; product ships A only).
