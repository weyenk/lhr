# `/setup` Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `.claude/skills/setup/SKILL.md`, a rerunnable `/setup` interview that produces `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` directly, proposes gated diffs to `docs/CONSTITUTION.md`, `docs/RULES.md`, and the three empty agent stubs, and — only once everything else has succeeded — creates a root `CLAUDE.md` that makes `chief-of-staff` the default session behavior.

**Architecture:** This is a single markdown skill file (a set of instructions an LLM follows, not executable code), per the existing `.claude/skills/` / superpowers-plugin convention already used elsewhere in this environment (skill frontmatter is just `name` + `description` — there is no `tools:` restriction field for skills the way there is for agents). The file is built up in five sequential sections (Step 0 through Step 4 + close-out), each independently testable by hand-tracing the instructions against a scratch copy of the repo's `docs/` and `.claude/agents/` files and inspecting the resulting output. Because the deliverable is a prompt, "tests" in this plan are manual dry-runs with scripted sample answers rather than automated unit tests — each task still ends with a concrete, verifiable checkpoint.

**Tech Stack:** Markdown skill file (Claude Code skill format), no code/build tooling involved. Testing uses `bash`/`diff`/`grep` against a scratch directory (`mktemp -d`) seeded from the real repo files, so real project docs are never touched during implementation or testing.

## Global Constraints

- Skill lives at `.claude/skills/setup/SKILL.md`, invoked as `/setup`. (spec §2)
- Tools the skill uses: `Read`, `Write`, `Edit`, `Glob`, `AskUserQuestion`. (spec §2)
- Questions are asked **one at a time**; use `AskUserQuestion` where options are enumerable, open-ended prose questions where the answer is genuinely free-form. (spec §2)
- After each topic, briefly reflect the captured answer back before moving to the next topic. (spec §2)
- `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` are written **directly, with no approval gate** — they are new, author-authored-via-interview content. (spec §4)
- `docs/CONSTITUTION.md`, `docs/RULES.md`, and the three agent stubs are only ever written **after explicit author approval** of a presented diff. (spec §4)
- The root `CLAUDE.md` is the **final** step and only runs if every earlier required write in the run succeeded (nothing declined, nothing failed). (spec §4, §5)
- If the author abandons the interview mid-topic, **no partial `docs/BUSINESS-PLAN.md` or `docs/PERSONA.md` is written**. (spec §5)
- If the author declines the `CONSTITUTION.md`/`RULES.md`/agent-stub diffs, `docs/BUSINESS-PLAN.md`/`docs/PERSONA.md` (already written) are **kept regardless**. (spec §5)
- Rerunning `/setup` when `docs/BUSINESS-PLAN.md` already exists must ask start-over vs. revise-specific-sections — never silently overwrite. (spec §2, §16)
- No financial projections, legal entity/funding, or competitive analysis in the interview — out of scope. (spec, Out of Scope)
- No SessionStart hook or other enforcement mechanism — `CLAUDE.md` alone is the mechanism. (spec, Out of Scope)

---

## File Structure

- Create: `.claude/skills/setup/SKILL.md` — the entire skill. Built incrementally across Tasks 1-5, each task appending one complete section (Step 0, Steps 1-2, Step 3, Step 4, Step 5) so each task has its own reviewable, testable diff.

No other repository files are modified by this plan — the diffs to `docs/CONSTITUTION.md`, `docs/RULES.md`, the three agent stubs, and the eventual `docs/BUSINESS-PLAN.md` / `docs/PERSONA.md` / root `CLAUDE.md` are all produced **by running the finished skill**, not by this plan. This plan only builds the skill itself.

---

### Task 1: Scaffold + Step 0 (rerun detection)

**Files:**
- Create: `.claude/skills/setup/SKILL.md`
- Test: manual dry-run in a scratch directory (no automated test file — see Step 4 below)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the skill's frontmatter (`name: setup`, `description: ...`) and a `## Step 0: Check for an existing business plan` section that later tasks append after. Establishes the topic list string used verbatim in Task 2's `AskUserQuestion` multiSelect: `"Identity & niche", "Audience & brand voice", "Content strategy", "Product & fulfillment", "Community & engagement roadmap", "Non-negotiables vs. flexible conventions", "Chief-of-staff persona"`.

- [ ] **Step 1: Create the skill file with frontmatter and Step 0**

