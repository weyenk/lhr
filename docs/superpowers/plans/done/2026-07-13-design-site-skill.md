# `/design-site` Skill Implementation Plan

**Status:** Done — merged via PR #6/#7; `.claude/skills/design-site/SKILL.md` and `docs/BRAND.md` exist on `main`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `.claude/skills/design-site/SKILL.md`, a rerunnable `/design-site` interview that walks the site's author through eleven brand/layout topics — kitchen-grounded palette, tone, typography, wordmark/logo/iconography, a shared grid/spacing/mobile baseline, and layout intent for all six planned pages — writing each topic's answer directly into `docs/BRAND.md` as it's captured.

**Architecture:** A single markdown skill file (instructions an LLM follows, not executable code), per the `.claude/skills/` convention already used by `.claude/skills/setup/SKILL.md`. Unlike `/setup` (which writes its output docs once, only after every topic in scope is answered), `/design-site` writes `docs/BRAND.md` incrementally — one topic's section per completed topic — so an abandoned session keeps whatever was already decided. The file is built up across five sequential sections (Step 0, then Step 1's eleven topics in four batches, then Step 2), each task producing its own reviewable, testable diff. Because the deliverable is a prompt, most "tests" are manual dry-run traces against a scratch fixture (`mktemp`-style, under `/tmp`) with scripted sample answers — but the WCAG contrast-baseline logic (Task 2) gets an actual runnable check, since contrast ratio is real, verifiable math, not prose.

**Tech Stack:** Markdown skill file (Claude Code skill format), no application code involved. Testing uses `bash`/`diff`/`grep` and a small `python3` contrast-ratio script against a scratch directory, so the real repo's `docs/BRAND.md` (which doesn't exist yet) is never touched during implementation or testing.

## Global Constraints

- Skill lives at `.claude/skills/design-site/SKILL.md`, invoked as `/design-site`. (spec §2)
- Tools the skill uses: `Read`, `Write`, `Edit`, `Glob`, `AskUserQuestion`, `WebFetch`, and the visual companion. (spec §2)
- Questions are asked **one at a time**. (spec §2, §3)
- The visual companion is offered once, the first time a *(visual companion)* topic comes up; if declined, every later visual topic falls back to text-described options instead of generated mockups. (spec §2, §5)
- `docs/BRAND.md` is written **directly, one topic's section at a time, as the interview proceeds** — no separate approval gate. (spec §2, §3)
- Topic order is fixed: Kitchen grounding & mood → Palette → Tone & imagery direction → Typography → Wordmark/logo/iconography → Grid/spacing/mobile layout → Home/listing → Recipe post → Article post → Product/shop listing → About & community. (spec §3)
- Kitchen-photo anchors inform palette **mood/undertone**, never literal hex-sampling. (spec §3, Topic 1)
- Every palette candidate must pass WCAG AA (4.5:1 text, 3:1 UI) before being presented as an option; if none pass, adjust rather than offer a failing choice. (spec §3 Topic 2, §5)
- Every palette includes semantic state colors (error, sold-out, sale/discount) distinct from brand colors. (spec §3 Topic 2, §4)
- Voice/tone is discovered fresh from the author — never inferred from existing (placeholder) site content. (spec §3 Topic 3)
- Wordmark/Logo/Iconography and all six page-layout sections depend on Palette and Typography; rerunning with Palette/Typography selected must prompt whether dependents should be re-reviewed too, and flag them as stale if not. (spec §2, §4, §5)
- Rerunning `/design-site` when `docs/BRAND.md` already exists must ask start-over vs. revise-specific-sections — never silently overwrite. (spec §2)
- If the author abandons mid-interview, finished sections stay written and unfinished ones are simply absent — never a half-written section. (spec §5)
- No implementation work (CSS, Astro components, production logo art), no financial/legal/business questions, no designing content for pages with no content model beyond structural intent. (spec, Out of Scope)

---

## File Structure

- Create: `.claude/skills/design-site/SKILL.md` — the entire skill. Built incrementally across Tasks 1–6, each task appending one complete section, so each task has its own reviewable, testable diff.

No other repository files are modified by this plan — `docs/BRAND.md` itself is produced by **running** the finished skill, not by this plan. This plan only builds the skill.

---

### Task 1: Scaffold + Step 0 (rerun detection with dependency cascade) + section-writing mechanics

**Files:**
- Create: `.claude/skills/design-site/SKILL.md`
- Test: manual dry-run in a scratch directory (no automated test file)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the skill's frontmatter (`name: design-site`, `description: ...`); the visual-companion offer text; the eleven-topic name list used verbatim in Step 0's "revise specific sections" `AskUserQuestion` (`"Kitchen grounding & mood", "Palette", "Tone & imagery direction", "Typography", "Wordmark, logo & iconography", "Grid, spacing & mobile layout", "Home / listing page layout", "Recipe post layout", "Article post layout", "Product / shop listing page layout", "About & community page layout"`); the "Writing docs/BRAND.md sections" upsert-by-heading rule that every later task's topics rely on to write their section.

- [ ] **Step 1: Create the skill file with frontmatter, visual companion guidance, Step 0, and the section-writing rule**

Create `.claude/skills/design-site/SKILL.md`:

