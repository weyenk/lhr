---
name: setup
description: One-time, rerunnable interview that collects this site's business plan and the chief-of-staff persona, then wires them into docs/CONSTITUTION.md, docs/RULES.md, the community-builder/content-strategist/store-merchandiser agent stubs, and a root CLAUDE.md. Invoke as /setup.
---

# /setup — Business Plan & Persona Interview

Collects the missing business-plan and persona information directly from the author and wires it into the repo. This is the one-time (but rerunnable) interview described in `docs/superpowers/specs/2026-07-13-setup-skill-design.md`.

**Tools this skill uses:** Read, Write, Edit, Glob, AskUserQuestion.

## Step 0: Check for an existing business plan

Check whether `docs/BUSINESS-PLAN.md` exists (Glob or Read).

- **Doesn't exist** → this is a first run. Proceed to "Step 1: Run the interview" with all seven topics in order.
- **Exists** → this is a rerun. Ask the author, via `AskUserQuestion`:

  Question: "docs/BUSINESS-PLAN.md already exists. How do you want to proceed?"
  Options:
  - "Start over" — re-run all seven topics from scratch, overwriting the existing doc once the interview completes.
  - "Revise specific sections" — show the topic list (below) and let the author multi-select which topics to redo. Read the existing `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` first so untouched sections' existing answers are preserved verbatim in the rewritten doc.

  If "Revise specific sections": ask a second `AskUserQuestion` (multiSelect: true) listing the seven topic names: "Identity & niche", "Audience & brand voice", "Content strategy", "Product & fulfillment", "Community & engagement roadmap", "Non-negotiables vs. flexible conventions", "Chief-of-staff persona". Only run the interview steps (Step 1) for the topics selected; keep every other topic's previously-written content unchanged in the final doc(s) (Step 2).
