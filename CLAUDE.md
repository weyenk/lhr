# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Love Heat Relationship** (`loveheatrelationship.com`) — a personal food blog (recipes + travel/food articles) run by a single author, with linked kitchenware affiliate products. Built with Astro, deployed to Vercel. This repo also contains a companion **authoring MCP server** (`mcp-server/`) that lets the author publish content by talking to Claude instead of hand-editing files.

Two governance docs define how agents should operate here and take precedence over general judgment calls:
- `docs/CONSTITUTION.md` — never-change principles (no autonomous publish, FTC affiliate disclosure, free/OSS analytics only, drafts never silently discarded, MCP server stays single-author, repeat corrections get proposed as a new Rule).
- `docs/RULES.md` — evolvable conventions (tech stack, content structure, MCP tool contract, ~26-posts/6-months set cadence, post frontmatter shape). Drift a little, then ask before changing course.

`tests/docs/governance.test.ts` asserts specific phrases exist in both files — if you edit their wording, keep those assertions in sync.

## Repo layout (npm workspaces)

This is an npm-workspaces monorepo with three independently-deployed/buildable pieces:

- **root** — the Astro site (`src/`), deployed as its own Vercel project.
- **`mcp-server/`** — the authoring MCP server, deployed as a *separate* Vercel project (its own root directory in Vercel), workspace name `lhr-authoring-mcp-server`.
- **`packages/schemas/`** (`@lhr/schemas`) — Zod schemas shared by both the site's content collections and the MCP server, so the two never drift apart. `src/content/schemas.ts` is a one-line re-export (`export * from '@lhr/schemas'`) kept for import compatibility with existing site code — don't add real schema logic there.

`npm install` at the root triggers `postinstall` → builds `@lhr/schemas` first, since both other packages depend on it.

## Commands

Run from repo root unless noted.

- `npm run dev` — Astro dev server.
- `npm run build` — `astro build` (site only).
- `npm run preview` — preview the built site.
- `npm test` — runs `pretest` (`astro sync` + copies `node_modules/.astro/data-store.json` into `.astro/`, required for `astro:content` to resolve in tests) then `vitest run`. This only covers the **site** — `mcp-server/**` is explicitly excluded from the root vitest config.
- Single test file: `npx vitest run tests/path/to/file.test.ts` — if you haven't run `npm test` (or otherwise populated `.astro/data-store.json`) since content changed, run `npx astro sync && mkdir -p .astro && cp node_modules/.astro/data-store.json .astro/data-store.json` first, or content-collection-backed tests will fail to resolve `astro:content`.
- Root vitest runs test files **sequentially** (`fileParallelism: false`) because several test files shell out to `npm run build`, all writing to the shared `dist/` — don't undo this.

MCP server (from `mcp-server/`, or `--workspace=mcp-server` from root):
- `npm test --workspace=mcp-server` — `vitest run`. Uses vitest v2, a different major than the root's v3, which is why it's excluded from the root's `npm test` rather than just also running there.
- `npm run build --workspace=mcp-server` — builds `@lhr/schemas`, then `tsc --noEmit` (type-check only), then `node scripts/bundle.mjs` (esbuild bundles `api/index.ts` and `src/server.ts` into `dist/api/index.js` / `dist/src/server.js`, deps left external). Vercel's zero-config Node function detection picks up `api/index.ts`; `vercel.json` in `mcp-server/` rewrites everything to `/api`.
- `npm run backfill:ingredient-links --workspace=mcp-server` — one-off `tsx` script (`scripts/backfill-ingredient-links.ts`).

## Content architecture (the site)

Astro content collections are defined in `src/content.config.ts` using the `glob` loader, validated against the shared Zod schemas in `packages/schemas/src/index.ts`:

- **`posts`** (`src/content/posts/*.mdx`) — a discriminated union on `type`: `recipe` (ingredients + steps, yields/prep/cook time) or `article` (named sections). Both share base fields: title, date, cover photo + alt, optional excerpt, and arrays of linked `kitchenwareIds`/`affiliateLinkIds` (referencing `products`/`affiliateLinks` entries by id).
- **`products`** (`src/content/products/*.json`) — kitchenware items, each tagged with a `setId`.
- **`sets`** (`src/content/sets/*.json`) — a named, dated (`startDate`/`endDate`) collection of featured kitchenware products; `src/lib/content.ts`'s `getActiveSet` picks whichever set's date range contains "now". This is the "~26 posts / 6 months" rotation referenced in `RULES.md`.
- **`affiliateLinks`** (`src/content/affiliate-links/*.json`) — individual affiliate URLs (label, url, tracking tag, optional image), referenced by id from posts.
- **`ingredientLinks`** (`src/content/ingredient-links/*.json`) — maps a recipe ingredient name to an `affiliateLinkId`, used to auto-suggest affiliate links when a matching ingredient appears in a new recipe (see `suggest_affiliate_links` MCP tool and the `backfillIngredientLinks` script).

`src/lib/content.ts` holds small pure helpers over collection entries (`getActiveSet`, `getSetProducts`, `getEntriesByIds`, `formatPrice`) — put new cross-collection query logic here rather than inline in pages.