Create `.claude/skills/setup/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Set up the scratch test fixture**

This fixture is reused (recreated fresh) by every task's test in this plan, so real repo files are never touched.

Run:
```bash
rm -rf /tmp/lhr-setup-skill-test
mkdir -p /tmp/lhr-setup-skill-test/docs /tmp/lhr-setup-skill-test/.claude/agents
cp docs/CONSTITUTION.md docs/RULES.md /tmp/lhr-setup-skill-test/docs/
cp .claude/agents/community-builder.md .claude/agents/content-strategist.md .claude/agents/store-merchandiser.md .claude/agents/chief-of-staff.md /tmp/lhr-setup-skill-test/.claude/agents/
ls /tmp/lhr-setup-skill-test/docs /tmp/lhr-setup-skill-test/.claude/agents
```
Expected: lists `CONSTITUTION.md`, `RULES.md` and the four agent `.md` files. Confirms no `BUSINESS-PLAN.md`, `PERSONA.md`, or `CLAUDE.md` exist yet in the fixture (first-run state).

- [ ] **Step 3: Manually trace Step 0's first-run branch**

With no `docs/BUSINESS-PLAN.md` in the fixture, trace the instructions in `.claude/skills/setup/SKILL.md`'s Step 0 by hand: confirm the branch taken is "Doesn't exist → proceed to Step 1 with all seven topics," not the rerun branch. This is a first-run fixture, so there is nothing else to assert yet — this checkpoint exists to confirm the branch condition itself (file-existence check) is unambiguous before Task 2 builds on it.

- [ ] **Step 4: Manually trace Step 0's rerun branch**

Simulate a prior run having already written a business plan:
```bash
echo "# LHR Business Plan

## Identity & Niche

Placeholder niche text." > /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md
```
Trace Step 0 again by hand: confirm it now takes the "Exists → rerun" branch, and that choosing "Revise specific sections" would present the exact seven topic names listed in the skill file's second `AskUserQuestion`. Confirm the instructions say to **read** the existing `BUSINESS-PLAN.md`/`PERSONA.md` before rewriting anything, not to overwrite blindly.

Clean up before the next task's test re-seeds the fixture:
```bash
rm -f /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/setup/SKILL.md
git commit -m "feat: scaffold /setup skill with rerun-detection step"
```

---

### Task 2: Interview (Step 1) + direct doc writing (Step 2)

**Files:**
- Modify: `.claude/skills/setup/SKILL.md` (append after the Task 1 "## Step 0" section)
- Test: manual dry-run in `/tmp/lhr-setup-skill-test`

**Interfaces:**
- Consumes: Step 0's branching from Task 1 (this section is what Step 0 hands off into); the topic-name list defined in Task 1.
- Produces: `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` templates (exact section headers: `## Identity & Niche`, `## Audience & Brand Voice`, `## Content Strategy`, `## Product & Fulfillment`, `## Community & Engagement Roadmap`, `## Non-Negotiables vs. Flexible Conventions` for the business plan; a flat bullet list for persona). Task 3's `docs/CONSTITUTION.md`/`docs/RULES.md` diffs read the Topic 1 (niche), Topic 3 (pillars/funnel/cadence), Topic 4 (pricing), Topic 5 (roadmap/moderation), and Topic 6 (hard-vs-flexible classification) answers captured here.

- [ ] **Step 1: Append the interview (Step 1) and doc-writing (Step 2) sections**

Append to `.claude/skills/setup/SKILL.md`:

