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
