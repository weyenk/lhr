# Product-in-Photo Placement — Orchestrator Redesign

## Status

Supersedes `docs/superpowers/specs/active/2026-08-25-product-placement-design.md`.
That spec was implemented in full on `claude/product-placement-design-hyis83`
(PR #52) against an Astro-based `apps/lhr-office` and a standalone `@lhr/github`
package. While that branch was in review, all four sibling sub-projects
(recipe-variant-generator, affiliate-sourcing-agent, trends-watcher,
competitor-analysis) merged to `main`, materializing the architecture in
`docs/superpowers/specs/active/2026-08-25-shared-orchestrator-design.md`:
`apps/lhr-office` is now a plain Express app with one Basic-Auth-gated
`/status` page, jobs run through a shared `@lhr/jobs` due-check/overlap-guard
orchestrator, and `@lhr/github` was never adopted (GitHub calls live in
`mcp-server/src/github.ts`). This document redesigns product-in-photo
placement to fit that established architecture. PR #52 will be closed once
the branch built from this spec is ready; `claude/product-placement-design-hyis83`
will be reset to a fresh branch off current `main`.

**Update (2026-09-09):** while this spec was awaiting review, `apps/lhr-office`
was rebuilt again on `main` — from the Basic-Auth-gated server-rendered
`/status` HTML page described below into a Vite/React SPA (`client/`) served
as static assets from the same Express app, talking to a JSON REST API under
`/api/*`, authenticated with Supabase session JWTs (`requireSupabaseAuth`,
verified against Supabase's JWKS) instead of HTTP Basic Auth. The Job
registration, Data model, and `callLLM` overload sections below are
unaffected. The **Review UI** section has been rewritten in place to match
this second shift — the server-rendered `/status`-page version it replaces
is no longer the plan.

## Purpose (unchanged from original spec)

Recipes and articles get photographed with kitchenware and ingredients that
are not linked to any affiliate product on the site. This feature finds
those unattached opportunities, uses an LLM to match a photographed item to
a product in the catalog, edits the photo to make the product placement
clearer/consistent (e.g. label visible, consistent framing), and proposes
the edited photo + product link for human review before anything publishes.

## What's reused vs. rebuilt from the old branch

**Reused, adapted:**
- `product_placement_proposals` table and its columns (post slug, product
  id, proposed image path, status, timestamps) — moves into `packages/db`
  under the module-per-table convention (see Data Model).
- `packages/content` (post/frontmatter helpers: `postImages.ts`,
  `postImageUpdate.ts`) — reused as-is; it has no dependency on Astro or on
  the old `apps/lhr-office`.
- The LLM matching prompt design and response-parsing logic from the old
  `productPlacementMatching.ts` — reused, ported to call the new overloaded
  `callLLM`.
- The image-edit provider abstraction and OpenRouter free-tier provider
  logic from the old `mcp-server/src/imageEdit/` — reused, ported into
  `@lhr/llm`'s image branch (see Image Editing).

**Discarded:**
- The entire old `apps/lhr-office` Astro scaffold (`/product-placements`
  Astro page, Astro API routes) — replaced by a `/status` page section and
  Express routes.
- `@lhr/github` package usage — replaced by `mcp-server/src/github.ts`'s
  existing `createGitHubClient`/`commitFilesToMain`/etc.
- The old DI-only ops-interface testing style for the job itself — replaced
  by the sibling convention of `vi.mock()`-ing `@lhr/db` and `./github.js`
  directly in a zero-arg job's own test file (DI is kept only for the
  review-UI ops, matching `affiliateCandidateOps.ts`).

## Architecture

### Job registration (built, not yet registered)

A new zero-arg job function `matchProductsToRecipes` (in
`mcp-server/src/matchProductsToRecipes.ts`, exported through
`lhr-authoring-mcp-server/dist-lib/matchProductsToRecipes.js` like every
sibling job) implements the `Job` type from `@lhr/jobs`:

```ts
export type Job = () => Promise<JobResult>;
```

It is **not** added to `apps/lhr-office/src/registry.ts` as part of this
work. The image-edit step depends on a paid/rate-limited OpenRouter
free-tier model today; the user's upcoming local (Mac Studio) image
processing will likely replace it, and registering the job now would start
running an image-edit path due for replacement. The feature ships
functionally complete — matching, editing, proposal storage, and the full
review UI all work end-to-end when invoked manually (via
`POST /api/jobs/product-placement/run` once registered (see
`routes/jobs.ts`), or by direct invocation in a one-off script/test) — but
stays dormant in the due-check rotation until a one-line registry addition
turns it on:

```ts
{ name: 'product-placement', cadenceDays: 7, run: matchProductsToRecipes },
```

This mirrors how every other job is registered — `validateJobRegistrations`
enforces name/cadence shape at import time, `isDue`/`selectMostOverdue`
handle scheduling, and the existing overlap guard in
`apps/lhr-office/src/orchestrate.ts` covers this job automatically once
registered. No new orchestrator logic is needed.

### Job body

`matchProductsToRecipes()`:
1. Loads published posts via `@lhr/content`'s post helpers and enumerates
   photos per post (`enumeratePostImages`, ported from the old branch, with
   its existing empty-frontmatter guard).
2. Computes unattached candidates — photos not already linked to an
   approved/pending proposal — via `computeUnattachedCandidates` (ported).
3. For each candidate, calls the LLM matcher (`callLLM` from `@lhr/llm`,
   text-only overload) to propose a catalog product match, parses the
   response with the existing `parseMatchResponse` validation (already
   covers wrong-shape `match` values from the Task 9 fix).
4. For each accepted match, calls the image-edit provider (see below) to
   produce an edited photo. A provider failure marks the proposal
   `edit_failed` rather than aborting the cycle (existing behavior, kept).
5. Stores/updates proposals via the new `@lhr/db` module (see Data Model).
6. Calls `reconcileApprovedProposals` (ported, with its existing fixes:
   `getFile` wrapped in try/catch so one transient GitHub error doesn't
   abort the whole cycle, and `StaleImageTargetError` now terminal via
   `markProposalStatus(pool, id, 'stale')`).
7. Returns a `JobResult` summarizing candidates found / matched / edited /
   proposed / reconciled, following the `{status, summary, details}` shape
   every sibling job already returns.

## Data model

`product_placement_proposals` moves into `packages/db` as a new module,
`packages/db/src/productPlacementProposals.ts`, following the existing
module-per-table convention (one file per table, re-exported from
`packages/db/src/index.ts` alongside `affiliateCandidates.ts`,
`recipeCandidates.ts`, etc.). It uses `@lhr/db`'s shared `getPool()`
singleton rather than a passed-in `Pool`, and — like every sibling module —
never calls `.end()`; the pool is a small bounded connection pool reused for
the process's lifetime, not one connection held open forever. Exports:
`createProposal`, `getPendingProposals` (status IN `pending`,
`edit_failed` — the fix from the original branch that makes `edit_failed`
proposals visible/rejectable instead of silently re-proposed every cycle),
`getApprovedProposals`, `markProposalStatus`, `getProposalById`. The table
schema (columns, status enum values including `edit_failed` and `stale`)
carries over unchanged from the original design — those aren't
orchestrator-specific.

## LLM matching

Reuses `@lhr/llm`'s existing `callLLM(messages, options?)` untouched — the
matching prompt is plain text in, text out, exactly like every other
caller. No changes needed to `@lhr/llm` for this part.

## Image editing — `callLLM` overload

`@lhr/llm` gains a second call shape rather than a second entry point:

```ts
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface LlmMessage {
  role: 'system' | 'user';
  content: string | ContentPart[];
}

export interface CallLlmOptions {
  deadline?: number;
}

export interface CallLlmImageOptions extends CallLlmOptions {
  responseFormat: 'image';
  models?: string[]; // image-capable model list; defaults to an internal image-model list
}

export function callLLM(messages: LlmMessage[], options?: CallLlmOptions): Promise<string>;
export function callLLM(
  messages: LlmMessage[],
  options: CallLlmImageOptions,
): Promise<{ imageBase64: string; contentType: string }>;
```

Both overloads share the same fetch/429-retry/timeout/deadline-budget
implementation; they differ only in the model list selected and how the
OpenRouter response is parsed (`choices[0].message.content` as a string vs.
as an image payload). Existing callers (every sibling job, the text-only
matching call above) are source-compatible with zero changes: they never
pass `responseFormat`, so they always hit the first, unchanged overload.
`LlmMessage.content` widens from `string` to `string | ContentPart[]` so an
image-edit call can send an instruction plus one or two image URLs as
input; no existing caller constructs `LlmMessage` in a way this breaks.

The ported `ImageEditProvider` abstraction and its OpenRouter free-tier
implementation move from the old `mcp-server/src/imageEdit/` into
`mcp-server/src/imageEdit/openrouterFreeProvider.ts`, now calling the new
image overload of `callLLM` instead of a bespoke OpenRouter fetch. Its
existing resilience (the whole fetch/parse/store sequence wrapped in
try/catch, both network-error and non-2xx paths returning `{error}` rather
than throwing) carries over unchanged; that behavior was already
independently required by the original spec and by the Task 6 review
finding.

## Review UI

Mirrors the affiliate-candidates feature exactly, against the current
SPA/JSON-API shape of `apps/lhr-office` (Express serves the Vite-built
`client/` bundle as static assets plus a `/api/*` JSON API gated by
`requireSupabaseAuth`; there is no server-rendered HTML page anymore):

- **`mcp-server/src/productPlacementOps.ts`**: plain functions
  `approveProductPlacement(db, githubToken, id)` and
  `rejectProductPlacement(db, id)`, mirroring
  `mcp-server/src/affiliateCandidateOps.ts`'s
  `approveAffiliateCandidate`/`denyAffiliateCandidate` — approve commits the
  edited photo + frontmatter update to the post via
  `commitFilesToMain`/`createGitHubClient` from `./github.js` (both already
  in `mcp-server/src/github.ts`) and then marks the proposal `approved`;
  reject marks it `rejected` with no GitHub write. A
  `ProposalNotFoundError` / `ProposalAlreadyDecidedError` pair mirrors
  `CandidateNotFoundError`/`CandidateAlreadyDecidedError`. Built into the
  `lhr-authoring-mcp-server` package's `dist-lib` build like every other ops
  module, so `apps/lhr-office` consumes it as
  `lhr-authoring-mcp-server/dist-lib/productPlacementOps.js`.
- **`apps/lhr-office/src/routes/productPlacements.ts`**: new Express
  router file mirroring `routes/candidates.ts` exactly — defines a
  `ProductPlacementOps` interface
  (`{ getPending: () => Promise<ProductPlacementProposal[]>, approve: (id: number) => Promise<ApprovedProductPlacement>, reject: (id: number) => Promise<RejectedProductPlacement> }`),
  a `defaultProductPlacementOps(db)` factory that wires the mcp-server ops
  functions above to `requireGitHubToken()`, and
  `createProductPlacementsRouter(ops)` exposing `GET /` (pending +
  `edit_failed` proposals), `POST /:id/approve`, `POST /:id/reject` — same
  try/catch → `res.json(...)` / `res.status(500).json({error})` pattern as
  every other router in that file.
- **`apps/lhr-office/src/server.ts`**: mount the new router the same way
  `candidates`/`trends`/`competitors` are mounted —
  `app.use('/api/product-placements', requireSupabaseAuth, createProductPlacementsRouter(productPlacements))`,
  with `productPlacements: ProductPlacementOps = defaultProductPlacementOps(db)`
  added as a new `createApp(...)` parameter (same position/pattern as the
  existing `candidates`/`affiliateCandidates` parameters). No feature-specific
  auth work is needed — Supabase JWT verification is already shared
  infrastructure that every `/api/*` router rides on.
- **Client**: add a `ProductPlacementProposal` interface to
  `client/src/lib/types.ts` (id, post slug, matched product, `beforeImageUrl`,
  `afterImageUrl`, status). Add a "Product placements" section to
  `client/src/pages/Approvals.tsx`, following the file's existing
  per-resource pattern — `useApiResource<ProductPlacementProposal[]>('/api/product-placements')`,
  a `<section>` with a `<ul>` of proposals, Approve/Reject buttons calling
  `apiFetch` through the same `runAction` helper already used by the
  recipe/affiliate/competitor sections in that file. Unlike those sections
  (plain text lists), each list item also renders a before/after `<img>`
  thumbnail pair — the one genuinely new UI element this feature needs,
  since nothing else on that page reviews an edited image.

## Testing approach

Matches sibling convention exactly, split by layer:

- **Job logic** (`matchProductsToRecipes.ts`, the matching/editing/
  reconciliation pipeline): tested via `vi.mock('@lhr/db', ...)` and
  `vi.mock('./github.js', ...)` module mocks in the job's own `.spec.ts`
  file, the same style as `sourceAffiliateCandidates.spec.ts` — no
  dependency injection for the job entry point itself.
- **Review-UI ops and routes** (`productPlacementOps.ts`,
  `routes/productPlacements.ts`): keep the existing DI-style ops-interface
  testing at two layers, both already established by the sibling
  candidates feature —
  `apps/lhr-office/tests/routes/productPlacements.test.ts` builds a bare
  Express app with `createProductPlacementsRouter(fakeOps)` and drives it
  with `supertest`, exactly like `tests/routes/candidates.test.ts`; and
  `client/src/pages/Approvals.test.tsx` gets new assertions that mock
  `apiFetch('/api/product-placements')` the same way it already mocks the
  recipe/affiliate/competitor endpoints, so the client test never needs a
  real Supabase session or backend. Neither layer needs a real GitHub
  token or database.
- **`@lhr/llm` image overload**: unit tests cover the new response-shape
  branch (`responseFormat: 'image'` → `{imageBase64, contentType}`) with
  the same 429-retry/timeout/deadline test cases the text overload already
  has, plus a type-level check that omitting `responseFormat` still returns
  `string`.
- Every test ported from the old branch (empty-frontmatter guard,
  wrong-shape `match` parsing, no-product-image → `edit_failed`,
  callLlm-rejection resilience, 502-path, `edit_failed`/`stale` terminal
  states, `reconcileApprovedProposals` call from the job) carries over,
  adapted to the new module-mock style where it now lives in job-logic
  code, or kept as-is where it's still ops/route code.

## Environment variables

Unchanged from the original spec: `KEEPA_API_KEY`, `IMAGE_EDIT_PROVIDER`,
`IMAGE_EDIT_MODEL` (already present in `.env.example`). No new variables —
the image overload reuses `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`.

## Rollout

1. Reset `claude/product-placement-design-hyis83` to a fresh branch off
   current `origin/main` (same branch name, entirely new history — the old
   Astro-based commits are discarded, not rebased).
2. Close PR #52 once the new branch has its own PR open and passing CI,
   noting it supersedes #52.
3. Build per the implementation plan generated from this spec (next step:
   `superpowers:writing-plans`).
4. Ship with the job unregistered (per Architecture above); registering it
   in `apps/lhr-office/src/registry.ts` is a deliberate follow-up once the
   image-edit path's future (OpenRouter free tier vs. local Mac Studio
   processing) is settled.