**Routing:** `src/pages/[...page].astro` is the paginated homepage feed (5 cards/page, newest-first, with a full-width hero on page 1 and a "Latest" sidebar). `src/pages/posts/[...slug].astro` renders one post per collection entry, dispatching to `RecipeLayout` or `ArticleLayout` based on `post.data.type`. Static pages (`about`, `community`, `affiliate-disclosure`, `privacy-policy`, `terms-of-service`) are plain `.astro` files. `EmailSignup.astro` (in the footer and on `/community/`) posts to Kit (ConvertKit) using `PUBLIC_CONVERTKIT_FORM_ID`.

Styling is Tailwind CSS v4 via the Vite plugin (`@tailwindcss/vite`), configured in `astro.config.mjs`; design tokens live in `src/styles/global.css` (see `tests/styles/tokens.test.ts`) and `docs/BRAND.md` for the source-of-truth brand spec.

## Authoring MCP server (`mcp-server/`)

A single-author-only MCP server (Express + `@modelcontextprotocol/sdk`) that the author drives from a Claude.ai custom connector to author and publish posts/sets without touching files directly — enforced by Constitution #1 (no autonomous publish) and #5 (never opened beyond the one allowlisted GitHub author). Full manual setup steps and the history of resolved deployment issues are in `docs/AUTHORING-SETUP.md` — read it before touching auth/deploy config here.

- **Auth** (`src/auth/githubOAuth.ts`): a real two-legged OAuth bridge, not a transparent proxy — claude.ai registers dynamically as the downstream OAuth client against a fixed `/callback`, while the server separately exchanges codes with a fixed GitHub OAuth App upstream and checks the resulting user against `AUTHOR_GITHUB_USERNAME`. OAuth client registrations/pending sessions/issued tokens are stored as private JSON blobs in Vercel Blob (`src/auth/{blobStore,clientStore,oauthStore}.ts`) — that store is OAuth-metadata-only now.
- **Tool contract** — registered in `src/tools/index.ts`, one file per tool under `src/tools/`: `start_post`, `add_content_step`, `attach_photo`, `get_photo_upload_link`, `link_kitchenware`, `add_affiliate_link`, `suggest_affiliate_links`, `preview_post`, `confirm_and_publish`, `start_new_set`. Per `RULES.md`, extend this set rather than renaming existing tools without discussion.
- **Drafts** (`src/drafts.ts` + `src/github.ts`): a draft is JSON at `.drafts/<id>.json` committed via Octokit to its own git branch (`draft/post-<id>` / `draft/set-<id>`) in this same repo — no separate database. `confirm_and_publish` is what finally commits the real content files straight to `main` (`commitFilesToMain`, no PR).
- **Photos** (`src/blob.ts`): stored in a public Cloudflare R2 bucket, deliberately *not* the (private) Vercel Blob OAuth store — R2 is reachable by anonymous site visitors, Vercel Blob here is not.
- **Mobile photo upload**: since Claude can't pass raw image bytes as a tool argument, `get_photo_upload_link` returns a signed, one-hour link to a small upload page the server itself renders (`GET /upload/:draftId`, `POST /upload/:draftId/photo` in `src/server.ts`), used from the author's phone.
- **Stateless request handling**: `/mcp` creates a fresh `McpServer`/transport per request (`sessionIdGenerator: undefined`) rather than tracking sessions in memory, since Vercel gives no guarantee consecutive requests hit the same instance.

## Working on plans/specs

Non-trivial design work in this repo follows the `superpowers` skill conventions under `docs/superpowers/`: design docs in `specs/{active,done}/`, implementation plans in `plans/{active,done}/`, dated filenames. Check there for prior art before starting significant new work, and use the `writing-plans`/`audit-specs` skills rather than inventing a new doc convention.

## Agents & skills roster

`.claude/agents/` defines a roster of specialized subagents modeling different roles running this as a small business (content strategy, SEO, monetization, product sourcing, giveaway compliance, analytics review, copy editing, design review, QA/test planning, a `developer` agent for strict-TDD implementation, and `chief-of-staff` as the single entry point that routes to the others). `.claude/skills/` has repo-specific skills (`setup`, `design-site`, `site-help`, `audit-specs`). Prefer routing non-trivial cross-cutting asks through `chief-of-staff` rather than acting unilaterally when it's ambiguous which specialty owns a request.

## Environment variables

Root site (`.env.example`): `PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID` (self-hosted Umami analytics — must stay free/OSS per Constitution #3), `PUBLIC_CONVERTKIT_FORM_ID` (Kit signup form). All are `PUBLIC_`-prefixed since Astro/Vite only expose that prefix to the browser.

`mcp-server/` needs its own separate set (GitHub OAuth App credentials, Vercel Blob token, Cloudflare R2 credentials, upload-link signing secret, author PAT) — see `docs/AUTHORING-SETUP.md` for the full list and how each is used; don't guess at these from the site's `.env.example`, they're unrelated.

## Deployment

Root site and `mcp-server/` are **two separate Vercel projects** from the same repo (different root directories), each auto-deploying on push to `main`. `docs/DEPLOYMENT.md` has the one-time manual setup (domain/DNS, Umami hosting, Kit form). A GitHub Action (`.github/workflows/telegram-preview-notify.yml`) posts a Telegram notification on successful preview deploys (excluding the mcp-server project's deployments).