```markdown
---
name: design-site
description: One-time, rerunnable interview that walks the site's author through brand fundamentals (kitchen-grounded palette, tone, typography, wordmark/logo/iconography), a shared grid/spacing/mobile baseline, and layout intent for every planned page, producing docs/BRAND.md. Invoke as /design-site.
---

# /design-site — Visual & Brand Design Interview

Walks the author through an eleven-topic interview and writes the results directly to `docs/BRAND.md`. This is the one-time (but rerunnable) interview described in `docs/superpowers/specs/done/2026-07-13-design-site-skill-design.md`. The skill only ever produces `docs/BRAND.md` — it never writes CSS, Astro components, or invokes any implementation skill.

**Tools this skill uses:** Read, Write, Edit, Glob, AskUserQuestion, WebFetch, and the visual companion (see below).

## Using the visual companion

Several topics below are marked *(visual companion)*. The first time one of those topics comes up, offer the companion as its own message, before asking anything else that topic needs:

> "This next part might be easier if I show you — I can put together mockups, swatches, and comparisons in a browser tab as we go. It's still new and can be token-intensive. Want me to? I'll open it for you."

**If accepted:** start the server (`scripts/start-server.sh --project-dir <repo root> --open`, per the `superpowers:brainstorming` visual-companion guide) and use it for this and every later *(visual companion)* topic — write real options (swatches, font samples, wireframes, directional logo concepts) to a new file in `screen_dir` each time, and read `state_dir/events` on the next turn for the author's selection, combined with their terminal reply.

**If declined**, or if the server becomes unreachable mid-interview: fall back to describing 2-3 options in text for that topic and every later *(visual companion)* topic. Don't re-offer once declined.

## Step 0: Check for an existing design doc

Check whether `docs/BRAND.md` exists (Glob or Read).

- **Doesn't exist** → this is a first run. Proceed to "Step 1: Run the interview" with all eleven topics in order.
- **Exists** → this is a rerun. Ask the author, via `AskUserQuestion`:

  Question: "docs/BRAND.md already exists. How do you want to proceed?"
  Options:
  - "Start over" — re-run all eleven topics from scratch, overwriting the existing doc section-by-section as each topic completes.
  - "Revise specific sections" — show the topic list below and let the author multi-select which topics to redo. Read the existing `docs/BRAND.md` first so untouched sections' existing content is preserved verbatim.

  If "Revise specific sections": ask a second `AskUserQuestion` (multiSelect: true) listing the eleven topic names, in this order: "Kitchen grounding & mood", "Palette", "Tone & imagery direction", "Typography", "Wordmark, logo & iconography", "Grid, spacing & mobile layout", "Home / listing page layout", "Recipe post layout", "Article post layout", "Product / shop listing page layout", "About & community page layout". Only run Step 1 for the topics selected; every other topic's section is left byte-for-byte unchanged in the final doc.

  **Dependency cascade:** if "Palette" and/or "Typography" is among the selected topics, ask one more `AskUserQuestion` (multiSelect: true): "Palette/Typography feeds Wordmark, Logo & Iconography and all six page-layout sections. Re-review any of those too?" Options: "Wordmark, logo & iconography", "Home / listing page layout", "Recipe post layout", "Article post layout", "Product / shop listing page layout", "About & community page layout" (author can select none). Add whichever are selected to this run's set of topics.

  For any dependent section the author does **not** select for re-review, add (or update) a one-line note at the very top of that section's existing content: `> Note: last decided against a Palette/Typography that has since changed (revised <today's date>).` — so staleness is visible in the doc, not silently hidden.

## Writing docs/BRAND.md sections

Each topic below produces one `##` section (the six page-layout topics instead each produce one `###` subsection under a shared `## Page Layouts` heading). As soon as a topic's question(s) are answered and reflected back to the author, write that section immediately — don't wait for the whole interview to finish. This is deliberate: if the author abandons partway through, finished sections stay and unfinished ones are simply absent, rather than losing everything captured so far.

To write a section:
- **If `docs/BRAND.md` doesn't exist yet:** create it starting with a `# Brand & Visual Design` title, then this topic's section.
- **If the file exists but this section doesn't yet:** append the new section after whatever sections already exist. On a fresh run this lands sections in canonical topic order automatically, since topics run in that order.
- **If the file exists and this section already exists (a "revise" rerun):** replace everything from that section's heading up to (but not including) the next heading of the same or higher level, leaving everything before and after byte-for-byte untouched.
- For the six page-layout topics specifically: the shared `## Page Layouts` heading is created once, by whichever of those topics is written first in a given run. Each topic then writes/replaces only its own `###` subsection(s) beneath it, leaving sibling subsections untouched.
```

- [ ] **Step 2: Set up the scratch test fixture**

```bash
rm -rf /tmp/lhr-design-site-skill-test
mkdir -p /tmp/lhr-design-site-skill-test/docs
ls /tmp/lhr-design-site-skill-test/docs
```
Expected: empty directory listing (no `BRAND.md` yet — first-run state).

- [ ] **Step 3: Manually trace Step 0's first-run branch**

With no `docs/BRAND.md` in the fixture, trace `.claude/skills/design-site/SKILL.md`'s Step 0 by hand: confirm the branch taken is "Doesn't exist → proceed to Step 1 with all eleven topics," not the rerun branch.

- [ ] **Step 4: Manually trace Step 0's rerun + revise-specific-sections branch**

Simulate a prior run having already written two sections:
```bash
cat > /tmp/lhr-design-site-skill-test/docs/BRAND.md << 'EOF'
# Brand & Visual Design

## Kitchen Grounding
- Environment anchor colors/materials: black granite counters, exposed red brick, warm driftwood-gray cabinetry, stainless steel appliances, matte black hardware
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): cozy industrial, editorial food photography

