# LHR Authoring MCP Server + Claude Authoring Skill — Design

**Date:** 2026-07-11
**Status:** Approved for planning
**Builds on:** `docs/superpowers/specs/2026-07-11-content-platform-authoring-skill-design.md` (§2, §4), which this spec supersedes for MCP server and authoring workflow details. That spec's site content model (§3), constitution (§6), and repo layout (§5) still apply.

## 1. Overview & Goals

Plan 1 (site foundation) is complete: the Astro site, content schemas, recipe/article templates, and governance docs exist and are deployed. This phase — referred to as "Plan 2" in the site-foundation plan's intro — builds the piece that lets the author create posts and rotate kitchenware sets entirely from the Claude mobile app: the authoring MCP server and the Claude-side conversational flow that drives it.

**Success criteria for this phase:**
- She can create a complete recipe or article post — title, body, photos, kitchenware tie-ins, affiliate links — entirely from the Claude.ai app, ending in her explicit confirmation before anything publishes.
- She can rotate to a new kitchenware set through an equivalent flow.
- An abandoned draft is never lost — she can resume it next time.
- Nothing publishes without her explicit confirmation (Constitution #1), and the MCP server remains single-author only (Constitution #5).

## 2. Architecture

- **MCP server**: lives in `mcp-server/` in this repo, deployed as an **always-on Fly.io app** (separate deploy from the site). Fly.io was chosen over Vercel specifically because exported food photos can land in the 3–8MB range, and Vercel serverless functions cap request bodies around 4.5MB — a real constraint discovered mid-design, not present when hosting was first discussed. An always-on container has no such body-size ceiling.
- **Auth**: the Claude.ai connector UI expects an OAuth handshake, not a pasted API key. The server implements a **minimal single-user OAuth 2.1 surface** (`/authorize`, `/token`) gated by one secret set as a Fly.io env var — not a full identity provider, just enough surface for the client to complete its login flow and receive a long-lived token. Satisfies Constitution #5 (single-author only).
- **Claude-side flow**: she connects the server as a custom MCP connector in the Claude.ai app, then uses a **Claude.ai Project** whose custom instructions script the step-by-step conversation (pick post type → fields → photos → kitchenware → affiliate links → preview → confirm). This replaces the original spec's "structured skill-driven flow" language — Claude.ai's mobile app doesn't support Claude Code-style Skills, so the structure lives in the Project instructions plus the shape of the tools themselves.
- **Git writes**: all commits, branches, and merges happen via the **GitHub REST API (Octokit)** — the server is stateless per-request even on Fly.io (no assumption of a persistent local clone), so there's no local git checkout to operate on.
- **Photo storage**: unchanged from the original spec — photos upload to **Vercel Blob**, referenced by URL from post content. Moving the MCP server to Fly.io doesn't change where images live.

## 3. Draft Lifecycle & Data Model

Every in-progress post or set rotation is represented as a **git branch** plus one JSON file, never as a real content file:

- Branch naming: `draft/post-<id>` or `draft/set-<id>`, where `<id>` is a short random identifier assigned at creation (not derived from title, since the title may not be finalized yet).
- Draft state file: `.drafts/<id>.json` on that branch — a structured representation of everything gathered so far (post type, title, body/sections or ingredients+steps, photo URLs, linked kitchenware ids, linked/pending affiliate link entries). This path is outside every Astro content collection glob, so it can never accidentally build or ship.
- Every tool call that mutates the draft (`attach_photo`, `add_content_step`, `link_kitchenware`, `add_affiliate_link`) does a read-modify-write of that JSON as a single commit on the branch via Octokit.
- **Resuming**: `start_post` first lists existing `draft/post-*` branches (reading each `.drafts/*.json` for a summary) and offers to resume one before creating a new one. Same pattern applies to `start_new_set` for `draft/set-*` branches.
- **Publishing**: `confirm_and_publish` does not perform a literal git merge (that would drag `.drafts/` metadata onto `main`). Instead it:
  1. Reads and validates the draft JSON against the relevant Zod schema (`postSchema` or `setSchema`).
  2. Derives a unique slug from the title, checking it against existing posts on `main`.
  3. Renders the final MDX (frontmatter + body) and any new/updated catalog JSON files (products, affiliate links, sets).
  4. Creates **one new commit directly on `main`** via Octokit (read `main`'s HEAD, create blobs, create a tree, create a commit, update the ref) containing only the final content files.
  5. Deletes the draft branch.
  6. The push to `main` triggers Vercel's existing auto-deploy — no separate deploy step needed.
- If she abandons a draft, the branch and its JSON simply persist until resumed. No auto-expiry in this phase (Constitution #4: drafts are never silently discarded).

## 4. MCP Tool Contracts

Extends the original spec's tool list (Rules #3) with concrete shapes:

- **`start_post(type: 'recipe' | 'article')`** — lists open drafts of the given type first; if none or she declines to resume, creates a new `draft/post-<id>` branch with an empty `.drafts/<id>.json`. Returns the draft id and next-step prompt.
- **`add_content_step(draftId, ...)`** — for recipes: appends to `ingredients` / `steps`. For articles: appends a `{ heading, body }` entry to `sections` (see §6). Commits the updated draft JSON.
- **`attach_photo(draftId, imageBase64, mimeType, caption?)`** — decodes base64 (capped at ~20MB to reject clearly oversized payloads), uploads to Vercel Blob, appends the resulting URL (+ caption) to the draft JSON. Photo upload failures leave the rest of the draft untouched (§8).
- **`link_kitchenware(draftId, productIds: string[])`** — defaults to suggesting the currently-active set's products (via `getActiveSet`/`getSetProducts`, carried over from Plan 1's `src/lib/content.ts`); she picks which apply. Writes `kitchenwareIds` into the draft JSON.
- **`add_affiliate_link(draftId, label, url, tag)`** — validates the URL, checks `main`'s current affiliate-link catalog (fetched live via GitHub API) for a matching `url`. On a match, reuses that entry's id. On no match, stages a full new entry in the draft JSON's `pendingAffiliateLinks`, materialized as a real catalog file only at publish time.
- **`preview_post(draftId)`** — renders a text summary (title, excerpt, photo count with URLs, linked products, linked affiliate links) back into the chat for her review.
- **`confirm_and_publish(draftId)`** — see §3. On failure (schema validation, slug collision, GitHub API error), reports the failure explicitly and leaves the draft branch intact for retry (Constitution #4).
- **`start_new_set(name, startDate, products: [...])`** — creates a `draft/set-<id>` branch, collects product entries (name, price, image, vendor URL) the same way `attach_photo` handles images. `confirm_and_publish` for a set: auto-closes the previously-active set's `endDate` to the day before the new set's `startDate` (§7), then writes the new set + product catalog files as one commit to `main`.

## 5. Photo Handling

`attach_photo` receives image bytes as base64 in the tool-call arguments — the only channel available for getting bytes from the chat into a tool call. She's responsible for exporting a web-ready JPEG/HEIC from her camera's RAW/HDR source before attaching (a normal step in her existing photo workflow) — the pipeline does not perform RAW conversion. A ~20MB cap on the decoded input rejects clearly-wrong attachments (e.g. an un-exported RAW file) with a clear error rather than failing obscurely.

## 6. Content Model Change: Article Sections

`articlePostSchema` changes from a freeform MDX body to structured sections, mirroring how recipes already have structured `ingredients`/`steps`:

```ts
sections: z.array(z.object({
  heading: z.string(),
  body: z.string(),
})).min(1)
```

`ArticleLayout.astro` renders each section under its heading instead of a single `<Content />` block from MDX prose. This requires:
- Migrating the existing seed post `src/content/posts/why-coastal-blue.mdx` to the new shape.
- Updating `docs/RULES.md` rule 5 (frontmatter schema shape) to describe sections instead of freeform body.

## 7. Kitchenware Set Rotation

`start_new_set` / its `confirm_and_publish` path finds the currently-active set (via `getActiveSet`) and sets its `endDate` to one day before the new set's `startDate`, preventing overlapping "active" ranges without her having to manually edit the outgoing set.

## 8. Error Handling

Carries forward the original spec's principles, made concrete for this design:
- Photo upload fails → `attach_photo` returns an error; the draft JSON is untouched; she retries just that photo.
- Malformed affiliate URL → rejected by `add_affiliate_link` before anything is written to the draft JSON.
- Publish fails (schema validation, slug collision, GitHub API error) → she's told explicitly; the draft branch stays intact for retry; nothing partial ever lands on `main`.
- Abandoned draft → branch + JSON persist indefinitely this phase; no silent discarding (Constitution #4).

## 9. Testing Approach

- Unit tests per MCP tool against a mocked Octokit client: draft JSON read/modify/write, slug derivation, catalog URL matching, set-rotation date logic.
- One integration-style test exercises the full sequence — `start_post → attach_photo → link_kitchenware → add_affiliate_link → confirm_and_publish` — against a fake in-memory git backend, asserting the assembled MDX validates against the Plan 1 Zod schemas.
- Article-section rendering gets a rendering test analogous to Plan 1's `recipe-post.test.ts` / `article-post.test.ts`, updated for the new `sections` shape.

## 10. Manual Setup (outside this repo's code, documented like `DEPLOYMENT.md`)

1. Generate the OAuth gate secret and a GitHub token (repo write access) for the MCP server; set both as Fly.io app secrets.
2. Deploy `mcp-server/` to a new Fly.io app.
3. Add the Fly.io app's URL as a custom MCP connector in the Claude.ai app, completing the OAuth handshake with the secret from step 1.
4. Create a Claude.ai Project, paste in the scripted authoring-flow instructions, and attach the connector.

## 11. Repo Structure Addition

Extends Plan 1's layout:
```
mcp-server/
  src/
    tools/           # one module per MCP tool
    auth/             # minimal OAuth surface
    github.ts         # Octokit wrapper (branches, commits, direct-to-main publish)
    blob.ts            # Vercel Blob upload wrapper
  tests/
docs/
  AUTHORING-SETUP.md   # manual setup steps (§10), mirrors DEPLOYMENT.md
```

## Out of Scope (Future Phases)

- RAW/HDR conversion within the pipeline (she exports before attaching).
- Draft auto-expiry or cleanup tooling for long-abandoned branches.
- Multi-author support / per-user OAuth accounts (still single-author, per Constitution #5).
- Everything already out of scope in the original spec (commerce/checkout, category expansion, video, multi-author).
