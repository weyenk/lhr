# LHR Authoring MCP Server + Claude Authoring Skill — Design

**Date:** 2026-07-11
**Status:** Done — `mcp-server/` exists on `main`, merged via PR #1.
**Builds on:** `docs/superpowers/specs/active/2026-07-11-content-platform-authoring-skill-design.md` (§2, §4), which this spec supersedes for MCP server and authoring workflow details. That spec's site content model (§3), constitution (§6), and repo layout (§5) still apply.

## 1. Overview & Goals

Plan 1 (site foundation) is complete: the Astro site, content schemas, recipe/article templates, and governance docs exist and are deployed. This phase — referred to as "Plan 2" in the site-foundation plan's intro — builds the piece that lets the author create posts and rotate kitchenware sets entirely from the Claude mobile app: the authoring MCP server and the Claude-side conversational flow that drives it.

**Success criteria for this phase:**
- She can create a complete recipe or article post — title, body, photos, kitchenware tie-ins, affiliate links — entirely from the Claude.ai app, ending in her explicit confirmation before anything publishes.
- She can rotate to a new kitchenware set through an equivalent flow.
- An abandoned draft is never lost — she can resume it next time.
- Nothing publishes without her explicit confirmation (Constitution #1), and the MCP server remains single-author only (Constitution #5).

## 2. Architecture

- **MCP server**: lives in `mcp-server/` in this repo, deployed as its own **Vercel project** (separate deploy from the site, same repo). Vercel serverless functions cap request bodies around 4.5MB, which was initially a concern for large exported photos — but since photo bytes now travel via a server-side fetch rather than through the tool-call body (see §5), that ceiling no longer applies to this design, and Vercel keeps everything on one hosting platform.
- **Auth**: the MCP TypeScript SDK's own guidance is explicit — don't hand-roll an OAuth authorization server; front an existing one. The server uses the SDK's **`ProxyOAuthServerProvider`** to delegate the OAuth handshake to **GitHub OAuth**: she logs in with her own GitHub account (the repo owner) when claude.ai's connector completes its handshake. The server then checks the authenticated GitHub username against a single-entry allowlist (her username) before permitting any tool call — satisfying Constitution #5 (single-author only) without the server implementing token issuance itself. Her resulting GitHub token (scoped with `repo` write access) doubles as the credential for git writes, so there's no separate static secret or bot PAT to manage. In-flight OAuth state (PKCE challenges, issued tokens) is held in **Vercel KV**, since the server is stateless per-invocation and can't keep this in memory across requests.
- **Claude-side flow**: she connects the server as a custom MCP connector in the Claude.ai app, then uses a **Claude.ai Project** whose custom instructions script the step-by-step conversation (pick post type → fields → photos → kitchenware → affiliate links → preview → confirm). This replaces the original spec's "structured skill-driven flow" language — Claude.ai's mobile app doesn't support Claude Code-style Skills, so the structure lives in the Project instructions plus the shape of the tools themselves.
- **Git writes**: all commits, branches, and merges happen via the **GitHub REST API (Octokit)**, authenticated with her own OAuth-derived token — the server is stateless per-request (no assumption of a persistent local clone), so there's no local git checkout to operate on.
- **Photo storage**: photos are fetched server-side and stored in **Vercel Blob**, referenced by URL from post content. See §5 for how bytes get there.

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
- **`attach_photo(draftId, photoUrl, caption?)`** — fetches `photoUrl` server-side (see §5), uploads the bytes to Vercel Blob, appends the resulting Blob URL (+ caption) to the draft JSON. Photo upload failures leave the rest of the draft untouched (§8).
- **`link_kitchenware(draftId, productIds: string[])`** — defaults to suggesting the currently-active set's products (via `getActiveSet`/`getSetProducts`, carried over from Plan 1's `src/lib/content.ts`); she picks which apply. Writes `kitchenwareIds` into the draft JSON.
- **`add_affiliate_link(draftId, label, url, tag)`** — validates the URL, checks `main`'s current affiliate-link catalog (fetched live via GitHub API) for a matching `url`. On a match, reuses that entry's id. On no match, stages a full new entry in the draft JSON's `pendingAffiliateLinks`, materialized as a real catalog file only at publish time.
- **`preview_post(draftId)`** — renders a text summary (title, excerpt, photo count with URLs, linked products, linked affiliate links) back into the chat for her review.
- **`confirm_and_publish(draftId)`** — see §3. On failure (schema validation, slug collision, GitHub API error), reports the failure explicitly and leaves the draft branch intact for retry (Constitution #4).
- **`start_new_set(name, startDate, products: [...])`** — creates a `draft/set-<id>` branch, collects product entries (name, price, image, vendor URL) the same way `attach_photo` handles images. `confirm_and_publish` for a set: auto-closes the previously-active set's `endDate` to the day before the new set's `startDate` (§7), then writes the new set + product catalog files as one commit to `main`.

## 5. Photo Handling

Rather than routing image bytes through the tool-call channel (which runs into MCP transport and mobile-upload limits for anything beyond a few MB), photos flow through a **link-and-fetch** pattern:

1. She exports a web-ready JPEG/HEIC from her camera's RAW/HDR source (a normal step in her existing photo workflow — the pipeline does not perform RAW conversion).
2. She shares it via the Photos app's "Copy iCloud Link" feature, producing a public, unauthenticated URL, and pastes that URL into the chat.
3. `attach_photo(draftId, photoUrl, caption?)` receives just that URL string — a tiny tool-call payload regardless of the photo's actual size — and does a **server-to-server `fetch`** of it. Outbound fetches aren't subject to Vercel's inbound request-body limit, so this works for any photo size she'd realistically export.
4. The server validates the response is an image (content-type check) and under a sanity cap (~25MB) before uploading the bytes to Vercel Blob and discarding the fetched buffer. The Blob URL — not the iCloud link — is what gets stored in the draft JSON and ultimately the published post, since iCloud share links can expire or be revoked and a blog post needs to stay up.

This is a placeholder transport for photo intake, chosen because it requires no new infrastructure and iCloud is already her camera roll's home. It's expected to be replaced by a direct upload path (e.g. to AWS S3) in a future phase; `attach_photo`'s interface (`draftId, photoUrl, caption?` in, a stored Blob URL out) is written generically enough that swapping the fetch source or storage destination later doesn't change the tool's contract.

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

1. Register a GitHub OAuth App for the MCP server (callback URL pointing at the new Vercel project); note its client id/secret.
2. Create the new Vercel project for `mcp-server/`, provision a Vercel KV store for OAuth/session state, and set the GitHub OAuth App client id/secret plus a Vercel Blob token as project env vars.
3. Add her GitHub username to the server's single-entry author allowlist (a config value, not a secret).
4. Add the deployed project's URL as a custom MCP connector in the Claude.ai app, completing the GitHub OAuth handshake.
5. Create a Claude.ai Project, paste in the scripted authoring-flow instructions, and attach the connector.

## 11. Repo Structure Addition

Extends Plan 1's layout:
```
mcp-server/
  src/
    tools/           # one module per MCP tool
    auth/             # ProxyOAuthServerProvider config + author allowlist check
    github.ts         # Octokit wrapper (branches, commits, direct-to-main publish)
    blob.ts            # Vercel Blob upload wrapper + photoUrl fetch-and-store
  tests/
docs/
  AUTHORING-SETUP.md   # manual setup steps (§10), mirrors DEPLOYMENT.md
```

## Out of Scope (Future Phases)

- RAW/HDR conversion within the pipeline (she exports before attaching).
- Draft auto-expiry or cleanup tooling for long-abandoned branches.
- Multi-author support / per-user OAuth accounts (still single-author, per Constitution #5).
- Everything already out of scope in the original spec (commerce/checkout, category expansion, video, multi-author).
