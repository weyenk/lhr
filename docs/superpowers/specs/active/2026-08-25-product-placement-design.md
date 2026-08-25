# Product-in-Photo Placement — Design

**Date:** 2026-08-25
**Status:** Draft — fifth and last of the five sub-projects in this automation initiative (recipe
variant generator, affiliate sourcing agent, trends watcher, and weekly competitor analysis are
spec'd/in progress separately; the shared local orchestrator that schedules all five is the
remaining, separate spec)

**Builds on shared infrastructure:** lands in `apps/lhr-office` behind the existing
`requireAdminSession()` check, uses `@lhr/db` for its proposal queue, and uses `@lhr/github` to
commit approved changes — no new auth or hosting work. Directly depends on sub-project 2's output:
this pipeline only has something to do once affiliate-sourcing approvals exist.

## 1. Overview & Goals

Takes affiliate products that have been approved (sub-project 2) but never attached to a recipe,
finds the best-fit published recipe for each, picks a specific photo in that post, and uses an AI
image-editing step to composite the product into the photo. Every proposal — the match, the
chosen image, and the composited result — is reviewed and explicitly approved before anything
touches the live site, the same posture as the rest of this initiative.

**Primary success criteria:**
- Every unattached approved product eventually gets a proposed recipe match with a composited
  photo, reviewable at `office.loveheatrelationship.com/product-placements`.
- Approving a proposal updates the actual live post (frontmatter `affiliateLinkIds` +either the
  cover photo or one specific body image) with no separate publish step beyond that approval.
- The image-compositing step can move from a free model to a paid one later without touching the
  matching, review, or publish code around it.