## Palette
- Primary/background: #F5F1EA
- Text: #2B2420
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for #2B2420 on #F5F1EA
- Semantic state colors: error #B3261E, sold-out #6B6259, sale/discount #2F6F4F
- Note on how this was chosen to harmonize with the kitchen anchors above: warm neutral base keeps the black-granite/red-brick backdrop from feeling cold on screen
EOF
```
Trace Step 0 again by hand: confirm it takes the "Exists → rerun" branch, and that choosing "Revise specific sections" would present exactly the eleven topic names listed in the skill file's second `AskUserQuestion`, in the specified order. Confirm the instructions say to **read** the existing file before rewriting anything.

- [ ] **Step 5: Manually trace the dependency-cascade sub-prompt**

Simulate the author selecting "Palette" in the revise-specific-sections list. Trace Step 0's "Dependency cascade" paragraph by hand: confirm it calls for a follow-up `AskUserQuestion` naming exactly "Wordmark, logo & iconography" plus the five page-layout-topic names (there are five *topics* producing six *subsections* — About & Community is one topic). Confirm the instructions say any dependent **not** selected gets a stale-flag note prepended to its existing section content, with the literal note text `> Note: last decided against a Palette/Typography that has since changed (revised <today's date>).`

- [ ] **Step 6: Verify the section-writing rule handles a first section, an appended section, and an in-place replace**

Using the fixture file from Step 4 (which already has `## Kitchen Grounding` and `## Palette`), hand-trace what "Writing docs/BRAND.md sections" says for three cases and confirm each is unambiguous by inspection:
1. Creating the very first section on an empty file (no existing headings to find).
2. Appending a brand-new section (e.g. `## Tone & Imagery Direction`) after the two that exist.
3. Replacing `## Palette` in place during a revise rerun — confirm the rule says to stop replacing at the next heading of the same-or-higher level (i.e. it would stop before a following `## Tone & Imagery Direction`, not swallow it).

- [ ] **Step 7: Clean up before the next task's test re-seeds the fixture**

```bash
rm -rf /tmp/lhr-design-site-skill-test
```

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/design-site/SKILL.md
git commit -m "feat: scaffold /design-site skill with rerun detection and section-writing rule"
```

---

### Task 2: Topics 1–2 (Kitchen grounding & mood, Palette)

**Files:**
- Modify: `.claude/skills/design-site/SKILL.md` (append after the Task 1 "## Writing docs/BRAND.md sections" content)
- Test: manual dry-run + a runnable WCAG contrast-ratio check, in `/tmp/lhr-design-site-skill-test`

**Interfaces:**
- Consumes: the section-writing rule from Task 1.
- Produces: the `## Kitchen Grounding` and `## Palette` section templates that Tasks 3–5's sections are appended after; the "environment anchor colors/materials" text that Topic 2 (and, per the spec, the imagery-treatment part of Topic 3) reads back.

- [ ] **Step 1: Append the "Step 1: Run the interview" heading and Topics 1–2**

Append to `.claude/skills/design-site/SKILL.md`:

```markdown
## Step 1: Run the interview

Ask the following eleven topics **one question at a time** — never bundle multiple topics into one prompt. After capturing each topic's answer(s) and reflecting them back in 1-2 sentences, write that topic's section immediately (per "Writing docs/BRAND.md sections" above), then move to the next topic.

### Topic 1: Kitchen grounding & mood *(photos + text)*

Ask the author to share photos of the actual space her content is/will be photographed in. If none are available, ask her to describe it in words instead (materials, colors, lighting).

From the photos (or description), name back what you observe as fixed environmental colors/materials — for example: "I'm seeing black granite counters, exposed red brick, warm gray-driftwood cabinet fronts, stainless steel appliances, and matte black fixtures." Confirm this reading with the author before moving on; correct it if she says something's off.

Then ask, as a secondary question: "Any reference sites or brands whose vibe you want, plus a few mood adjectives?" If she names sites, `WebFetch` them and note back what you see (color tendencies, type feel, density, photography style) — this is flavor, not a constraint the way the kitchen anchors are.

**Capture:** environment anchor colors/materials (primary input), reference sites/mood adjectives (secondary). Write the `## Kitchen Grounding` section:

```markdown
## Kitchen Grounding
- Environment anchor colors/materials: <observed anchors, from photos or description>
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): <captured answer, or "None given">
```

### Topic 2: Palette *(visual companion)*

Generate 2-3 candidate palettes (primary, accent, background, text roles, each a hex value) that complement the Topic 1 anchor mood — e.g. anchors like black granite / red brick / warm gray wood call for warm neutrals with a grounded accent, not a palette that fights them.

**Before presenting any candidate**, check its text/background pairing against WCAG AA: text-on-background must be ≥4.5:1, and any UI element (buttons, borders) against its background must be ≥3:1. If a candidate fails, adjust the failing role (lighten/darken it) until it passes, or drop that candidate — never present a failing palette as a choice. If **every** candidate fails after adjustment attempts, generate new candidates rather than offering a known-bad option.

Add semantic state colors to every candidate — error, sold-out, sale/discount — distinct from the brand colors, so status is never conveyed by brand-accent color alone.

Present the passing candidates via the visual companion as swatch cards; the author picks one or asks for a tweak.

**Capture:** the chosen palette's roles + hex values, its contrast-check result, its semantic colors, and the harmonization reasoning. Write the `## Palette` section:

```markdown
## Palette
- Primary/background: <hex>
- Text: <hex>
- Accent: <hex> — <role/usage>
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for <text hex> on <background hex>
- Semantic state colors: error <hex>, sold-out <hex>, sale/discount <hex>
- Note on how this was chosen to harmonize with the kitchen anchors above: <reasoning>
```
```

- [ ] **Step 2: Re-seed the scratch fixture**

```bash
rm -rf /tmp/lhr-design-site-skill-test
mkdir -p /tmp/lhr-design-site-skill-test/docs
```

- [ ] **Step 3: Write the contrast-ratio check script**

Create `/tmp/lhr-design-site-skill-test/contrast.py`:

```python
import sys

def linearize(c):
    c = c / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

def luminance(hex_color):
    hex_color = hex_color.lstrip('#')
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = linearize(r), linearize(g), linearize(b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast_ratio(hex1, hex2):
    l1, l2 = luminance(hex1), luminance(hex2)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)

if __name__ == "__main__":
    ratio = contrast_ratio(sys.argv[1], sys.argv[2])
    print(f"{ratio:.2f}")
```

- [ ] **Step 4: Verify a palette that should pass the contrast baseline**

```bash
python3 /tmp/lhr-design-site-skill-test/contrast.py F5F1EA 2B2420
```
Expected: `13.45` (well above the 4.5:1 text baseline — this is the sample "warm linen background / near-black warm-brown text" pairing this task's dry run uses as the chosen palette).

- [ ] **Step 5: Verify a palette that should fail the contrast baseline (confirming the skill's reject-and-adjust instruction has something real to reject)**

```bash
python3 /tmp/lhr-design-site-skill-test/contrast.py A69C8E C1613D
```
Expected: `1.53` (a mid-tone warm gray background with a terracotta-on-terracotta-ish text color — well under 4.5:1). Confirm by inspection: Topic 2's instructions, applied to this pairing, would require adjusting or dropping this candidate rather than presenting it — this is what "never present a failing palette as a choice" means in practice.

- [ ] **Step 6: Dry-run Topic 1 with sample answers, write the resulting section**

Sample answers (reused by every later task in this plan):
- Kitchen photos show: black granite counters, exposed red brick, warm driftwood-gray cabinet fronts, stainless steel appliances, matte black fixtures, warm under-cabinet lighting.
- Mood/reference: "cozy industrial, editorial food photography — something like a Milk Street or Bon Appétit test-kitchen feel."

Write `/tmp/lhr-design-site-skill-test/docs/BRAND.md` by hand, following the Topic 1 template with these answers substituted in (this is the file's first content — no prior heading to append after).

- [ ] **Step 7: Dry-run Topic 2 with sample answers, append the resulting section**

Sample answer: chosen palette is background `#F5F1EA`, text `#2B2420` (the passing pair verified in Step 4), accent `#9C3B1F` (a deep terracotta), semantic colors error `#B3261E`, sold-out `#6B6259`, sale/discount `#2F6F4F`.

Append the `## Palette` section (per the template) to the same file, using these values and referencing the Step 4 contrast result.

- [ ] **Step 8: Verify both sections landed, in order, with nothing lost**

```bash
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep "literal hex-sampling" /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep "WCAG AA" /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: first command outputs `2`; second lists `## Kitchen Grounding` then `## Palette`, in that order; third and fourth each produce one matching line (confirming the mood-not-extraction note and the contrast-check note both made it into the file).

- [ ] **Step 9: Verify the in-place replace behavior on a simulated "revise Palette only" rerun**

```bash
cp /tmp/lhr-design-site-skill-test/docs/BRAND.md /tmp/lhr-design-site-skill-test/docs/BRAND.md.before
```
Hand-trace a "revise Palette only" rerun: replace only the `## Palette` section's content with a new palette (e.g. swap the accent to `#7A4A2E`), per the section-writing rule from Task 1 (replace from `## Palette` up to the next `##`-or-higher heading — here, end of file, since Palette is currently last).
```bash
diff <(head -6 /tmp/lhr-design-site-skill-test/docs/BRAND.md) <(head -6 /tmp/lhr-design-site-skill-test/docs/BRAND.md.before)
```
Expected: no output (the `## Kitchen Grounding` section, lines 1-6, is byte-for-byte unchanged by a Palette-only revision).

- [ ] **Step 10: Clean up before the next task's test re-seeds the fixture**

```bash
rm -f /tmp/lhr-design-site-skill-test/docs/BRAND.md.before
```

- [ ] **Step 11: Commit**

```bash
git add .claude/skills/design-site/SKILL.md
git commit -m "feat: add /design-site kitchen-grounding and palette topics with WCAG contrast check"
```

---

### Task 3: Topics 3–4 (Tone & imagery direction, Typography)

**Files:**
- Modify: `.claude/skills/design-site/SKILL.md` (append after the Task 2 "Topic 2: Palette" content)
- Test: manual dry-run in `/tmp/lhr-design-site-skill-test`

**Interfaces:**
- Consumes: the section-writing rule (Task 1); the sample Kitchen Grounding/Palette answers (Task 2) as prior context Typography's sample voice/tone builds on.
- Produces: the `## Tone & Imagery Direction` and `## Typography` section templates (the latter carrying a `*Depends on: Tone & Imagery Direction*` note) that Task 4's Wordmark/Logo/Iconography topic depends on.

- [ ] **Step 1: Append Topics 3–4**

Append to `.claude/skills/design-site/SKILL.md`:

```markdown
### Topic 3: Tone & imagery direction *(text)*

Voice is discovered **fresh** — never inferred from existing site content, since the current posts (e.g. "Jerk Chicken for a Crowd") are placeholder seed data, not an established authored voice. Ask, one at a time:

1. "Give me a few adjectives for how the writing should sound."
2. "Any writers or publications whose voice you admire, even loosely?"
3. Optional: "If you want, give me one sample sentence in the voice you're going for."
4. "What's the photography style — natural light or staged, minimal styling or busy, candid mid-action shots or composed stills? Keep this grounded in what's actually achievable in your kitchen space from Topic 1."
5. "Any imagery treatment beyond the shot itself — a preferred crop ratio, a color-grading/filter approach — that would help reconcile real photos with the palette we just picked?"

**Capture:** voice adjectives, admired writers/publications, optional sample sentence, photography style, imagery post-processing/treatment. Write the `## Tone & Imagery Direction` section:

```markdown
## Tone & Imagery Direction
- Voice adjectives: <captured answer>
- Admired writers/publications: <captured answer, or "None given">
- Sample sentence: <captured answer, or "None given">
- Photography style: <captured answer>, grounded in the actual kitchen space from Kitchen Grounding
- Imagery post-processing/treatment: <captured answer>
```

### Topic 4: Typography *(visual companion)*

Generate 2-3 heading/body font pairings, chosen to match the voice/tone from Topic 3 — not picked before it. Show each pairing with real sample text: the site name, a sample headline, and a line of sample body copy.

**Capture:** the chosen heading font (family + fallback stack + any weight/case notes) and body font (family + fallback stack). Write the `## Typography` section:

```markdown
## Typography
- Heading font: <family>, fallback stack `<fallback stack>` — <weight/case notes, if any>
- Body font: <family>, fallback stack `<fallback stack>`
- Scale notes: <any size-relationship notes surfaced, or "None captured">
- *Depends on: Tone & Imagery Direction*
```
```

- [ ] **Step 2: Re-seed the fixture with Task 2's finished sections**

```bash
rm -rf /tmp/lhr-design-site-skill-test
mkdir -p /tmp/lhr-design-site-skill-test/docs
cat > /tmp/lhr-design-site-skill-test/docs/BRAND.md << 'EOF'
# Brand & Visual Design

## Kitchen Grounding
- Environment anchor colors/materials: black granite counters, exposed red brick, warm driftwood-gray cabinetry, stainless steel appliances, matte black hardware, warm under-cabinet lighting
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): cozy industrial, editorial food photography — something like a Milk Street or Bon Appétit test-kitchen feel

