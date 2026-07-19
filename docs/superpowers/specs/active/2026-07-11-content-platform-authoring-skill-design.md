# LHR Content Platform + Authoring Skill — Design

**Date:** 2026-07-11
**Status:** Active — mixed. §2 (MCP server) and §4 (authoring workflow) are superseded by `2026-07-11-authoring-mcp-server-design.md` (its own §2, §4). §3 (content model), §5 (repo layout), and §6 (constitution) are still authoritative — no later spec has replaced them. Not filed under `superseded/` because it's still partly load-bearing; revisit if §3/§5/§6 content model logic ever moves elsewhere.

## 1. Overview & Goals

**loveheatrelationship.com (LHR)** is a food blog competing with food52.com, using recipes and lifestyle articles to sell curated kitchenware. This spec covers the content platform and the mobile authoring workflow only. Commerce/checkout, category expansion beyond kitchenware, and video are future phases, out of scope here.

**Content model at the core:** the site organizes around **kitchenware sets** — a curated product lineup (plates, bowls, silverware, etc.) that stays "current" for roughly 6 months, during which roughly 26 posts (a mix of recipes and lifestyle articles) are published featuring that set. When a set rotates, a new one is configured and the cycle repeats.

**Primary success criteria for this phase:**
- The site is live at loveheatrelationship.com, publicly browsable, with recipe and article post types.
- The author can create a complete, properly formatted post — including photos, kitchenware tie-ins, and article-specific affiliate links — entirely from the Claude phone app, via a structured skill-driven flow, ending in her explicit confirmation before it goes live.
- She can also stand up a new kitchenware set (its product lineup) through a similarly simple flow when it's time to rotate.
- Free/open-source analytics are in place, including tracking of affiliate/product link clicks.
- A constitution and rules document exists to guide all future agent work on this project.

## 2. Architecture

- **Site**: Astro, with content authored as Markdown/MDX files in this repo. Astro fits a content-led, SEO-sensitive site while still supporting interactive islands (e.g. product cards, and later cart/commerce UI) without committing to a fully dynamic framework now.
- **Hosting**: Vercel, connected to this repo, auto-deploying on push to `main`. Custom domain `loveheatrelationship.com` points here.
- **Content & product data**: Markdown/MDX for post bodies; structured JSON/YAML for the kitchenware product catalog, the affiliate link catalog, and kitchenware set definitions.
- **Images**: uploaded to Vercel Blob storage at authoring time, referenced by URL from post content.
- **Analytics**: Umami, self-hosted (e.g. on a small Fly.io or Railway instance), open-source and cookieless. The Astro site sends pageview events plus custom click events for kitchenware and affiliate links, which also feeds affiliate-link usage tracking (see Content Model).
- **Authoring MCP server**: a small Node service (hosted separately from the site, e.g. on Vercel or Fly.io) that exposes structured tools for the authoring skill:
  - `start_post` / `add_content_step` — title, body sections, recipe ingredients+steps for recipe type, article body for article type
  - `attach_photo` — receives image data from the chat, uploads to Blob storage, returns a reference
  - `link_kitchenware` — attach current-set product(s) to the post
  - `add_affiliate_link` — label + URL + tag; creates or reuses a catalog entry by matching URL
  - `preview_post` — renders a summary back into the chat
  - `confirm_and_publish` — on her confirmation, commits Markdown + any new/updated catalog entries, merges, triggers Vercel deploy
  - `start_new_set` — define a new kitchenware set's product lineup when rotating
- **Auth**: the MCP server is authenticated to the author alone (single-author site) — no public user accounts at this phase.

## 3. Content Model

- **Post** (Markdown/MDX file): `type` (`recipe` | `article`), title, slug, date, cover photo, body content, references to:
  - zero or more **kitchenware items** from the currently active set
  - zero or more **affiliate links** (each: label, URL, tag — e.g. a jerk-seasoning link on a jerk chicken recipe)
- **Recipe posts** additionally have structured `ingredients` and `steps` fields, enabling consistent templating and future schema.org Recipe markup for SEO.
- **Kitchenware Set** (data file): name/theme, active date range, list of member products.
- **Kitchenware Product** (catalog entry): name, price, image, vendor/purchase link, which set it belongs to.
- **Affiliate Link** (catalog entry): label, URL, tag/category, first-used post, click count (via Umami events) — reusable across posts, so a "jerk seasoning" link used in three recipes is one catalog entry, not three.

## 4. Authoring Skill Workflow