```markdown
## Step 1: Run the interview

Ask the following seven topics **one question at a time** — never bundle multiple topics into one prompt. Prefer `AskUserQuestion` (multiple-choice, optionally multiSelect) when the answer space is enumerable; use a plain open-ended question when the answer is genuinely free-form prose (a niche statement, a persona description).

After capturing each topic's answer, briefly reflect it back in 1-2 sentences ("Got it — so the niche is X, aimed at Y") before moving to the next topic, so the author can correct a misunderstanding immediately.

### Topic 1: Identity & niche

Open-ended question: "In plain language, what does this business sell/publish, and for whom? What makes it different from a generic lifestyle store?"

Capture: an explicit niche statement (2-4 sentences). This becomes new framing content for `docs/CONSTITUTION.md` (see Step 3) — today no agent-visible file states the niche; several agents (e.g. `monetization-scout`) currently fall back to inferring it from content.

### Topic 2: Audience & brand voice

Open-ended question: "Who's the target reader/customer — describe them like a persona. And what tone should the brand's writing have (give a few adjectives or examples)?"

Capture: audience persona (age/interests/shopping habits as relevant) + 3-5 tone adjectives or example phrases. Feeds the `content-strategist` and `community-builder` agent stubs (drafted in this skill's Step 3, built in this plan's Task 3).

### Topic 3: Content strategy

Ask via `AskUserQuestion` (multiSelect: true) for content pillars:
Question: "Beyond recipes, what other content pillars should this site cover?"
Options: "Kitchen/tool reviews", "Entertaining & hosting guides", "Behind-the-scenes/brand story", "Seasonal roundups" (author can also type a custom pillar via "Other")

Then open-ended follow-up: "How tightly should content need to funnel toward a product — should every post link to something purchasable, or is some content fine to exist just for engagement?"

Then open-ended: "The current assumption is ~26 posts every 6 months (`docs/RULES.md` #4). Keep that, or is there a cadence you'd actually prefer?"

Capture: content pillars list, funnel-intensity philosophy, cadence preference (keep default or new number). Feeds the `content-strategist` agent stub; the cadence answer feeds a possible new `docs/RULES.md` entry.

### Topic 4: Product & fulfillment

Open-ended question: "What are the core product categories, in priority order?"

Then `AskUserQuestion` (single-select) for fulfillment model:
Question: "What's the fulfillment model for these products?"
Options: "Owned inventory (buy stock, ship yourself)", "Dropship (supplier ships direct to customer)", "Print-on-demand", "Hybrid — depends on the product line"

Then open-ended: "What's the pricing philosophy — budget/value, premium/curated, or somewhere in between? And is there a 'sets'/bundles strategy tied to seasons or themes?"

Capture: product category priorities, fulfillment model, pricing philosophy, seasonal-sets strategy. Feeds the `store-merchandiser` agent stub.

### Topic 5: Community & engagement roadmap

Ask via `AskUserQuestion` (multiSelect: true):
Question: "Which community features are near-term real (build soon) vs. aspirational (maybe someday)? Select the ones that are near-term."
Options: "Forums", "Giveaways/raffles", "Newsletter", "Comments on posts"

Then open-ended: "As a solo owner, roughly how much moderation time can you realistically give this per week? That shapes how aggressively community features should be recommended."

Capture: near-term vs. aspirational feature split, realistic moderation capacity. Feeds the `community-builder` agent stub; may also feed a `docs/RULES.md` cadence entry.

### Topic 6: Non-negotiables vs. flexible conventions

Open-ended question: "Looking back at what we just covered (niche, voice, content, product, community) — is there anything in there that should be a hard, rarely-changing principle (goes in `docs/CONSTITUTION.md`) rather than a convention that's OK to evolve later (goes in `docs/RULES.md`)? Call out anything that qualifies, or say 'nothing, treat it all as flexible.'"

Capture: an explicit list of which prior answers (if any) are hard constitution-level principles. Drives the classification used when drafting the `docs/CONSTITUTION.md` diff in Step 3 — anything not called out here defaults to `docs/RULES.md` or plain descriptive framing.

### Topic 7: Chief-of-staff persona

Ask each of the following as its own question (mix of `AskUserQuestion` single-select and open-ended, one at a time):

1. `AskUserQuestion` (single-select): "How formal should chief-of-staff's tone be?" Options: "Direct and casual", "Professional but warm", "Blunt, no pleasantries"
2. `AskUserQuestion` (single-select): "Default verbosity?" Options: "Terse — short answers, expand only if asked", "Explanatory — walk through reasoning by default"
3. `AskUserQuestion` (single-select): "Humor tolerance?" Options: "None — keep it strictly business", "Occasional dry humor is fine", "Feel free to be playful"
4. Open-ended: "chief-of-staff already surfaces tradeoffs and risk proactively by default (that's hardcoded, not something this interview turns off) — but how much detail do you want in that surfacing: just the headline risk, or the full reasoning each time?"
5. Open-ended: "Preferred form of address, and any pet peeves — things you don't want chief-of-staff to ever do (e.g. a specific phrase you hate, a habit that annoys you)?"

Capture: tone/formality, verbosity default, humor tolerance, risk-surfacing detail level, form of address, pet peeves. Writes directly to `docs/PERSONA.md` (Step 2) — no approval gate, since this is author-authored-via-interview content.

## Step 2: Write docs/BUSINESS-PLAN.md and docs/PERSONA.md directly

Once every topic in scope for this run (all seven on a first run or "start over"; only the selected ones on a "revise specific sections" run) has been answered and reflected back, write the two docs. These are written directly — no separate approval gate, since they're new/author-authored content via the interview itself.

**Do not write anything in this step if the author abandons the interview before every in-scope topic is answered.** A half-finished session leaves no half-written doc behind.

**`docs/BUSINESS-PLAN.md`** — organize by topic, using this structure (fill in the actual captured answers; this is a template, not literal text to copy verbatim):

```markdown
# LHR Business Plan