## Palette
- Primary/background: #F5F1EA
- Text: #2B2420
- Accent: #9C3B1F — buttons, links, callouts
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for #2B2420 on #F5F1EA
- Semantic state colors: error #B3261E, sold-out #6B6259, sale/discount #2F6F4F
- Note on how this was chosen to harmonize with the kitchen anchors above: warm neutral base keeps the black-granite/red-brick backdrop from feeling cold on screen
EOF
```

- [ ] **Step 3: Dry-run Topic 3 with sample answers, append the resulting section**

Sample answers:
- Voice adjectives: "warm, unfussy, a little wry"
- Admired: "Milk Street, Alison Roman's newsletter"
- Sample sentence: "This is the platter that survives the party."
- Photography style: "natural light near the arched window, minimal styling, candid mid-cook shots — nothing overly staged"
- Imagery treatment: "4:5 crop for feed/social parity; a warm-neutral color grade to unify the granite/brick backdrop across shoots"

Append the `## Tone & Imagery Direction` section using these answers.

- [ ] **Step 4: Dry-run Topic 4 with sample answers, append the resulting section**

Sample answer: heading font "Fraunces" (serif, warm/editorial — matches "warm, unfussy" voice), fallback stack `Georgia, serif`; body font "Inter", fallback stack `-apple-system, BlinkMacSystemFont, sans-serif`; no additional scale notes surfaced.

