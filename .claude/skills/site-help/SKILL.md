---
name: site-help
description: Use when the author asks how to use the lhr-authoring MCP server, wants a walkthrough of publishing a recipe/article or rotating a kitchenware set, or asks what commands/tools exist for managing her site. Invoke as /site-help.
---

# /site-help — Authoring MCP Server Guide

There's no admin panel. Everything — writing a post, rotating the kitchenware
set, adding affiliate links — happens by talking through the `lhr-authoring`
MCP server's 8 tools. This skill is the walkthrough for that: what each tool
does, in what order, and what trips people up.

(First-time connector setup — GitHub OAuth App, Vercel project, env vars — is
`docs/AUTHORING-SETUP.md`, not this skill.)

## Two things you can author

1. **A post** (recipe or article) — the common case.
2. **A kitchenware set** — swaps the shop's active product lineup.

Both work as a **draft → edit → preview → publish** cycle. Drafts are stored
as git branches, so a half-finished draft survives closing the chat and
picking it up days later.

## Quick reference

| Tool | What it does |
|---|---|
| `start_post` | Starts a new recipe/article draft, or lists unfinished ones to resume. |
| `add_content_step` | Sets the title, or appends one ingredient+step (recipe) / one section (article). Call repeatedly. |
| `attach_photo` | Fetches a shared photo URL (e.g. an iCloud link) and attaches it to the draft. |
| `link_kitchenware` | Shows the current active set's products, or links given product ids to the draft. |
| `add_affiliate_link` | Adds a label + URL + tag; reuses an existing catalog entry if the URL is already known. |
| `preview_post` | Shows a summary of the draft (counts of ingredients/steps/sections/photos/links) before publishing. |
| `confirm_and_publish` | Validates and publishes a draft (post or set) to the live site. |
| `start_new_set` | Starts a draft for the next kitchenware set: name, start date, product lineup. |

## Publishing a post

1. **`start_post`** (`type: recipe` or `article`). Lists unfinished drafts of
   that type to resume, if any; otherwise starts fresh.
2. **`add_content_step`** — set the title, then call again per ingredient+step
   (recipe) or per section (article). One call per item; no bulk-add.
3. **`attach_photo`** at least once — required to publish.
4. **`link_kitchenware`** (optional) — call with no `productIds` first to see
   the active set's lineup, then again with ids to link them.
5. **`add_affiliate_link`** (optional) — label + URL + tag per link.
6. **`preview_post`** — sanity-check the counts before going live.
7. **`confirm_and_publish`** — commits the post and clears the draft branch.

**Publish requires:** a title; ≥1 ingredient and ≥1 step (recipes) or ≥1
section (articles); and ≥1 photo either way. A failed check names what's
missing — fix it and call `confirm_and_publish` again.

## Rotating the kitchenware set

1. **`start_new_set`** — `name`, ISO `startDate`, and the full product lineup
   (name, price in cents, image URL, image alt, vendor URL) in one call.
   There's no resume list for sets, so get the lineup right up front.
2. **`confirm_and_publish`** on that draft id — publishes the set and its
   products, and auto-closes whichever set was previously active (its
   `endDate` becomes the day before the new set's `startDate`).

**Publish requires:** a name, a start date, and ≥1 product.

## Notes

- Hang onto the draft id from `start_post`/`start_new_set` — every later call
  needs it. `confirm_and_publish` takes just the id and auto-detects post vs.
  set.
- Errors like "Draft \<id\> is not a post/set draft" or "section only applies
  to articles" mean the wrong tool/field was used for that draft's type —
  check `preview_post` or which `start_*` call created it.