**Creating a post** (from her phone, via the Claude skill):
1. She invokes the skill and picks post type: recipe or article.
2. Skill walks her through fields conversationally but structured: title, body/steps (ingredients+steps for recipes, sections for articles), attaching photos directly in the chat as she goes — each one calls `attach_photo`, which uploads to Blob storage and returns a reference the skill slots into the post.
3. Skill asks whether to link current kitchenware set items (defaults to suggesting the active set, she picks which pieces apply) via `link_kitchenware`.
4. Skill asks if there are any article-specific affiliate links — for each, she gives a label + URL + tag; `add_affiliate_link` checks the catalog for a matching existing entry (by URL) and reuses it, or creates a new one.
5. `preview_post` renders a summary (title, excerpt, photo count, linked products/affiliate links) back into the chat.
6. She confirms → `confirm_and_publish` commits the Markdown + any new/updated catalog entries, merges, and Vercel deploys. If she doesn't confirm, the draft is saved and she can resume later.

**Rotating a kitchenware set** (separate, less frequent flow):
1. She invokes the skill's "new set" flow, names the set, gives its date range.
2. For each product, she provides name, price, image (attached in chat), vendor/purchase link — `start_new_set` collects these and writes the new set + product catalog entries.
3. She confirms; it commits and becomes the active set for future `link_kitchenware` suggestions.

## 5. Repo Structure & Error Handling

**Repo layout** (this repo, `lhr`):
```
src/
  content/
    posts/               # recipe-*.mdx, article-*.mdx
    products/            # kitchenware catalog entries (per product)
    affiliate-links/      # affiliate link catalog entries
    sets/                 # kitchenware set definitions
  pages/, components/, layouts/   # Astro site
mcp-server/              # authoring MCP server (separate deploy)
docs/
  superpowers/specs/      # design docs
  CONSTITUTION.md          # never-change rules
  RULES.md                 # evolvable rules, drift requires explicit permission
```

**Error handling for the authoring flow:**
- Photo upload fails → skill reports it and lets her retry that photo without losing the rest of the draft.
- She abandons a post mid-flow → draft state persists (as an unpublished file/branch) so she can resume next time she invokes the skill, rather than losing work.
- Affiliate URL looks malformed → skill flags it before saving, asks her to confirm or fix.
- Publish step fails (e.g. deploy/build error) → she's told explicitly rather than the skill silently reporting success; the draft stays intact for retry.

**Testing approach:**
- MCP server tools get straightforward unit/integration tests (e.g. `add_affiliate_link` reuses existing entries by URL, `confirm_and_publish` produces valid MDX).
- Astro site gets a basic build check plus rendering tests for recipe vs. article templates.
- Manual end-to-end pass: run through the authoring flow once for each post type before considering this phase done.

## 6. Constitution & Rules

A governance document guides all future agent work on this project (engineering conduct and content/business principles together), split into two files:

**`docs/CONSTITUTION.md` — never changes without extraordinary explicit override:**
1. A post never goes live without the author's explicit confirmation — no autonomous auto-publish.
2. Affiliate links and product placements are always disclosed per FTC guidelines.
3. Analytics/tracking tooling must remain free or open-source — no adding paid/closed tracking without the author's sign-off.
4. In-progress drafts are never silently discarded on error.
5. The authoring MCP server is single-author only — never opened to public/unauthenticated access.
6. If the user corrects the same thing more than once, the agent must proactively ask whether that correction should be codified as a new Rule.

**`docs/RULES.md` — can evolve, but an agent should flag drift and ask before changing course:**
1. Tech stack is Astro + Vercel + Umami — don't swap frameworks/hosting without asking first.
2. Repo content structure (`content/posts`, `content/products`, `content/affiliate-links`, `content/sets`) is the convention to follow.
3. MCP tool names/contracts (`start_post`, `attach_photo`, `link_kitchenware`, `add_affiliate_link`, `confirm_and_publish`, `start_new_set`) are the established interface — extend rather than rename without discussion.
4. The ~26-posts/6-months set cadence is the default assumption, not a hard limit — an agent can suggest adjusting it but should confirm with the author before changing the pattern.
5. Post frontmatter schema (type, title, slug, date, cover photo, ingredients/steps or body, linked kitchenware, linked affiliate links) is the standard shape for new posts.

These documents should be read by any agent (human-directed or autonomous) before making structural changes to this project.

## Out of Scope (Future Phases)

- Commerce/checkout and shopping cart functionality.
- Expansion into household goods beyond kitchenware.
- Video content in blog articles.
- Multi-author support / public user accounts.