Append the `## Typography` section using these values, including the `*Depends on: Tone & Imagery Direction*` line.

- [ ] **Step 5: Verify all four sections present, in order, with nothing lost**

```bash
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep -c "Depends on" /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: first command outputs `4`; second lists `## Kitchen Grounding`, `## Palette`, `## Tone & Imagery Direction`, `## Typography`, in that order; third outputs `1` (only Typography has a dependency note so far).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/design-site/SKILL.md
git commit -m "feat: add /design-site tone/imagery and typography topics"
```

---

### Task 4: Topics 5–6 (Wordmark/logo/iconography, Grid/spacing/mobile layout)

**Files:**
- Modify: `.claude/skills/design-site/SKILL.md` (append after the Task 3 "Topic 4: Typography" content)
- Test: manual dry-run in `/tmp/lhr-design-site-skill-test`

**Interfaces:**
- Consumes: the section-writing rule (Task 1); Palette and Typography sections (Task 2, Task 3) that this task's Wordmark topic explicitly depends on.
- Produces: the `## Wordmark, Logo & Iconography` section (with a `*Depends on: Palette, Typography*` note) and the `## Grid, Spacing & Mobile Layout` section that Task 5's six page-layout subsections are built against and depend on.

- [ ] **Step 1: Append Topics 5–6**

Append to `.claude/skills/design-site/SKILL.md`:

```markdown
### Topic 5: Wordmark, logo & iconography *(visual companion)*

Using the palette and typography already chosen, generate rough directional concepts: an icon/symbol idea, a wordmark treatment (how the site name is typeset), and a small supporting icon style (e.g. for nav/UI elements). Explicitly tell the author these are directional only, not production-ready logo/icon art.

**Capture:** the chosen directional concept description. Write the `## Wordmark, Logo & Iconography` section:

```markdown
## Wordmark, Logo & Iconography
- Directional concept: <shape/symbol idea>
- Wordmark treatment: <typographic treatment of the site name>
- Supporting icon style: <captured answer>
- Note: directional only, not production-ready art
- *Depends on: Palette, Typography*
```

### Topic 6: Grid, spacing & mobile layout intent *(visual companion)*

Establish a shared spacing scale and column grid once, plus explicit mobile-vs-desktop layout intent, so the six page-layout topics below inherit a system rather than each making ad hoc structural decisions. Show 2-3 options via the visual companion (e.g. differing base spacing units or grid widths) if there's a genuine choice to make; otherwise propose one sensible default and confirm it with the author.

**Capture:** the spacing scale, column grid, and mobile-layout intent. Write the `## Grid, Spacing & Mobile Layout` section:

```markdown
## Grid, Spacing & Mobile Layout
- Spacing scale: <e.g. 8px base unit: 8/16/24/32/48/64>
- Column grid: <e.g. 12-column desktop grid, max-width Npx>
- Mobile-vs-desktop intent: <e.g. single-column stack below Npx, breakpoint>
```
```

- [ ] **Step 2: Re-seed the fixture with Tasks 2–3's finished sections**

```bash
rm -rf /tmp/lhr-design-site-skill-test
mkdir -p /tmp/lhr-design-site-skill-test/docs
cat > /tmp/lhr-design-site-skill-test/docs/BRAND.md << 'EOF'
# Brand & Visual Design

## Kitchen Grounding
- Environment anchor colors/materials: black granite counters, exposed red brick, warm driftwood-gray cabinetry, stainless steel appliances, matte black hardware, warm under-cabinet lighting
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): cozy industrial, editorial food photography

## Palette
- Primary/background: #F5F1EA
- Text: #2B2420
- Accent: #9C3B1F — buttons, links, callouts
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for #2B2420 on #F5F1EA
- Semantic state colors: error #B3261E, sold-out #6B6259, sale/discount #2F6F4F
- Note on how this was chosen to harmonize with the kitchen anchors above: warm neutral base keeps the black-granite/red-brick backdrop from feeling cold on screen

## Tone & Imagery Direction
- Voice adjectives: warm, unfussy, a little wry
- Admired writers/publications: Milk Street, Alison Roman's newsletter
- Sample sentence: This is the platter that survives the party.
- Photography style: natural light near the arched window, minimal styling, candid mid-cook shots, grounded in the actual kitchen space from Kitchen Grounding
- Imagery post-processing/treatment: 4:5 crop for feed/social parity; warm-neutral color grade

## Typography
- Heading font: Fraunces, fallback stack `Georgia, serif` — warm/editorial serif
- Body font: Inter, fallback stack `-apple-system, BlinkMacSystemFont, sans-serif`
- Scale notes: None captured
- *Depends on: Tone & Imagery Direction*
EOF
```

- [ ] **Step 3: Dry-run Topic 5 with sample answers, append the resulting section**

Sample answer: directional concept "a small arched-window motif echoing the kitchen's arched window, rendered as a simple line mark"; wordmark treatment "lowercase Fraunces italic for the site name"; supporting icon style "thin single-weight line icons matching the mark's stroke weight."

Append the `## Wordmark, Logo & Iconography` section using these answers, including the `*Depends on: Palette, Typography*` line.

- [ ] **Step 4: Dry-run Topic 6 with sample answers, append the resulting section**

Sample answer: spacing scale "8px base unit: 8/16/24/32/48/64"; column grid "12-column desktop grid, max-width 1200px"; mobile intent "single-column stack below 768px, generous vertical spacing between stacked elements."

Append the `## Grid, Spacing & Mobile Layout` section using these answers.

- [ ] **Step 5: Verify all six sections present, in order, with dependency notes intact**

```bash
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep -c "Depends on" /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep "Depends on: Palette, Typography" /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: first command outputs `6`; second lists the six headings in canonical order ending with `## Grid, Spacing & Mobile Layout`; third outputs `2` (Typography's and Wordmark's dependency notes); fourth matches exactly once (Wordmark's line).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/design-site/SKILL.md
git commit -m "feat: add /design-site wordmark/logo/iconography and grid/spacing/mobile topics"
```

---

### Task 5: Topics 7–11 (the six page layouts)

**Files:**
- Modify: `.claude/skills/design-site/SKILL.md` (append after the Task 4 "Topic 6: Grid, spacing & mobile layout intent" content)
- Test: manual dry-run in `/tmp/lhr-design-site-skill-test`

**Interfaces:**
- Consumes: the section-writing rule (Task 1), specifically the "shared `## Page Layouts` heading, created once" behavior; Palette, Typography, and Grid, Spacing & Mobile Layout sections (Tasks 2 and 4) that every layout topic depends on; the existing `RecipeLayout.astro`/`ArticleLayout.astro` component structure and the `products`/`sets` content collections that Topics 8, 9, and 10 are grounded against.
- Produces: the complete `## Page Layouts` section with six `###` subsections — the last piece of Step 1. Task 6 consumes the finished, complete file for its end-to-end trace.

- [ ] **Step 1: Append Topics 7–11**

Append to `.claude/skills/design-site/SKILL.md`:

```markdown
### Topic 7: Home / listing page layout *(visual companion)*

Show 2-3 layout wireframes for the existing home page (currently `src/pages/index.astro`, an unstyled list of post links), built on the Grid, Spacing & Mobile Layout system from Topic 6.

**Capture:** the chosen layout's component list and arrangement. Write the `### Home / Listing` subsection under `## Page Layouts` (creating the parent heading if this is the first page-layout topic run this session):

```markdown
## Page Layouts

### Home / Listing
- Components: <e.g. hero for most recent post, grid of post cards below>
- Arrangement: <description>
- Notes: <any page-specific notes>
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 8: Recipe post layout *(visual companion)*

Show 2-3 wireframes for the placement of ingredients, steps, kitchenware cards, and affiliate links, building on the existing `src/layouts/RecipeLayout.astro` structure (read the file to ground the options in its actual current sections) and the Topic 6 grid.

**Capture:** the chosen layout's component list and arrangement. Write the `### Recipe Post` subsection under `## Page Layouts` (append after `### Home / Listing`, or create the parent heading if this is the first page-layout topic run):

```markdown
### Recipe Post
- Components: <e.g. hero photo, two-column ingredients/steps on desktop, kitchenware cards inline>
- Arrangement: <description>
- Notes: <any page-specific notes>
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 9: Article post layout *(visual companion)*

Show 2-3 wireframes building on the existing `src/layouts/ArticleLayout.astro` structure (read the file) and the Topic 6 grid.

**Capture:** the chosen layout's component list and arrangement. Write the `### Article Post` subsection under `## Page Layouts`:

```markdown
### Article Post
- Components: <e.g. hero photo, single-column prose, kitchenware cards at end>
- Arrangement: <description>
- Notes: <any page-specific notes>
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 10: Product / shop listing page layout *(visual companion)*

This page doesn't exist yet. Show 2-3 wireframes designed against the existing `products`/`sets` content collections (read `src/content.config.ts` and `src/content/schemas.ts` to ground the options in the real fields available) and the Topic 6 grid.

**Capture:** the chosen layout's component list and arrangement. Write the `### Product / Shop Listing` subsection under `## Page Layouts`:

```markdown
### Product / Shop Listing
- Components: <e.g. grid of product cards grouped by current set>
- Arrangement: <description>
- Notes: forward-looking — this page and any content beyond the existing products/sets schemas don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```

### Topic 11: About & community page layout *(visual companion)*

Neither page nor its content model exists yet, so keep this lighter-weight: capture structural intent, not final content. Show 1-2 simple wireframes for each via the visual companion.

**Capture:** structural intent for both pages. Write the `### About` and `### Community` subsections under `## Page Layouts` (both from this one topic):

```markdown
### About
- Components: <e.g. single long-form page, photo + story>
- Arrangement: <description>
- Notes: forward-looking — page and content model don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*

### Community
- Components: <e.g. placeholder "coming soon" structure, newsletter signup>
- Arrangement: <description>
- Notes: forward-looking — page and content model don't exist yet
- *Depends on: Palette, Typography, Grid, Spacing & Mobile Layout*
```
```

- [ ] **Step 2: Re-seed the fixture with Tasks 2–4's finished sections**

```bash
rm -rf /tmp/lhr-design-site-skill-test
mkdir -p /tmp/lhr-design-site-skill-test/docs
cat > /tmp/lhr-design-site-skill-test/docs/BRAND.md << 'EOF'
# Brand & Visual Design

## Kitchen Grounding
- Environment anchor colors/materials: black granite counters, exposed red brick, warm driftwood-gray cabinetry, stainless steel appliances, matte black hardware, warm under-cabinet lighting
- Note: these anchors inform palette mood/undertone, not literal hex-sampling
- Mood adjectives / reference sites (secondary influence): cozy industrial, editorial food photography

## Palette
- Primary/background: #F5F1EA
- Text: #2B2420
- Accent: #9C3B1F — buttons, links, callouts
- Contrast check: confirmed WCAG AA (4.5:1 text, 3:1 UI) for #2B2420 on #F5F1EA
- Semantic state colors: error #B3261E, sold-out #6B6259, sale/discount #2F6F4F
- Note on how this was chosen to harmonize with the kitchen anchors above: warm neutral base keeps the black-granite/red-brick backdrop from feeling cold on screen

## Tone & Imagery Direction
- Voice adjectives: warm, unfussy, a little wry
- Admired writers/publications: Milk Street, Alison Roman's newsletter
- Sample sentence: This is the platter that survives the party.
- Photography style: natural light near the arched window, minimal styling, candid mid-cook shots, grounded in the actual kitchen space from Kitchen Grounding
- Imagery post-processing/treatment: 4:5 crop for feed/social parity; warm-neutral color grade

## Typography
- Heading font: Fraunces, fallback stack `Georgia, serif` — warm/editorial serif
- Body font: Inter, fallback stack `-apple-system, BlinkMacSystemFont, sans-serif`
- Scale notes: None captured
- *Depends on: Tone & Imagery Direction*

## Wordmark, Logo & Iconography
- Directional concept: a small arched-window motif echoing the kitchen's arched window, rendered as a simple line mark
- Wordmark treatment: lowercase Fraunces italic for the site name
- Supporting icon style: thin single-weight line icons matching the mark's stroke weight
- Note: directional only, not production-ready art
- *Depends on: Palette, Typography*

## Grid, Spacing & Mobile Layout
- Spacing scale: 8px base unit: 8/16/24/32/48/64
- Column grid: 12-column desktop grid, max-width 1200px
- Mobile-vs-desktop intent: single-column stack below 768px, generous vertical spacing between stacked elements
EOF
```

- [ ] **Step 3: Dry-run Topics 7–11 with sample answers, building the Page Layouts section incrementally**

Sample answers:
- Home/Listing: hero card for the most recent post, grid of post cards below it.
- Recipe Post: hero photo, two-column ingredients/steps on desktop (stacked on mobile per the Topic 6 breakpoint), kitchenware cards inline after the steps.
- Article Post: hero photo, single-column prose, kitchenware cards at the end.
- Product/Shop Listing: grid of product cards grouped by the currently active set.
- About: single long-form page, photo + story.
- Community: placeholder "coming soon" structure with a newsletter signup.

Write these five topics' subsections one at a time, in order, appending each to the fixture file — Topic 7 creates the `## Page Layouts` heading plus `### Home / Listing`; Topics 8–10 each append one more `###` subsection; Topic 11 appends both `### About` and `### Community` in one go.

- [ ] **Step 4: Verify the complete Page Layouts section**

```bash
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep '^### ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep -c "Depends on: Palette, Typography, Grid, Spacing & Mobile Layout" /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: first command outputs `7` (the six prior `##` sections plus the one `## Page Layouts` heading); second lists exactly `### Home / Listing`, `### Recipe Post`, `### Article Post`, `### Product / Shop Listing`, `### About`, `### Community`, in that order; third outputs `6` (one dependency note per page-layout subsection).

- [ ] **Step 5: Verify the whole file has no placeholders**