**Explicitly out of scope for this phase:**
- Matching against draft/unpublished recipes (including sub-project 1's variant-generator drafts)
  — only the live, published post corpus.
- Re-attaching an already-used product to additional recipes — this phase targets unattached
  products only.
- Any automatic retry loop beyond "an unattached product can be re-matched in a future cycle if
  its last proposal was rejected" — no aggressive re-proposal scheduling.
- The shared local orchestrator/scheduler runner (final remaining spec).

## 2. Architecture & Data Flow

```
Local weekly cron — mcp-server/scripts/match-products-to-recipes.ts

1. Find candidates: every src/content/affiliate-links entry whose id
   does not appear in any published post's affiliateLinkIds, excluding
   any that already have a status='pending' proposal (avoid duplicate
   simultaneous proposals for the same product)

2. Per candidate product, one LLM call given:
   - the product (label, and whatever can be inferred from its url/tag)
   - the full published recipe corpus (title + ingredients, from
     src/content/posts)
   returns: best-fit post slug, and which specific image in that post
   (see §4 for how images are enumerated) is the best candidate,
   plus a short rationale — or "no good match" if nothing fits well
   enough, in which case no proposal is created this cycle for that
   product (not forced into a poor match)

3. Image edit: call the configured ImageEditProvider (§3) with the
   chosen photo + the product's own image + product name. Success →
   upload the result to the existing blob storage (the same pipeline
   attach_photo already uses) and record its URL. Failure → the
   proposal is still created with status='edit_failed' so the match
   itself (which took real LLM reasoning) isn't thrown away — see §6.

4. Write one product_placement_proposals row (§5) per candidate that
   got at least a match.

apps/lhr-office adds:
  /product-placements — pending proposals: original photo, composited
    photo (or "edit failed" state), match rationale, approve/reject.
  Approve → commits directly to the matched post's live MDX file (§4):
    adds the product to affiliateLinkIds, and updates coverPhoto or
    replaces the specific body image markdown line. The approval click
    is the confirmation — same pattern as sub-project 2's approve flow,
    now applied to modifying an already-published post.
  Reject → status only; the product remains eligible for re-matching
    in a future cycle since it's still unattached.
```

## 3. Swappable Image-Edit Provider

```ts
// mcp-server/src/imageEdit/types.ts
export interface ImageEditProvider {
  compositeProductIntoPhoto(input: {
    sourceImageUrl: string;
    productImageUrl: string;
    productName: string;
  }): Promise<{ resultImageUrl: string } | { error: string }>;
}
```

- `mcp-server/src/imageEdit/openrouterFreeProvider.ts` — the default implementation, calling
  whatever capable image-editing model is currently available for free/near-free on OpenRouter
  (model id configurable via env var, same pattern as the text-model configs in the other specs).
- `mcp-server/src/imageEdit/index.ts` — selects the active provider via an `IMAGE_EDIT_PROVIDER`
  env var (default `openrouter-free`). Moving to a paid provider later (e.g. Replicate) means
  adding one new file implementing `ImageEditProvider` and flipping the env var — nothing in the
  matching, proposal-storage, or approval-commit code changes.
- This is explicitly the least mature piece of the whole initiative: free image-editing models
  vary in quality/availability, which is exactly why proposals are reviewed before anything goes
  live, and why `edit_failed` is a first-class status rather than a crash.

## 4. Image Enumeration & Live-Post Update Mechanics

Neither of these exist in the current authoring pipeline today (the draft schema only has a single
structured `coverPhoto`; body images are unstructured markdown inside MDX prose) — new plumbing:

- **Enumeration** (`mcp-server/src/postImages.ts`): given a post's raw MDX file content, returns
  `{ kind: 'cover', url, alt }` from the frontmatter plus one entry per `![alt](url)` markdown
  image found in the body text, each carrying the exact matched line so it can be located again
  precisely on update.
- **Update on approval**:
  - Cover photo target: re-parse frontmatter (same approach as `buildPostFrontmatter`), set
    `coverPhoto` to the new URL, re-serialize, add the product's id to `affiliateLinkIds`, commit.
  - Body image target: string-replace the exact previously-captured markdown image line with one
    pointing at the new URL, leaving the rest of the MDX untouched; still add the product id to
    `affiliateLinkIds` in frontmatter via the same re-parse/re-serialize; commit both changes as
    one file write.
  - If the exact body-image line no longer exists at approval time (the post was edited between
    proposal creation and approval), the commit is aborted and the proposal is marked
    `status='stale'` rather than corrupting the file — see §6.

## 5. Data Model (added to `@lhr/db`)

```sql
CREATE TABLE product_placement_proposals (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  affiliate_link_id TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  target_image_kind TEXT NOT NULL,        -- 'cover' | 'body'
  target_image_url TEXT NOT NULL,         -- original photo being replaced
  target_image_line TEXT,                 -- exact matched markdown line, body targets only
  match_rationale TEXT NOT NULL,
  composited_image_url TEXT,              -- set once step 3 succeeds
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'edit_failed' | 'stale'
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 6. Error Handling & Edge Cases

- No good recipe match for a product: no proposal created this cycle (§2 step 2) — never forced
  into a low-quality match just to produce output.
- Image-edit step fails or times out: proposal still created as `status='edit_failed'` with
  `composited_image_url` null — visible in the review queue as "match found, image generation
  failed" rather than silently dropped.
- Post edited between proposal creation and approval such that the target body-image line no
  longer matches exactly: approval is refused, proposal flips to `status='stale'`, nothing is
  committed — never a best-effort/fuzzy replacement that risks corrupting the post.
- A product already has a `pending` proposal: skipped in discovery (§2 step 1) — never duplicate
  proposals in flight for the same product.
- GitHub commit fails after approval is recorded: proposal stays `approved` with no live change
  yet; next cron run's reconciliation pass (same pattern as sub-project 2 §7) retries the commit
  for any `approved` proposal whose target post doesn't yet reflect the change.

## 7. Testing Approach

- `postImages.test.ts` — enumeration of cover + body images from fixture MDX content, including
  posts with zero body images and posts with duplicate image URLs (distinguished by line context).
- `imageEdit` provider tests — the free-provider implementation against a mocked OpenRouter
  response (success and failure paths), and a fake second provider proving the interface swap
  requires no caller changes.
- Matching-script integration test: mocked LLM + mocked image-edit provider, asserting a
  `product_placement_proposals` row is created for a good match, none for "no good match," and
  `edit_failed` status when the image step fails but the match succeeded.
- Approval-commit tests: cover-photo update, body-image line replacement, and the stale-detection
  path when the target line has since changed.
- Page-level test for `/product-placements` (auth-gated, approve/reject actions) alongside the
  other office-app page tests.

## Out of Scope

- Matching against draft/unpublished recipes (§1).
- Re-attaching already-used products to additional recipes (§1).
- Aggressive re-proposal scheduling beyond simple future-cycle eligibility after rejection (§1).
- The shared local orchestrator/scheduler runner (§1) — the final remaining spec, now that all
  five individual agents are designed.
