# `/setup` Skill — Design

**Date:** 2026-07-13
**Status:** Approved for planning

## 1. Overview & Goals

The site's project agents (`.claude/agents/`) and governance docs (`docs/CONSTITUTION.md`, `docs/RULES.md`) were built ahead of the actual business plan — several agents already reference a niche/mission that isn't written down anywhere, and three agents (`community-builder`, `content-strategist`, `store-merchandiser`) exist only as empty stub files waiting for that plan to exist. Separately, a new `chief-of-staff` agent was added as the single interface between the author and every other agent, and it already references a `docs/PERSONA.md` file that doesn't exist yet.

This spec covers a one-time (but rerunnable) setup interview — invoked as `/setup` — that collects the missing business-plan and persona information directly from the author and wires it into the repo: a new canonical business-plan doc, proposed edits to the constitution/rules, the three empty agent stubs filled in, a new persona doc, and finally a root `CLAUDE.md` that makes `chief-of-staff` the default experience for every future session in this project.

**Primary success criteria:**
- Running `/setup` produces `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md`, both written directly from the interview.
- `CONSTITUTION.md`, `RULES.md`, and the three empty agent stubs are updated/filled — but only after the author explicitly approves the proposed diffs.
- A root `CLAUDE.md` is created as the final step, making `chief-of-staff` the default session behavior in this project from then on.
- The skill is rerunnable: if `docs/BUSINESS-PLAN.md` already exists, it asks whether to start fresh or revise specific sections rather than silently overwriting.

## 2. Skill Mechanics

- Lives at `.claude/skills/setup/SKILL.md`, invoked as `/setup`.
- Tools needed: `Read`, `Write`, `Edit`, `Glob`, `AskUserQuestion`.
- On invocation, first checks whether `docs/BUSINESS-PLAN.md` exists:
  - **Doesn't exist** → run the full interview below, topics 1–7 in order.
  - **Exists** → ask the author: start over (re-run all topics) or revise specific sections (show the topic list, let them pick which to redo). Untouched sections keep their existing answers.
- Questions are asked one at a time. Prefer `AskUserQuestion` multiple-choice where options are enumerable (e.g. fulfillment model, cadence preferences); use open-ended questions where a persona/description is genuinely free-form (e.g. the niche statement, audience persona).
- After each topic, briefly reflect the captured answer back before moving to the next topic, so the author can correct misunderstandings immediately rather than at the end.

## 3. Interview Topics

Each topic maps to a specific output — nothing collected goes unused.

1. **Identity & niche** — plain-language description of what the business sells/publishes/for whom; what makes it different from a generic lifestyle store. → explicit niche statement for `CONSTITUTION.md` (currently absent — several agents infer it from content instead).
2. **Audience & brand voice** — target reader/customer persona; tone adjectives or examples. → feeds `content-strategist` and `community-builder`.
3. **Content strategy** — content pillars beyond recipes; how tightly content must funnel to product; cadence preferences beyond the existing ~26-posts/6-months rule (`RULES.md` #4). → feeds `content-strategist`; possible new `RULES.md` entries.
4. **Product & fulfillment** — core product categories/priorities; fulfillment model (owned inventory / dropship / print-on-demand / hybrid); pricing philosophy; seasonal/"sets" strategy. → feeds `store-merchandiser`.
5. **Community & engagement roadmap** — which features are near-term real vs. aspirational (forums, giveaways/raffles, newsletter, comments); realistic solo-owner moderation capacity. → feeds `community-builder`.
6. **Non-negotiables vs. flexible conventions** — anything from topics 1–5 that should become a hard `CONSTITUTION.md` principle vs. an evolvable `RULES.md` entry.
7. **Chief-of-staff persona** — structured dimensions: tone/formality, verbosity (terse vs. explanatory by default), humor tolerance, how proactively to surface tradeoffs/risk (tunes volume, not whether `chief-of-staff` does this — that behavior is already hardcoded in the agent regardless of persona), preferred form of address / pet peeves. → `docs/PERSONA.md`.

## 4. Output & Writing Behavior

- **`docs/BUSINESS-PLAN.md`** — written directly (new file, or updated in place per the rerun logic in §2), organized by topics 1–6.
- **`docs/PERSONA.md`** — written directly from topic 7. Referenced today by `.claude/agents/chief-of-staff.md` line 12 as a dangling "if it exists" check; after `/setup` runs, it exists.
- **Proposed diffs** (not written until approved) for:
  - `docs/CONSTITUTION.md` — the niche/mission statement from topic 1, added as descriptive framing unless topic 6 flags it as a hard principle, in which case it's added as a new numbered rule.
  - `docs/RULES.md` — new entries for content pillars, funnel intensity, pricing philosophy, community roadmap cadence, etc., as surfaced by topics 3–5.
  - `.claude/agents/community-builder.md`, `content-strategist.md`, `store-merchandiser.md` — filled in following the existing agent style (frontmatter: `name`, `description`, `tools`, `model`; body: role, method, output), using `seo-auditor.md` and `monetization-scout.md` as style templates. Read-only tools by default unless the interview surfaces a concrete need for write access.
- The skill presents all proposed diffs together for review, and only writes them to disk after explicit author approval. `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` are the exception — those are new/author-authored-via-interview content, written directly without a separate approval gate.
- **Final step:** once the above is written, `/setup` creates a root `CLAUDE.md` (none exists in this repo today) instructing every future session in this project to read `.claude/agents/chief-of-staff.md` and `docs/PERSONA.md` and operate as `chief-of-staff` for the whole session. This step only runs after everything else succeeds, so `chief-of-staff` only becomes the default once `/setup` has actually completed.
- Out of scope for the skill itself: refreshing the assistant's cross-session memory notes that currently flag the niche as "not yet documented" (`project_site_niche_and_model`, `project_subagents_overview`). That's the orchestrating assistant's job immediately after `/setup` completes, not a repo-file concern for the skill.

## 5. Error Handling

- If the author abandons the interview mid-topic, no partial `docs/BUSINESS-PLAN.md` or `docs/PERSONA.md` is written — the skill only writes once a topic (or the full interview, on first run) is complete, so a half-finished session leaves no half-written doc behind.
- If the author declines the proposed `CONSTITUTION.md`/`RULES.md`/agent-stub diffs, `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` (if already written) are kept regardless — the author can re-run `/setup` later to revise and re-propose.
- The root `CLAUDE.md` step never runs if any earlier required write was declined or failed, since chief-of-staff becoming the default is meant to reflect a fully-configured project.

## Out of Scope

- Financial projections, legal entity/structure, funding, competitive analysis — deliberately excluded; this interview stays scoped to what the existing agents/docs actually need (see design discussion).
- A SessionStart hook or other enforcement mechanism for the chief-of-staff default — `CLAUDE.md` is sufficient since it's auto-loaded every session in this project.