Captured via /setup on <today's date, e.g. 2026-07-13>. Re-run /setup to revise.

## Identity & Niche

<Topic 1 answer>

## Audience & Brand Voice

<Topic 2 answer>

## Content Strategy

- Pillars: <Topic 3 pillar list>
- Funnel intensity: <Topic 3 funnel answer>
- Cadence: <Topic 3 cadence answer, or "~26 posts/6 months (unchanged)">

## Product & Fulfillment

- Core categories (priority order): <Topic 4 categories>
- Fulfillment model: <Topic 4 fulfillment model>
- Pricing philosophy: <Topic 4 pricing answer>
- Seasonal/sets strategy: <Topic 4 sets answer>

## Community & Engagement Roadmap

- Near-term: <Topic 5 near-term features>
- Aspirational: <Topic 5 features not selected as near-term>
- Realistic moderation capacity: <Topic 5 capacity answer>

## Non-Negotiables vs. Flexible Conventions

<Topic 6 answer — explicit list of what's hard-constitution-level vs. flexible-rules-level, or "Nothing flagged; treat all of the above as flexible.">
```

On a "revise specific sections" rerun, keep the untouched `##` sections' text byte-for-byte from the existing file and only replace the sections for topics the author selected to redo.

**`docs/PERSONA.md`** — write from Topic 7:

```markdown
# Chief-of-Staff Persona

Captured via /setup on <today's date>. Re-run /setup to revise.

- **Tone/formality:** <answer 1>
- **Default verbosity:** <answer 2>
- **Humor tolerance:** <answer 3>
- **Risk/tradeoff surfacing detail:** <answer 4> (note: chief-of-staff always surfaces tradeoffs/risk — this tunes how much detail, not whether)
- **Form of address / pet peeves:** <answer 5>
```

`docs/PERSONA.md` is referenced today by `.claude/agents/chief-of-staff.md` line 12 as a dangling "if it exists" check; once this step runs, it exists and that file's persona-loading instruction takes effect.
```

- [ ] **Step 2: Re-seed the fixture**

```bash
rm -rf /tmp/lhr-setup-skill-test
mkdir -p /tmp/lhr-setup-skill-test/docs /tmp/lhr-setup-skill-test/.claude/agents
cp docs/CONSTITUTION.md docs/RULES.md /tmp/lhr-setup-skill-test/docs/
cp .claude/agents/community-builder.md .claude/agents/content-strategist.md .claude/agents/store-merchandiser.md .claude/agents/chief-of-staff.md /tmp/lhr-setup-skill-test/.claude/agents/
```

- [ ] **Step 3: Dry-run the full interview with scripted sample answers, write the resulting docs by hand**

Using these sample answers, hand-trace Step 1 + Step 2 and write the resulting file exactly as the template + answers would produce:

- Topic 1: "We sell curated kitchenware and publish recipes/entertaining content for people who host dinner parties often but don't consider themselves foodies. Different from a generic lifestyle store because every product is tied to a specific recipe or hosting scenario, not sold standalone."
- Topic 2: "Home cooks aged 30-50 who host 2-4 dinners a month. Tone: warm, a little funny, never preachy."
- Topic 3: pillars = ["Entertaining & hosting guides", "Seasonal roundups"], funnel = "most posts should link to a product, but some pure how-to content is fine", cadence = "keep the ~26/6-months default"
- Topic 4: categories = "1) serveware 2) small-batch pantry goods 3) linens", fulfillment = "Hybrid — depends on the product line", pricing = "premium/curated, sets tied to seasons (fall dinner party set, holiday set)"
- Topic 5: near-term = ["Newsletter", "Comments on posts"], aspirational = "Forums, Giveaways/raffles", moderation capacity = "about 2 hours/week"
- Topic 6: "Nothing flagged; treat all of the above as flexible."
- Topic 7: tone = "Professional but warm", verbosity = "Terse — short answers, expand only if asked", humor = "Occasional dry humor is fine", risk detail = "just the headline risk, expand if I ask", address/peeves = "call me Ash; never say 'circle back'"

Write `/tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md` and `/tmp/lhr-setup-skill-test/docs/PERSONA.md` by hand following the templates above with these answers substituted in.

- [ ] **Step 4: Verify structure**

```bash
grep -c '^## ' /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md
grep '^## ' /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md
grep -E '^\- \*\*' /tmp/lhr-setup-skill-test/docs/PERSONA.md | wc -l
```
Expected: first command outputs `6` (six `##` sections); second lists exactly `## Identity & Niche`, `## Audience & Brand Voice`, `## Content Strategy`, `## Product & Fulfillment`, `## Community & Engagement Roadmap`, `## Non-Negotiables vs. Flexible Conventions` in that order; third outputs `5` (five bullet fields in the persona doc).