```bash
grep -niE "TBD|TODO|placeholder text|fill in|implement later" /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: no output. (The literal word "placeholder" appears legitimately in earlier prose about seed *posts*, not in this generated doc — this check is on the generated `docs/BRAND.md`, not the skill file, so that's not a concern here.)

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/design-site/SKILL.md
git commit -m "feat: add /design-site page-layout topics for all six planned pages"
```

---

### Task 6: Close-out (Step 2) + full end-to-end trace

**Files:**
- Modify: `.claude/skills/design-site/SKILL.md` (append after the Task 5 "Topic 11" content)
- Test: full manual dry-run of the entire skill, start to finish, in `/tmp/lhr-design-site-skill-test`

**Interfaces:**
- Consumes: every prior task's section templates and the Step 0 rerun/dependency-cascade logic (Task 1).
- Produces: nothing consumed by later tasks — this is the last section of the skill, and the final verification that the whole file is internally consistent.

- [ ] **Step 1: Append the close-out section**

Append to `.claude/skills/design-site/SKILL.md`:

```markdown
## Step 2: Close out

Summarize what was written this run: which of the eleven `docs/BRAND.md` sections were newly written, which were revised, and which were left untouched (a rerun with unselected topics). If any dependent sections (Wordmark/Logo/Iconography, page layouts) were left stale because the author declined to re-review them after a Palette/Typography change, say so explicitly, and remind the author they can re-run `/design-site` later to revise any section.

Never claim to have produced CSS, Astro components, or any other implementation artifact — `docs/BRAND.md` is the entire scope of this skill.
```

- [ ] **Step 2: Read the complete finished skill file top to bottom**

```bash
cat .claude/skills/design-site/SKILL.md
```
Confirm the file contains, in order: frontmatter, intro, visual-companion guidance, Step 0 (rerun detection + dependency cascade), the section-writing rule, Step 1 (all eleven topics, in canonical order, each with its `##`/`###` template), Step 2 (close-out). Confirm there are no placeholder markers in the skill file itself:
```bash
grep -niE "TBD|TODO|fill in|implement later" .claude/skills/design-site/SKILL.md
```
Expected: no output.

- [ ] **Step 3: Full end-to-end dry run — fresh run, happy path, visual companion accepted**

Re-seed an empty fixture:
```bash
rm -rf /tmp/lhr-design-site-skill-test
mkdir -p /tmp/lhr-design-site-skill-test/docs
```
Using the sample answers from Tasks 2–5, hand-trace the entire skill start to finish: Step 0 (no `docs/BRAND.md` → first run) → Step 1 (all eleven topics in order, each writing its section immediately as traced in Tasks 2–5) → Step 2 (close-out summary).

Verify the finished file:
```bash
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep -c '^### ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: `7` (six brand-fundamentals sections plus `## Page Layouts`), and `6` (the six page-layout subsections).

- [ ] **Step 4: Full end-to-end dry run — revise-specific-sections with the dependency cascade**

Continuing from the file produced in Step 3, hand-trace a rerun: `docs/BRAND.md` exists → "Revise specific sections" → select only "Palette". Per Step 0's dependency-cascade paragraph, this must trigger the follow-up question offering to also re-review Wordmark/Logo/Iconography and the five page-layout topics. Simulate the author selecting only "Wordmark, logo & iconography" to also re-review, declining the rest.

Hand-apply the outcome:
1. Replace `## Palette` with a new sample palette (e.g. swap the accent hex only, keeping background/text/semantic colors — still passing contrast, per Step 4/5's contrast script from Task 2).
2. Replace `## Wordmark, Logo & Iconography` with updated content reflecting the new accent.
3. Prepend the stale-flag note to the five sections that depend on Palette but were **not** re-reviewed: `### Home / Listing`, `### Recipe Post`, `### Article Post`, `### Product / Shop Listing`, `### About`, `### Community` (all six page-layout subsections, since none were selected).

Verify:
```bash
grep -c "last decided against a Palette/Typography that has since changed" /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: `6` (one stale-flag note per page-layout subsection — Wordmark was re-reviewed so it does *not* get the note); section count unchanged at `7` (a revise rerun replaces content, it doesn't add or remove top-level sections).

- [ ] **Step 5: Full end-to-end dry run — visual companion declined, falls back to text**

Re-seed an empty fixture (same commands as Step 3). Hand-trace Topic 2 (the first *(visual companion)* topic) with the offer declined: confirm the skill's "Using the visual companion" section, as written, calls for describing 2-3 palette options in text instead of generating swatches, and for not re-offering the companion for any later visual topic (Topics 4–11). Confirm by inspection — no code to run here, since this only changes *how* options are presented, not what gets written to `docs/BRAND.md`.

- [ ] **Step 6: Full end-to-end dry run — abandoned mid-interview leaves a partial-but-consistent doc**

Re-seed an empty fixture (same commands as Step 3). Hand-trace Topics 1–2 only (Kitchen Grounding + Palette written), then simulate the author ending the session before Topic 3.
```bash
grep -c '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
grep '^## ' /tmp/lhr-design-site-skill-test/docs/BRAND.md
```
Expected: `2`; lists exactly `## Kitchen Grounding` and `## Palette` — both fully written (not half-written), with Topics 3–11 simply absent rather than present-but-empty.

- [ ] **Step 7: Clean up the scratch fixture**

```bash
rm -rf /tmp/lhr-design-site-skill-test
```

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/design-site/SKILL.md
git commit -m "feat: add /design-site close-out summary, completing the skill"
```

---

## Post-Plan Note (not a task — informational)

Per the design spec's Out of Scope section, this plan only builds the interview skill itself. Turning a completed `docs/BRAND.md` into actual CSS/Astro component changes is a separate, later plan — not something `/design-site` or this implementation plan does.
