---
name: audit-specs
description: Use when the author asks what specs/plans are done, wants docs/superpowers/ cleaned up or reorganized, or asks for the status of an implementation plan. Invoke as /audit-specs.
---

# /audit-specs — Spec & Plan Status Audit

Cross-references every file in `docs/superpowers/specs/` and `docs/superpowers/plans/`
against git history and the live codebase, stamps each with a status, and files it
into `done/`, `active/`, or `superseded/`.

Plan checkboxes are not a reliable completion signal — they routinely go unchecked
during real execution (one migration plan sat at 2/29 checked while zero of the work
had actually happened). Status must come from evidence — the codebase and git log —
never from a plan's own checkboxes.

## When to run

- Author asks "what's done" / "clean up the specs" / "reorganize docs/superpowers"
- Periodically after finishing a piece of skill/feature work, to keep the directory current

## Procedure

For each spec/plan file not already sorted under a `done/`, `active/`, or
`superseded/` subfolder:

1. **Identify the deliverable.** Read the spec's Overview/Goals or the plan's
   title + Architecture line — what file(s), directory, or capability would exist
   if this shipped?
2. **Check the live codebase** for that deliverable (grep/glob/ls) — does it exist
   on `main`?
3. **Check git log** (`git log --oneline --grep=...`, merge commits) for evidence
   it was actually built and merged, not just started.
4. **Check `git worktree list` / unmerged branches.** A spec or plan with real
   implementation commits sitting on an unmerged branch is **in progress / stuck**,
   not done and not not-started. Note the branch name and the last-commit date —
   more than ~7 days idle while `main` kept moving is worth flagging to the author
   as possibly stalled, not silently left alone.
5. **Check for supersession.** Does a later spec cover the same goals with a
   different architecture (e.g. a second "Approved for planning" doc for the same
   feature)? Confirm the later doc genuinely addresses the same scope before
   flagging it — never guess supersession from title similarity alone. If unsure,
   leave it `active` and ask the author instead of mislabeling it.
6. **Classify:**
   - `done` — deliverable exists on `main` and was merged
   - `active` — not started, or in progress on a live branch (note which)
   - `superseded` — confirmed per step 5
7. **Stamp the file** — add or update a `**Status:**` line directly under the title:
   - `**Status:** Done — <one-line evidence, e.g. "merged PR #7, docs/BRAND.md exists">`
   - `**Status:** Active — <not started | in progress on branch X, last commit YYYY-MM-DD>`
   - `**Status:** Superseded by <other-file>`
8. **Move the file** with `git mv` into `docs/superpowers/specs/{done,active,superseded}/`
   or `docs/superpowers/plans/{done,active,superseded}/`, matching its classification.
9. **Report** a short table to the author: file → new status → evidence. List
   anything you couldn't confidently classify separately, and ask — don't guess.

## Rules

- Never trust plan checkboxes as the completion signal — verify against the
  codebase and git history every time.
- Never silently reclassify something as `superseded` — that's a judgment call
  the author should see, not one to infer past.
- Don't touch files already sorted into `done/`/`active/`/`superseded/` unless
  their status actually changed (e.g. an `active` plan just merged).
- This only reorganizes `docs/superpowers/`. It doesn't edit `docs/BACKLOG.md` or
  other docs — if they've drifted out of sync with what you find, flag that to the
  author instead of editing it yourself.