- [ ] **Step 5: Verify mid-topic abandonment leaves no partial file**

```bash
rm -f /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md /tmp/lhr-setup-skill-test/docs/PERSONA.md
```
Re-read Step 2's opening instruction ("Do not write anything in this step if the author abandons the interview before every in-scope topic is answered") and confirm by inspection that nothing in Step 1 or Step 2 as written calls for writing any file before all in-scope topics are captured — i.e. there is no per-topic intermediate write. Confirm:
```bash
test -f /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md && echo "FILE EXISTS (bug)" || echo "correctly absent"
```
Expected: `correctly absent`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/setup/SKILL.md
git commit -m "feat: add /setup interview topics and direct doc-writing step"
```

---

### Task 3: Proposed diffs + approval gate (Step 3)

**Files:**
- Modify: `.claude/skills/setup/SKILL.md` (append after the Task 2 "## Step 2" section)
- Test: manual dry-run in `/tmp/lhr-setup-skill-test`

**Interfaces:**
- Consumes: the Topic 1/3/4/5/6 answers captured in Task 2's sample dry-run (reused here); the four target files' current content (`docs/CONSTITUTION.md`'s 6 numbered principles, `docs/RULES.md`'s 5 numbered rules, the three agent stub frontmatter shapes).
- Produces: the "Apply all / Apply none" approval gate that Task 4's `CLAUDE.md` precondition checks the outcome of.

- [ ] **Step 1: Append the proposed-diffs section**

Append to `.claude/skills/setup/SKILL.md`:

```markdown
## Step 3: Draft proposed diffs — do not write yet

Draft (but do not write to disk) changes to the following four files, based on the interview:

**`docs/CONSTITUTION.md`** — if Topic 6 flagged anything as a hard principle, draft it as a new numbered principle appended after the existing numbered principles. If Topic 6 flagged nothing, draft the Topic 1 niche statement as new descriptive framing text added near the top of the file (above principle 1), not as a numbered principle.

**`docs/RULES.md`** — draft new numbered entries (continuing the existing numbering) for whichever of these actually surfaced concrete answers in the interview: content pillars (Topic 3), funnel intensity (Topic 3), cadence if changed from the ~26/6-months default (Topic 3), pricing philosophy (Topic 4), community roadmap cadence/moderation capacity (Topic 5). Skip any that Topic 6 already promoted to `docs/CONSTITUTION.md` instead.

**`.claude/agents/community-builder.md`, `content-strategist.md`, `store-merchandiser.md`** — rewrite each stub's body (keep the existing frontmatter shape: `name`, `description`, `tools`, `model`, `memory: project`) following the same style as `.claude/agents/seo-auditor.md` and `.claude/agents/monetization-scout.md` (a short "You are a ___ for <niche>" opener, then a "What to do" or numbered "When invoked" list, grounded in the interview answers rather than generic lifestyle-brand boilerplate). Keep each stub's current tool grant (`tools: Read, Grep, Glob, WebFetch`) unless the interview surfaced a concrete need for write access — if so, name the specific new tool and why in the diff presentation so the author can see exactly what capability is being added.

Present all four proposed diffs together in one message (unified-diff style or clear before/after per file), and ask via `AskUserQuestion`:

Question: "Apply these changes to CONSTITUTION.md, RULES.md, and the three agent stubs?"
Options: "Apply all", "Apply none (keep current files, I'll re-run /setup later to revise)"

If the author wants to approve some but not others, treat that as a free-text answer (available via "Other") and apply only the ones they name.

**If approved (fully or partially):** write only the approved files via `Edit`/`Write`. `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` from Step 2 are kept regardless of this decision — they were already written and are not affected by this gate.

