# Squarespace Content Migration — Design

**Date:** 2026-07-12
**Status:** Approved for planning

## 1. Overview & Goals

The author's prior blog, hosted on Squarespace, was exported as a WordPress WXR file (`Squarespace-Wordpress-Export-07-12-2026.xml`, 22 posts, 2 pages, 22 image attachments). This spec covers migrating the 22 blog posts into this repo's content collection format so they render on the new site alongside newly-authored content.

**Primary success criteria:**
- All 22 legacy posts exist as valid `.mdx` files under `src/content/posts/`, passing the site's real Zod schema (`npm run build` succeeds, content renders via `RecipeLayout`).
- Each post reads naturally: narrative body intact, recipe (ingredients/steps) correctly structured, images preserved in their original position.
- Nothing merges to `main` (which auto-deploys) without the author's explicit review and approval, per `docs/CONSTITUTION.md` rule 1.

## 2. Source Data Findings

- All 22 WordPress `post` items are travel-story-plus-recipe hybrids (verified by keyword scan and spot-checks) — narrative followed by an embedded `Ingredients:`/`Instructions:` block. All 22 map to the site's `type: recipe` post schema, which supports a full free-text Markdown body (via `<Content />` in `RecipeLayout.astro`) plus structured `ingredients`/`steps` frontmatter.
- The site's `type: article` schema/layout renders `section.body` as a single plain `<p>`, with no Markdown or multi-paragraph support — a poor fit for this narrative content, and out of scope to change here (would be a schema/layout change affecting new-post authoring, requiring separate sign-off per `docs/RULES.md`).
- Each post has a `_thumbnail_id` in `wp:postmeta` resolving to one `attachment` item's `wp:attachment_url` — used as `coverPhoto`.
- Posts have 1–2 additional inline images in `content:encoded`, referenced by absolute `images.squarespace-cdn.com` URLs.
- Posts have `excerpt:encoded` (HTML) and `post_tag` categories. WordPress tags have no equivalent field in the current post schema and are out of scope for this migration.
- 2 WordPress `page` items (About, Contact) exist in the export but have no corresponding page template in the current site and are out of scope for this migration.

## 3. Decisions

- **Post type:** all 22 posts import as `type: recipe`. If any post turns out on inspection not to have a genuine, extractable ingredients/instructions block, it will be flagged for the author's review rather than force-fit.
- **Images:** kept as their original `images.squarespace-cdn.com` URLs (satisfies the schema's `z.string().url()` requirement). Not re-hosted to Vercel Blob storage.
- **Cover photo:** the `_thumbnail_id`-resolved attachment URL.
- **Alt text:** hand-written per photo, based on what the post's text says the photo depicts (originals are `alt=""`).
- **Excerpt:** carried over from `excerpt:encoded`, HTML stripped to plain text, into the optional `excerpt` frontmatter field.
- **Inline body images:** preserved in the Markdown body, in their original position, as `![alt](url)`.
- **Tags/categories:** dropped. No schema change.
- **About/Contact pages:** out of scope for this migration.
- **URLs:** the new site continues to serve posts only at `/posts/<slug>`. No `/blog/<slug>` redirects or routes are added — old Squarespace `/blog/<slug>` links will 404. (Explicitly decided against redirects/URL-scheme changes.)
- **Kitchenware/affiliate links:** legacy posts have none; `kitchenwareIds`/`affiliateLinkIds` are empty arrays.

## 4. Conversion Approach

**Script-assisted manual extraction**, chosen over a fully-automated parser (recipe formatting varies enough per post that regex-based auto-splitting risks mangling irreplaceable content) and over fully-manual transcription (risks copy errors on long CDN URLs/dates):

1. A one-off Node script (kept in the scratchpad, not committed — single-use migration tool, not project infrastructure) parses the WXR XML and produces per-post intermediate JSON: `slug` (`wp:post_name`), `date` (`wp:post_date`), `excerpt` (HTML-stripped), resolved cover photo URL, ordered list of inline image URLs, and the raw `content:encoded` HTML.
2. For each post, using that JSON as ground truth for URLs/dates, the narrative and embedded recipe are hand-converted into a `.mdx` file: HTML cleaned to Markdown, ingredients/steps extracted into frontmatter arrays, alt text and excerpt filled in, inline images preserved in place, any "tips/variations" content folded into the tail of the body.
3. Filenames reuse the original `wp:post_name` slug (e.g. `arancini-a-sicilian-street-food-sensation.mdx`), keeping `/posts/<slug>` stable and predictable.

## 5. Verification

- `npm run build` (Astro build + real Zod schema validation) must succeed with all 22 posts included.
- Spot-check a sample of rendered posts (`astro preview` or reading generated HTML) to confirm ingredients/steps and inline images render correctly via `RecipeLayout`.
- Existing test suite (`npm test`) must continue passing.

## 6. Workflow

- All work happens in an isolated git worktree (`.claude/worktrees/squarespace-migration`, branch `worktree-squarespace-migration`).
- On completion, a PR is opened for the author's review. Nothing is merged to `main` without her explicit approval, consistent with `docs/CONSTITUTION.md` rule 1 (no autonomous auto-publish).

## Out of Scope

- Re-hosting images to Vercel Blob storage.
- Adding a `tags` field to the shared post schema.
- About/Contact pages.
- `/blog/<slug>` redirects or routing.
- Changes to the `article` post type/schema.