**If declined entirely:** write nothing from this step. `docs/BUSINESS-PLAN.md` and `docs/PERSONA.md` remain as written in Step 2. Skip Step 4 entirely and end the skill here, telling the author they can re-run `/setup` later to revise and re-propose.
```

- [ ] **Step 2: Re-seed the fixture and place the sample business plan from Task 2**

```bash
rm -rf /tmp/lhr-setup-skill-test
mkdir -p /tmp/lhr-setup-skill-test/docs /tmp/lhr-setup-skill-test/.claude/agents
cp docs/CONSTITUTION.md docs/RULES.md /tmp/lhr-setup-skill-test/docs/
cp .claude/agents/community-builder.md .claude/agents/content-strategist.md .claude/agents/store-merchandiser.md .claude/agents/chief-of-staff.md /tmp/lhr-setup-skill-test/.claude/agents/
```
Re-create `/tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md` using the same sample answers from Task 2 Step 3 (niche: curated kitchenware + recipes/entertaining content for frequent-but-not-foodie hosts; pillars: hosting guides + seasonal roundups; pricing: premium/curated with seasonal sets; Topic 6: nothing flagged as hard).

- [ ] **Step 3: Hand-draft the CONSTITUTION.md diff and verify it lands as framing, not a numbered principle**

Since the sample Topic 6 answer was "nothing flagged," hand-trace Step 3's `CONSTITUTION.md` instruction: the niche statement must be drafted as descriptive framing above principle 1, not as a new numbered principle. Draft it:

```bash
cat /tmp/lhr-setup-skill-test/docs/CONSTITUTION.md
```
Confirm the current file starts with `# LHR Constitution` followed by numbered principles 1-6. Hand-write the proposed new top (do not save yet — this only tests the drafting logic, not the write, which is gated):
```markdown
# LHR Constitution

This site sells curated kitchenware and publishes recipes/entertaining content for people who host dinner parties often but don't consider themselves foodies.

These principles never change without extraordinary explicit override. Any agent (human-directed or autonomous) working on this project must follow them at all times.

1. A post never goes live without the author's explicit confirmation — no autonomous auto-publish.
...
```
Confirm by inspection: no new numbered item was added (since Topic 6 flagged nothing), only prose framing was inserted.

- [ ] **Step 4: Hand-draft the RULES.md diff**

```bash
cat /tmp/lhr-setup-skill-test/docs/RULES.md
```
Confirm current file ends at rule 5. Hand-draft new rules 6+ from the sample answers (pillars, funnel intensity, pricing, moderation capacity — cadence is skipped since the sample kept the default):
```markdown
6. Content pillars include hosting/entertaining guides and seasonal roundups, in addition to recipes.
7. Most posts should link to a purchasable product, but pure how-to content without a product tie-in is acceptable.
8. Pricing philosophy is premium/curated, with seasonal product sets (e.g. a fall dinner-party set, a holiday set).
9. Newsletter and post comments are near-term community features; forums and giveaways/raffles are aspirational. Realistic solo-owner moderation capacity is ~2 hours/week — size community feature recommendations accordingly.
```
Confirm by inspection that numbering continues from 5 and that no cadence rule was added (sample kept the default).

- [ ] **Step 5: Hand-draft one agent stub diff (store-merchandiser) and verify frontmatter is preserved**

```bash
cat /tmp/lhr-setup-skill-test/.claude/agents/store-merchandiser.md
```
Hand-draft the replacement body, keeping frontmatter identical (`name: store-merchandiser`, `tools: Read, Grep, Glob`, `model: sonnet`, `memory: project`) and grounding the body in the sample Topic 4 answers (categories: serveware > pantry goods > linens; hybrid fulfillment; premium/curated pricing; seasonal sets). Confirm by inspection: frontmatter fields unchanged, body no longer generic ("lifestyle brand") but references the actual sample categories and sets strategy.

- [ ] **Step 6: Verify the decline path**

Re-read Step 3's decline branch: confirm it says to write nothing and to leave the already-written `BUSINESS-PLAN.md`/`PERSONA.md` untouched. Check:
```bash
test -f /tmp/lhr-setup-skill-test/docs/BUSINESS-PLAN.md && echo "business plan kept" || echo "BUG: business plan missing"
diff <(cat /tmp/lhr-setup-skill-test/docs/CONSTITUTION.md) docs/CONSTITUTION.md
diff <(cat /tmp/lhr-setup-skill-test/docs/RULES.md) docs/RULES.md
```
Expected: `business plan kept`, and both `diff`s produce no output (files unchanged from the original repo copies, since nothing was actually written in this manual trace — only drafted).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/setup/SKILL.md
git commit -m "feat: add /setup proposed-diff drafting and approval gate"
```

---

### Task 4: Root CLAUDE.md creation (Step 4)

**Files:**
- Modify: `.claude/skills/setup/SKILL.md` (append after the Task 3 "## Step 3" section)
- Test: manual dry-run in `/tmp/lhr-setup-skill-test`

**Interfaces:**
- Consumes: the approval outcome from Task 3's Step 3 gate ("Apply all" / partial / "Apply none").
- Produces: the root `CLAUDE.md` bootstrap content, consumed by Task 5's close-out summary (which reports whether this step ran).

- [ ] **Step 1: Append the CLAUDE.md creation section**

Append to `.claude/skills/setup/SKILL.md`:

```markdown
## Step 4: Create the root CLAUDE.md (final step)

**Precondition:** only run this step if every diff proposed in Step 3 was approved and successfully written (a full "Apply all", or a partial approval where every file the author named was written without error). If anything in Step 3 was declined or failed to write, stop after Step 3 — do not create `CLAUDE.md`.

Check whether a root `CLAUDE.md` already exists (Glob `CLAUDE.md` at repo root).

- **Doesn't exist** (expected on first successful run): create it with this content:

```markdown
# LHR Project Instructions

Every session in this project should operate as the `chief-of-staff` agent by default.

At the start of the session:
1. Read `.claude/agents/chief-of-staff.md` and adopt its role, tool access, and "How you work" behavior for this entire session.
2. Read `docs/PERSONA.md` and adopt the tone/voice it defines.
3. Route any nontrivial request through the roster in `.claude/agents/*.md` the same way `chief-of-staff.md` describes, rather than acting as a generic assistant.
```

- **Already exists** (a rerun after a prior successful `/setup`): read the existing content; if it already contains this chief-of-staff bootstrap instruction, leave it unchanged and tell the author so. If it exists but doesn't yet contain it (e.g. the author wrote a `CLAUDE.md` by hand in between runs), show the author the proposed addition and ask before appending — don't silently overwrite author-written content.
```

- [ ] **Step 2: Verify the "declined diffs → no CLAUDE.md" precondition**

Reusing the Task 3 fixture state (diffs drafted but declined, nothing written):
```bash
test -f /tmp/lhr-setup-skill-test/CLAUDE.md && echo "BUG: CLAUDE.md created despite decline" || echo "correctly absent"
```
Expected: `correctly absent`. Confirm by inspection that Step 4's precondition text explicitly covers this case ("If anything in Step 3 was declined or failed to write, stop after Step 3").

- [ ] **Step 3: Verify the "approved diffs → CLAUDE.md created" path**

Simulate a full "Apply all" outcome by writing the four Step-3 diffs into the fixture (using the drafts from Task 3 Steps 3-5), then hand-trace Step 4:
```bash
test -f /tmp/lhr-setup-skill-test/CLAUDE.md && echo "already exists" || echo "does not exist yet, proceed to create"
```
Expected: `does not exist yet, proceed to create`. Write `/tmp/lhr-setup-skill-test/CLAUDE.md` using the exact template from Step 1. Verify:
```bash
grep -c "chief-of-staff" /tmp/lhr-setup-skill-test/CLAUDE.md
grep -c "docs/PERSONA.md" /tmp/lhr-setup-skill-test/CLAUDE.md
```
Expected: both commands output a nonzero count (at least one match each).

- [ ] **Step 4: Verify the "CLAUDE.md already exists and already correct" rerun path**

With `/tmp/lhr-setup-skill-test/CLAUDE.md` now present from Step 3 above, hand-trace Step 4 again as if `/setup` were rerun and fully approved a second time:
```bash
grep -q "chief-of-staff" /tmp/lhr-setup-skill-test/CLAUDE.md && echo "bootstrap present, leave unchanged" || echo "bootstrap missing, propose addition"
```
Expected: `bootstrap present, leave unchanged`. Confirm by inspection that Step 4 as written does not call for overwriting `CLAUDE.md` in this case.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/setup/SKILL.md
git commit -m "feat: add /setup gated CLAUDE.md creation step"
```

---

### Task 5: Close-out summary (Step 5) + full end-to-end trace

**Files:**
- Modify: `.claude/skills/setup/SKILL.md` (append after the Task 4 "## Step 4" section)
- Test: full manual dry-run of the entire skill, start to finish, in `/tmp/lhr-setup-skill-test`

**Interfaces:**
- Consumes: every prior step's output (which files were written/skipped/left untouched across Steps 0-4).
- Produces: nothing consumed by later tasks — this is the last section of the skill.

- [ ] **Step 1: Append the close-out section**

Append to `.claude/skills/setup/SKILL.md`:

```markdown
## Step 5: Close out

Summarize what was written this run: which of `docs/BUSINESS-PLAN.md`, `docs/PERSONA.md`, `docs/CONSTITUTION.md`, `docs/RULES.md`, the three agent stubs, and `CLAUDE.md` actually changed, and which were skipped (declined) or left untouched (rerun with unselected topics). Do not claim `CLAUDE.md` was created if Step 4 didn't run.
```

- [ ] **Step 2: Read the complete finished skill file top to bottom**

```bash
cat .claude/skills/setup/SKILL.md
```
Confirm the file now contains, in order: frontmatter, intro, Step 0 (rerun detection), Step 1 (seven topics), Step 2 (direct doc writing), Step 3 (proposed diffs + gate), Step 4 (gated CLAUDE.md), Step 5 (close-out). Confirm there are no `TBD`/`TODO`/placeholder markers:
```bash
grep -niE "TBD|TODO|placeholder|fill in|implement later" .claude/skills/setup/SKILL.md
```
Expected: no output (no matches).

- [ ] **Step 3: Full end-to-end dry run — happy path (approve everything)**

Re-seed the fixture fresh:
```bash
rm -rf /tmp/lhr-setup-skill-test
mkdir -p /tmp/lhr-setup-skill-test/docs /tmp/lhr-setup-skill-test/.claude/agents
cp docs/CONSTITUTION.md docs/RULES.md /tmp/lhr-setup-skill-test/docs/
cp .claude/agents/community-builder.md .claude/agents/content-strategist.md .claude/agents/store-merchandiser.md .claude/agents/chief-of-staff.md /tmp/lhr-setup-skill-test/.claude/agents/
```
Using the same sample answers as Task 2 Step 3, hand-trace the entire skill start to finish: Step 0 (no business plan → first run) → Step 1 (all seven topics) → Step 2 (write `BUSINESS-PLAN.md` + `PERSONA.md`, from Task 2) → Step 3 (draft + approve "Apply all", write `CONSTITUTION.md`/`RULES.md`/all three stubs, from Task 3) → Step 4 (write `CLAUDE.md`, from Task 4) → Step 5 (summarize).

Verify every file landed:
```bash
for f in docs/BUSINESS-PLAN.md docs/PERSONA.md docs/CONSTITUTION.md docs/RULES.md .claude/agents/community-builder.md .claude/agents/content-strategist.md .claude/agents/store-merchandiser.md CLAUDE.md; do
  test -f "/tmp/lhr-setup-skill-test/$f" && echo "OK: $f" || echo "MISSING: $f"
done
```
Expected: `OK:` for all eight paths.

- [ ] **Step 4: Full end-to-end dry run — decline path**

Re-seed the fixture fresh (same commands as Step 3 above), hand-trace again but this time decline the Step 3 diffs ("Apply none"). Verify:
```bash
for f in docs/BUSINESS-PLAN.md docs/PERSONA.md; do
  test -f "/tmp/lhr-setup-skill-test/$f" && echo "kept: $f" || echo "BUG missing: $f"
done
for f in docs/CONSTITUTION.md docs/RULES.md .claude/agents/community-builder.md .claude/agents/content-strategist.md .claude/agents/store-merchandiser.md CLAUDE.md; do
  test -f "/tmp/lhr-setup-skill-test/$f" && [ -z "$(diff /tmp/lhr-setup-skill-test/$f 2>/dev/null)" ] && echo "unchanged/absent: $f" || true
done
diff /tmp/lhr-setup-skill-test/docs/CONSTITUTION.md docs/CONSTITUTION.md && echo "CONSTITUTION unchanged"
diff /tmp/lhr-setup-skill-test/docs/RULES.md docs/RULES.md && echo "RULES unchanged"
test -f /tmp/lhr-setup-skill-test/CLAUDE.md && echo "BUG: CLAUDE.md created" || echo "correctly absent"
```
Expected: `kept:` for both business-plan/persona files, `CONSTITUTION unchanged`, `RULES unchanged`, and `correctly absent` for `CLAUDE.md`.

- [ ] **Step 5: Clean up the scratch fixture**

```bash
rm -rf /tmp/lhr-setup-skill-test
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/setup/SKILL.md
git commit -m "feat: add /setup close-out summary, completing the skill"
```

---

## Post-Plan Note (not a task — informational)

Per the design spec, refreshing the assistant's cross-session memory notes that currently flag the niche as "not yet documented" (`project_site_niche_and_model`, `project_subagents_overview`) is explicitly **out of scope for the skill** — that's the orchestrating assistant's job immediately after a real `/setup` run completes, not a repo-file concern for this plan.
