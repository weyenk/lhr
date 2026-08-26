# Product-in-Photo Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pipeline that matches unattached approved affiliate products to published
recipe posts, composites the product into a chosen photo via a swappable AI image-edit provider,
and lets the site's author review/approve/reject each proposal in `apps/lhr-office` before
anything touches the live site.

**Architecture:** A pure matching/prompt layer (mcp-server) discovers unattached products and asks
an LLM to pick the best post + photo; a swappable `ImageEditProvider` composites the product into
that photo; results land as rows in a new `@lhr/db` table. `apps/lhr-office` renders the pending
queue and, on approval, rewrites the live post's MDX (frontmatter + one image) via `@lhr/github`.
The MDX-parsing logic (image enumeration + in-place update) is shared by both the mcp-server cron
job and the office app's approve route, so it lives in a new small shared package rather than
inside either app — see the Global Constraints note on this below.

**Tech Stack:** TypeScript, Astro (apps/lhr-office, server output on Vercel), Postgres via `pg`
(`@lhr/db`), Octokit (`@lhr/github`), `js-yaml`, Vitest, OpenRouter (chat completions API, both
text and multimodal image-output calls).

**Spec:** `docs/superpowers/specs/active/2026-08-25-product-placement-design.md`

## Global Constraints

- **Hard precondition — do not start Task 1 until this is true.** This plan's code assumes
  `packages/db`, `packages/github`, and `apps/lhr-office` already exist on `main` (they land via
  the separately-executed affiliate-sourcing-agent-design plan, sub-project 2), and that
  `mcp-server/src/openrouter.ts` (exporting `callOpenRouter`) already exists on `main` (it lands
  via the recipe-variant-generator plan, sub-project 1). As of this plan's writing, **neither has
  merged to `main` yet** — verified by checking `origin/main`, which has neither `apps/` nor
  `mcp-server/src/openrouter.ts`. Before Task 1: confirm both have merged (or rebase this branch
  onto branches that include them). Every file path and import below assumes they're present.
- **Deviation from the spec's file placement (read this before Task 3).** The spec's §4 describes
  the image-enumeration and update logic as living in `mcp-server/src/`. That doesn't work:
  `apps/lhr-office`'s approval route needs the exact same logic (to apply the update when an admin
  clicks Approve), and `apps/lhr-office` cannot import from `mcp-server/src/*` — they're sibling
  npm workspaces, not a library relationship (only `mcp-server`'s own `package.json` declares
  dependencies on `@lhr/*` packages; nothing lets it export code to other workspaces). This plan
  puts that logic in a new shared package, `@lhr/content` (`packages/content`), consumed by both
  `mcp-server` and `apps/lhr-office`, following the same pattern already used for `@lhr/db` and
  `@lhr/github`. Everything else in the spec is unaffected.
- **Auth pattern:** every new `apps/lhr-office` route calls `requireSession()` /
  `AuthNotConfiguredError` from `apps/lhr-office/src/lib/auth.ts` first, exactly like the existing
  `/affiliate-review` routes (verified in that file, added by sub-project 2). If a real
  `requireAdminSession()` has since replaced it (per the trends-watcher spec), swap the import
  1:1 in each file this plan touches — same call shape, no other route changes. That swap is out
  of this plan's scope.
- **DB access:** `getPool()` from `apps/lhr-office/src/lib/db.ts`; migrations run via
  `runMigrations()` in `packages/db/src/migrate.ts`.
- **GitHub commits:** `createGitHubClient` / `getFile` / `commitFilesToMain` from `@lhr/github`
  (office app) or the identical local copy at `mcp-server/src/github.ts` (mcp-server keeps using
  its own copy — nothing in this plan unifies the two, that's out of scope).
- **Repo:** `weyenk/lhr`, `main` branch — all commits from this feature write directly to `main`
  via `commitFilesToMain`, matching every existing publish/approve flow in this codebase.
- **Env vars added by this plan:** `IMAGE_EDIT_PROVIDER` (default `openrouter-free`),
  `IMAGE_EDIT_MODEL` (default baked into code, overridable). `OPENROUTER_API_KEY` and
  `AUTHOR_GITHUB_TOKEN` are assumed already present in `.env.example` from the sub-projects this
  plan depends on.

---

## File Structure

```
packages/content/                          NEW package — MDX post image logic shared by
  package.json                             mcp-server (cron) and apps/lhr-office (approve route)
  tsconfig.json
  vitest.config.ts
  src/
    postImages.ts                          enumeratePostImages()
    postImageUpdate.ts                     applyProductPlacement(), StaleImageTargetError
    index.ts
  tests/
    postImages.test.ts
    postImageUpdate.test.ts

packages/db/src/
  schema.ts                                MODIFY — add PRODUCT_PLACEMENT_PROPOSALS_TABLE_SQL
  migrate.ts                               MODIFY — run the new table's migration
  productPlacementProposals.ts             NEW — CRUD for the proposal queue
  index.ts                                 MODIFY — export the new file

mcp-server/src/
  publishedPosts.ts                        NEW — listPublishedPosts() (recipe posts only)
  productPlacementMatching.ts              NEW — computeUnattachedCandidates, buildMatchPrompt,
                                            parseMatchResponse (all pure)
  matchProductsToRecipes.ts                NEW — orchestration entry point + reconciliation
  imageEdit/
    types.ts                               NEW — ImageEditProvider interface
    openrouterFreeProvider.ts              NEW — default implementation
    index.ts                               NEW — provider selection via env var

apps/lhr-office/src/pages/
  index.astro                              MODIFY — add nav link
  product-placements/index.astro           NEW — review queue page
  api/product-placements/[id]/approve.ts   NEW
  api/product-placements/[id]/reject.ts    NEW

.env.example                               MODIFY — add IMAGE_EDIT_PROVIDER, IMAGE_EDIT_MODEL
```

---

## Task 1: DB schema — `product_placement_proposals` table

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/migrate.ts`
- Test: `packages/db/tests/migrate.test.ts`

**Interfaces:**
- Produces: `PRODUCT_PLACEMENT_PROPOSALS_TABLE_SQL` (exported constant), and `runMigrations()`
  (already exported) now also creates this table.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/tests/migrate.test.ts` (alongside the existing `describe('runMigrations', ...)`
block — do not remove the existing tests):

```ts
it('creates the product_placement_proposals table', async () => {
  const pool = { query: vi.fn().mockResolvedValue(undefined) };
  await runMigrations(pool as never);
  const calls = pool.query.mock.calls.map((c) => c[0] as string);
  expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS product_placement_proposals'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/db`
Expected: FAIL — no query contains `product_placement_proposals`.

- [ ] **Step 3: Implement**

Add to `packages/db/src/schema.ts`:

```ts
export const PRODUCT_PLACEMENT_PROPOSALS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS product_placement_proposals (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  affiliate_link_id TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  target_image_kind TEXT NOT NULL,
  target_image_url TEXT NOT NULL,
  target_image_line TEXT,
  match_rationale TEXT NOT NULL,
  composited_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
```

Modify `packages/db/src/migrate.ts`:

```ts
import type { Pool } from 'pg';
import {
  CANDIDATES_TABLE_SQL,
  DECISION_HISTORY_TABLE_SQL,
  CANDIDATES_CYCLE_ASIN_UNIQUE_INDEX_SQL,
  PRODUCT_PLACEMENT_PROPOSALS_TABLE_SQL,
} from './schema.js';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(CANDIDATES_TABLE_SQL);
  await pool.query(DECISION_HISTORY_TABLE_SQL);
  await pool.query(CANDIDATES_CYCLE_ASIN_UNIQUE_INDEX_SQL);
  await pool.query(PRODUCT_PLACEMENT_PROPOSALS_TABLE_SQL);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/db`
Expected: PASS (all `migrate.test.ts` tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/tests/migrate.test.ts
git commit -m "feat(db): add product_placement_proposals table"
```

---

## Task 2: DB access layer — proposal CRUD

**Files:**
- Create: `packages/db/src/productPlacementProposals.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/tests/productPlacementProposals.test.ts`

**Interfaces:**
- Consumes: nothing new (raw `pg` `Pool`).
- Produces (used by Tasks 10, 11, 13, 14):
  - `type ProductPlacementImageKind = 'cover' | 'body'`
  - `type ProductPlacementStatus = 'pending' | 'approved' | 'rejected' | 'edit_failed' | 'stale'`
  - `interface ProductPlacementProposal { id: number; cycleId: string; affiliateLinkId: string; postSlug: string; targetImageKind: ProductPlacementImageKind; targetImageUrl: string; targetImageLine: string | null; matchRationale: string; compositedImageUrl: string | null; status: ProductPlacementStatus; decidedAt: Date | null; createdAt: Date; }`
  - `interface NewProductPlacementProposal { cycleId: string; affiliateLinkId: string; postSlug: string; targetImageKind: ProductPlacementImageKind; targetImageUrl: string; targetImageLine: string | null; matchRationale: string; compositedImageUrl: string | null; status: 'pending' | 'edit_failed'; }`
  - `insertProductPlacementProposal(pool: Pool, proposal: NewProductPlacementProposal): Promise<number>`
  - `getPendingProposals(pool: Pool): Promise<ProductPlacementProposal[]>`
  - `getProposalById(pool: Pool, id: number): Promise<ProductPlacementProposal | null>`
  - `markProposalStatus(pool: Pool, id: number, status: 'approved' | 'rejected' | 'stale'): Promise<void>`
  - `getPendingAffiliateLinkIds(pool: Pool): Promise<Set<string>>`
  - `getApprovedProposals(pool: Pool): Promise<ProductPlacementProposal[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/tests/productPlacementProposals.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertProductPlacementProposal,
  getPendingProposals,
  getProposalById,
  markProposalStatus,
  getPendingAffiliateLinkIds,
  getApprovedProposals,
  type NewProductPlacementProposal,
} from '../src/productPlacementProposals';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const baseProposal: NewProductPlacementProposal = {
  cycleId: '2026-08-25',
  affiliateLinkId: 'bamboo-skewers-1234',
  postSlug: 'chicago-deep-dish-pizza',
  targetImageKind: 'body',
  targetImageUrl: 'https://example.com/original.jpg',
  targetImageLine: '![A photo](https://example.com/original.jpg)',
  matchRationale: 'Skewers pair well with this recipe\'s garnish step.',
  compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertProductPlacementProposal', () => {
  it('inserts a row and returns its id', async () => {
    const pool = mockPool([{ id: 42 }]);
    const id = await insertProductPlacementProposal(pool as never, baseProposal);
    expect(id).toBe(42);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO product_placement_proposals');
    expect(params).toEqual([
      '2026-08-25', 'bamboo-skewers-1234', 'chicago-deep-dish-pizza', 'body',
      'https://example.com/original.jpg', '![A photo](https://example.com/original.jpg)',
      'Skewers pair well with this recipe\'s garnish step.', 'https://example.com/composited.jpg', 'pending',
    ]);
  });
});

const dbRow = {
  id: 42, cycle_id: '2026-08-25', affiliate_link_id: 'bamboo-skewers-1234',
  post_slug: 'chicago-deep-dish-pizza', target_image_kind: 'body',
  target_image_url: 'https://example.com/original.jpg',
  target_image_line: '![A photo](https://example.com/original.jpg)',
  match_rationale: 'Skewers pair well with this recipe\'s garnish step.',
  composited_image_url: 'https://example.com/composited.jpg',
  status: 'pending', decided_at: null, created_at: new Date('2026-08-25T00:00:00Z'),
};

describe('getPendingProposals', () => {
  it('maps rows to camelCase and filters by status in the query', async () => {
    const pool = mockPool([dbRow]);
    const result = await getPendingProposals(pool as never);
    expect(result).toEqual([{
      id: 42, cycleId: '2026-08-25', affiliateLinkId: 'bamboo-skewers-1234',
      postSlug: 'chicago-deep-dish-pizza', targetImageKind: 'body',
      targetImageUrl: 'https://example.com/original.jpg',
      targetImageLine: '![A photo](https://example.com/original.jpg)',
      matchRationale: 'Skewers pair well with this recipe\'s garnish step.',
      compositedImageUrl: 'https://example.com/composited.jpg',
      status: 'pending', decidedAt: null, createdAt: new Date('2026-08-25T00:00:00Z'),
    }]);
    expect(pool.query.mock.calls[0][0]).toContain("status = 'pending'");
  });
});

describe('getProposalById', () => {
  it('returns null when no row matches', async () => {
    const pool = mockPool([]);
    expect(await getProposalById(pool as never, 999)).toBeNull();
  });
});

describe('markProposalStatus', () => {
  it('sets status and decided_at', async () => {
    const pool = mockPool();
    await markProposalStatus(pool as never, 42, 'approved');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('SET status = $1, decided_at = now()');
    expect(params).toEqual(['approved', 42]);
  });
});

describe('getPendingAffiliateLinkIds', () => {
  it('returns a Set of affiliate_link_id for pending proposals', async () => {
    const pool = mockPool([{ affiliate_link_id: 'a' }, { affiliate_link_id: 'b' }]);
    const result = await getPendingAffiliateLinkIds(pool as never);
    expect(result).toEqual(new Set(['a', 'b']));
  });
});

describe('getApprovedProposals', () => {
  it('maps rows to camelCase and filters by approved status', async () => {
    const pool = mockPool([{ ...dbRow, status: 'approved', decided_at: new Date('2026-08-26T00:00:00Z') }]);
    const result = await getApprovedProposals(pool as never);
    expect(result[0].status).toBe('approved');
    expect(pool.query.mock.calls[0][0]).toContain("status = 'approved'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/db`
Expected: FAIL — `../src/productPlacementProposals` does not exist.

- [ ] **Step 3: Implement**

Create `packages/db/src/productPlacementProposals.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export type ProductPlacementImageKind = 'cover' | 'body';
export type ProductPlacementStatus = 'pending' | 'approved' | 'rejected' | 'edit_failed' | 'stale';

export interface ProductPlacementProposal {
  id: number;
  cycleId: string;
  affiliateLinkId: string;
  postSlug: string;
  targetImageKind: ProductPlacementImageKind;
  targetImageUrl: string;
  targetImageLine: string | null;
  matchRationale: string;
  compositedImageUrl: string | null;
  status: ProductPlacementStatus;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface NewProductPlacementProposal {
  cycleId: string;
  affiliateLinkId: string;
  postSlug: string;
  targetImageKind: ProductPlacementImageKind;
  targetImageUrl: string;
  targetImageLine: string | null;
  matchRationale: string;
  compositedImageUrl: string | null;
  status: 'pending' | 'edit_failed';
}

interface ProposalRow {
  id: number;
  cycle_id: string;
  affiliate_link_id: string;
  post_slug: string;
  target_image_kind: ProductPlacementImageKind;
  target_image_url: string;
  target_image_line: string | null;
  match_rationale: string;
  composited_image_url: string | null;
  status: ProductPlacementStatus;
  decided_at: Date | null;
  created_at: Date;
}

function rowToProposal(row: ProposalRow): ProductPlacementProposal {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    affiliateLinkId: row.affiliate_link_id,
    postSlug: row.post_slug,
    targetImageKind: row.target_image_kind,
    targetImageUrl: row.target_image_url,
    targetImageLine: row.target_image_line,
    matchRationale: row.match_rationale,
    compositedImageUrl: row.composited_image_url,
    status: row.status,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function insertProductPlacementProposal(
  pool: Pool,
  proposal: NewProductPlacementProposal,
): Promise<number> {
  const res = (await pool.query(
    `INSERT INTO product_placement_proposals
       (cycle_id, affiliate_link_id, post_slug, target_image_kind, target_image_url,
        target_image_line, match_rationale, composited_image_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      proposal.cycleId, proposal.affiliateLinkId, proposal.postSlug, proposal.targetImageKind,
      proposal.targetImageUrl, proposal.targetImageLine, proposal.matchRationale,
      proposal.compositedImageUrl, proposal.status,
    ],
  )) as QueryResult<{ id: number }>;
  return res.rows[0].id;
}

export async function getPendingProposals(pool: Pool): Promise<ProductPlacementProposal[]> {
  const res = (await pool.query(
    `SELECT * FROM product_placement_proposals WHERE status = 'pending' ORDER BY created_at ASC`,
  )) as QueryResult<ProposalRow>;
  return res.rows.map(rowToProposal);
}

export async function getProposalById(pool: Pool, id: number): Promise<ProductPlacementProposal | null> {
  const res = (await pool.query(
    `SELECT * FROM product_placement_proposals WHERE id = $1`,
    [id],
  )) as QueryResult<ProposalRow>;
  return res.rows[0] ? rowToProposal(res.rows[0]) : null;
}

export async function markProposalStatus(
  pool: Pool,
  id: number,
  status: 'approved' | 'rejected' | 'stale',
): Promise<void> {
  await pool.query(
    `UPDATE product_placement_proposals SET status = $1, decided_at = now() WHERE id = $2`,
    [status, id],
  );
}

export async function getPendingAffiliateLinkIds(pool: Pool): Promise<Set<string>> {
  const res = (await pool.query(
    `SELECT DISTINCT affiliate_link_id FROM product_placement_proposals WHERE status = 'pending'`,
  )) as QueryResult<{ affiliate_link_id: string }>;
  return new Set(res.rows.map((r) => r.affiliate_link_id));
}

export async function getApprovedProposals(pool: Pool): Promise<ProductPlacementProposal[]> {
  const res = (await pool.query(
    `SELECT * FROM product_placement_proposals WHERE status = 'approved' ORDER BY decided_at ASC`,
  )) as QueryResult<ProposalRow>;
  return res.rows.map(rowToProposal);
}
```

Modify `packages/db/src/index.ts` — add one line:

```ts
export * from './productPlacementProposals.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/productPlacementProposals.ts packages/db/src/index.ts packages/db/tests/productPlacementProposals.test.ts
git commit -m "feat(db): add product placement proposal CRUD"
```

---

## Task 3: `@lhr/content` package + post image enumeration

**Files:**
- Create: `packages/content/package.json`
- Create: `packages/content/tsconfig.json`
- Create: `packages/content/vitest.config.ts`
- Create: `packages/content/src/postImages.ts`
- Create: `packages/content/src/index.ts`
- Test: `packages/content/tests/postImages.test.ts`
- Modify: `package.json` (root) — add `"packages/content"` to `workspaces`, and add
  `"npm run build --workspace=@lhr/content"` to the `postinstall` script (alongside the existing
  `@lhr/schemas`/`@lhr/github`/`@lhr/db` builds)
- Modify: `mcp-server/package.json` — add `"@lhr/content": "*"` to `dependencies`
- Modify: `apps/lhr-office/package.json` — add `"@lhr/content": "*"` to `dependencies`

**Interfaces:**
- Produces (used by Task 4, and by mcp-server/office-app consumers in later tasks):
  `interface PostImage { kind: 'cover' | 'body'; url: string; alt: string; line: string | null; }`
  `enumeratePostImages(raw: string): PostImage[]`

- [ ] **Step 1: Create the package scaffold**

`packages/content/package.json`:

```json
{
  "name": "@lhr/content",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/content/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`packages/content/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 2: Wire the new workspace into the monorepo**

In root `package.json`, add `"packages/content"` to the `workspaces` array, and add
`&& npm run build --workspace=@lhr/content` to the end of the existing `postinstall` script.

In `mcp-server/package.json`'s `dependencies`, add `"@lhr/content": "*"`.

In `apps/lhr-office/package.json`'s `dependencies`, add `"@lhr/content": "*"`.

Run `npm install` from the repo root so the workspace symlinks are created.

- [ ] **Step 3: Write the failing test**

Create `packages/content/tests/postImages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { enumeratePostImages } from '../src/postImages';

const withCoverAndBody = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
---

Some intro text.

![First body photo](https://example.com/body1.jpg)

More text.

![Second body photo](https://example.com/body2.jpg)
`;

const coverOnly = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
---

No body images here, just prose.
`;

const duplicateUrls = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
---

![First occurrence](https://example.com/same.jpg)

![Second occurrence](https://example.com/same.jpg)
`;

describe('enumeratePostImages', () => {
  it('returns the cover photo followed by each body image in document order', () => {
    const images = enumeratePostImages(withCoverAndBody);
    expect(images).toEqual([
      { kind: 'cover', url: 'https://example.com/cover.jpg', alt: 'Cover alt text', line: null },
      {
        kind: 'body', url: 'https://example.com/body1.jpg', alt: 'First body photo',
        line: '![First body photo](https://example.com/body1.jpg)',
      },
      {
        kind: 'body', url: 'https://example.com/body2.jpg', alt: 'Second body photo',
        line: '![Second body photo](https://example.com/body2.jpg)',
      },
    ]);
  });

  it('returns only the cover photo when the post has zero body images', () => {
    const images = enumeratePostImages(coverOnly);
    expect(images).toEqual([
      { kind: 'cover', url: 'https://example.com/cover.jpg', alt: 'Cover alt text', line: null },
    ]);
  });

  it('distinguishes two body images sharing the same URL by their distinct lines', () => {
    const images = enumeratePostImages(duplicateUrls);
    const bodyImages = images.filter((img) => img.kind === 'body');
    expect(bodyImages).toHaveLength(2);
    expect(bodyImages[0].line).toBe('![First occurrence](https://example.com/same.jpg)');
    expect(bodyImages[1].line).toBe('![Second occurrence](https://example.com/same.jpg)');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace=packages/content`
Expected: FAIL — `../src/postImages` does not exist.

- [ ] **Step 5: Implement**

Create `packages/content/src/postImages.ts`:

```ts
import yaml from 'js-yaml';

export interface PostImage {
  kind: 'cover' | 'body';
  url: string;
  alt: string;
  line: string | null;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const BODY_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/gm;

export function enumeratePostImages(raw: string): PostImage[] {
  const images: PostImage[] = [];
  const frontmatterMatch = raw.match(FRONTMATTER_RE);

  if (frontmatterMatch) {
    const frontmatter = yaml.load(frontmatterMatch[1]) as { coverPhoto?: string; coverPhotoAlt?: string };
    if (frontmatter.coverPhoto) {
      images.push({ kind: 'cover', url: frontmatter.coverPhoto, alt: frontmatter.coverPhotoAlt ?? '', line: null });
    }
  }

  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  for (const match of body.matchAll(BODY_IMAGE_RE)) {
    images.push({ kind: 'body', url: match[2], alt: match[1], line: match[0] });
  }

  return images;
}
```

Create `packages/content/src/index.ts`:

```ts
export * from './postImages.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=packages/content`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/content package.json mcp-server/package.json apps/lhr-office/package.json package-lock.json
git commit -m "feat(content): add @lhr/content package with post image enumeration"
```

---

## Task 4: `@lhr/content` — apply a product placement update to a post

**Files:**
- Create: `packages/content/src/postImageUpdate.ts`
- Modify: `packages/content/src/index.ts`
- Test: `packages/content/tests/postImageUpdate.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 11, 13):
  - `class StaleImageTargetError extends Error`
  - `interface ProductPlacementUpdate { targetImageKind: 'cover' | 'body'; targetImageUrl: string; targetImageLine: string | null; compositedImageUrl: string; affiliateLinkId: string; }`
  - `applyProductPlacement(raw: string, update: ProductPlacementUpdate): string` — throws `StaleImageTargetError` if the target no longer matches.

- [ ] **Step 1: Write the failing test**

Create `packages/content/tests/postImageUpdate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyProductPlacement, StaleImageTargetError } from '../src/postImageUpdate';

const post = `---
title: "Test"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "Cover alt text"
affiliateLinkIds: []
---

Intro text.

![A body photo](https://example.com/body.jpg)

More text.
`;

describe('applyProductPlacement', () => {
  it('replaces the cover photo and adds the affiliate link id', () => {
    const result = applyProductPlacement(post, {
      targetImageKind: 'cover',
      targetImageUrl: 'https://example.com/cover.jpg',
      targetImageLine: null,
      compositedImageUrl: 'https://example.com/composited-cover.jpg',
      affiliateLinkId: 'bamboo-skewers-1234',
    });
    expect(result).toContain('coverPhoto: https://example.com/composited-cover.jpg');
    expect(result).toContain('bamboo-skewers-1234');
    expect(result).toContain('![A body photo](https://example.com/body.jpg)');
  });

  it('throws StaleImageTargetError when the cover photo has since changed', () => {
    expect(() =>
      applyProductPlacement(post, {
        targetImageKind: 'cover',
        targetImageUrl: 'https://example.com/a-different-cover.jpg',
        targetImageLine: null,
        compositedImageUrl: 'https://example.com/composited-cover.jpg',
        affiliateLinkId: 'bamboo-skewers-1234',
      }),
    ).toThrow(StaleImageTargetError);
  });

  it('replaces a body image line, leaving the rest of the body untouched', () => {
    const result = applyProductPlacement(post, {
      targetImageKind: 'body',
      targetImageUrl: 'https://example.com/body.jpg',
      targetImageLine: '![A body photo](https://example.com/body.jpg)',
      compositedImageUrl: 'https://example.com/composited-body.jpg',
      affiliateLinkId: 'bamboo-skewers-1234',
    });
    expect(result).toContain('![A body photo](https://example.com/composited-body.jpg)');
    expect(result).toContain('coverPhoto: https://example.com/cover.jpg');
    expect(result).toContain('bamboo-skewers-1234');
  });

  it('throws StaleImageTargetError when the target body line no longer exists', () => {
    expect(() =>
      applyProductPlacement(post, {
        targetImageKind: 'body',
        targetImageUrl: 'https://example.com/body.jpg',
        targetImageLine: '![A body photo that was edited](https://example.com/body.jpg)',
        compositedImageUrl: 'https://example.com/composited-body.jpg',
        affiliateLinkId: 'bamboo-skewers-1234',
      }),
    ).toThrow(StaleImageTargetError);
  });

  it('does not duplicate an affiliate link id that is already present', () => {
    const postWithId = post.replace('affiliateLinkIds: []', 'affiliateLinkIds:\n  - bamboo-skewers-1234');
    const result = applyProductPlacement(postWithId, {
      targetImageKind: 'cover',
      targetImageUrl: 'https://example.com/cover.jpg',
      targetImageLine: null,
      compositedImageUrl: 'https://example.com/composited-cover.jpg',
      affiliateLinkId: 'bamboo-skewers-1234',
    });
    expect(result.match(/bamboo-skewers-1234/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/content`
Expected: FAIL — `../src/postImageUpdate` does not exist.

- [ ] **Step 3: Implement**

Create `packages/content/src/postImageUpdate.ts`:

```ts
import yaml from 'js-yaml';

export class StaleImageTargetError extends Error {
  constructor() {
    super('The target image no longer matches the current post content; refusing to update.');
    this.name = 'StaleImageTargetError';
  }
}

export interface ProductPlacementUpdate {
  targetImageKind: 'cover' | 'body';
  targetImageUrl: string;
  targetImageLine: string | null;
  compositedImageUrl: string;
  affiliateLinkId: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function applyProductPlacement(raw: string, update: ProductPlacementUpdate): string {
  const frontmatterMatch = raw.match(FRONTMATTER_RE);
  if (!frontmatterMatch) throw new Error('No frontmatter delimiters found in post content');

  const frontmatter = yaml.load(frontmatterMatch[1]) as Record<string, unknown>;
  const body = raw.slice(frontmatterMatch[0].length);

  const existingIds = Array.isArray(frontmatter.affiliateLinkIds) ? (frontmatter.affiliateLinkIds as string[]) : [];
  frontmatter.affiliateLinkIds = existingIds.includes(update.affiliateLinkId)
    ? existingIds
    : [...existingIds, update.affiliateLinkId];

  if (update.targetImageKind === 'cover') {
    if (frontmatter.coverPhoto !== update.targetImageUrl) throw new StaleImageTargetError();
    frontmatter.coverPhoto = update.compositedImageUrl;
    return `---\n${yaml.dump(frontmatter)}---\n${body}`;
  }

  if (!update.targetImageLine || !body.includes(update.targetImageLine)) {
    throw new StaleImageTargetError();
  }
  const newLine = update.targetImageLine.replace(/\(([^)]+)\)$/, `(${update.compositedImageUrl})`);
  const newBody = body.replace(update.targetImageLine, newLine);
  return `---\n${yaml.dump(frontmatter)}---\n${newBody}`;
}
```

Modify `packages/content/src/index.ts`:

```ts
export * from './postImages.js';
export * from './postImageUpdate.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/content`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content/src/postImageUpdate.ts packages/content/src/index.ts packages/content/tests/postImageUpdate.test.ts
git commit -m "feat(content): apply product placement updates to a post's MDX"
```

---

## Task 5: mcp-server — enumerate published recipe posts

**Files:**
- Create: `mcp-server/src/publishedPosts.ts`
- Test: `mcp-server/tests/publishedPosts.test.ts`

**Interfaces:**
- Consumes: `listFiles`, `getFile`, `type GitHubClient` from `mcp-server/src/github.ts` (existing).
- Produces (used by Task 10):
  `interface PublishedPost { slug: string; raw: string; title: string; ingredients: Array<{ item: string }>; affiliateLinkIds: string[]; }`
  `listPublishedPosts(client: GitHubClient): Promise<PublishedPost[]>` — recipe-type posts only.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/publishedPosts.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn() }));

import { listFiles, getFile } from '../src/github.js';
import { listPublishedPosts } from '../src/publishedPosts';

const recipeMdx = `---
type: recipe
title: "Test Recipe"
ingredients:
  - item: "Salt"
affiliateLinkIds: ["existing-link"]
---

Body text.
`;

const articleMdx = `---
type: article
title: "Test Article"
sections: []
affiliateLinkIds: []
---

Body text.
`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPublishedPosts', () => {
  it('returns only recipe-type posts, with title/ingredients/affiliateLinkIds parsed from frontmatter', async () => {
    vi.mocked(listFiles).mockResolvedValue(['test-recipe.mdx', 'test-article.mdx', 'ignored.txt']);
    vi.mocked(getFile).mockImplementation(async (_client, path) => {
      if (path === 'src/content/posts/test-recipe.mdx') return { content: recipeMdx, sha: 'abc' };
      if (path === 'src/content/posts/test-article.mdx') return { content: articleMdx, sha: 'def' };
      return null;
    });

    const posts = await listPublishedPosts({} as never);

    expect(posts).toEqual([
      {
        slug: 'test-recipe',
        raw: recipeMdx,
        title: 'Test Recipe',
        ingredients: [{ item: 'Salt' }],
        affiliateLinkIds: ['existing-link'],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `../src/publishedPosts` does not exist.

- [ ] **Step 3: Implement**

Create `mcp-server/src/publishedPosts.ts`:

```ts
import yaml from 'js-yaml';
import { listFiles, getFile, type GitHubClient } from './github.js';

export interface PublishedPost {
  slug: string;
  raw: string;
  title: string;
  ingredients: Array<{ item: string }>;
  affiliateLinkIds: string[];
}

interface RecipeFrontmatter {
  type?: string;
  title?: string;
  ingredients?: Array<{ item: string }>;
  affiliateLinkIds?: string[];
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export async function listPublishedPosts(client: GitHubClient): Promise<PublishedPost[]> {
  const files = await listFiles(client, 'src/content/posts', 'main');
  const posts: PublishedPost[] = [];

  for (const filename of files.filter((f) => f.endsWith('.mdx'))) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;

    const match = file.content.match(FRONTMATTER_RE);
    if (!match) continue;
    const frontmatter = yaml.load(match[1]) as RecipeFrontmatter;
    if (frontmatter.type !== 'recipe') continue;

    posts.push({
      slug: filename.replace(/\.mdx$/, ''),
      raw: file.content,
      title: frontmatter.title ?? '',
      ingredients: frontmatter.ingredients ?? [],
      affiliateLinkIds: frontmatter.affiliateLinkIds ?? [],
    });
  }

  return posts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/publishedPosts.ts mcp-server/tests/publishedPosts.test.ts
git commit -m "feat(mcp-server): list published recipe posts for product matching"
```

---

## Task 6: mcp-server — `ImageEditProvider` interface + OpenRouter free implementation

**Files:**
- Create: `mcp-server/src/imageEdit/types.ts`
- Create: `mcp-server/src/imageEdit/openrouterFreeProvider.ts`
- Test: `mcp-server/tests/imageEdit/openrouterFreeProvider.test.ts`

**Interfaces:**
- Consumes: `requireEnv`, `storeImageBuffer` from `mcp-server/src/blob.ts` (existing).
- Produces (used by Tasks 7, 10):
  `interface ImageEditProvider { compositeProductIntoPhoto(input: { sourceImageUrl: string; productImageUrl: string; productName: string; }): Promise<{ resultImageUrl: string } | { error: string }>; }`
  `openrouterFreeProvider: ImageEditProvider`

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/imageEdit/openrouterFreeProvider.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/blob.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/blob.js')>('../../src/blob.js');
  return { ...actual, storeImageBuffer: vi.fn().mockResolvedValue('https://r2.example.com/posts/stored.jpg') };
});

import { storeImageBuffer } from '../../src/blob.js';
import { openrouterFreeProvider } from '../../src/imageEdit/openrouterFreeProvider';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.IMAGE_EDIT_MODEL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('openrouterFreeProvider.compositeProductIntoPhoto', () => {
  it('decodes the returned data-URI image and stores it, returning the stored URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
      }),
    }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ resultImageUrl: 'https://r2.example.com/posts/stored.jpg' });
    expect(vi.mocked(storeImageBuffer)).toHaveBeenCalledWith(Buffer.from('aGVsbG8=', 'base64'), 'image/png');
  });

  it('returns an error when OpenRouter responds with no image', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: 'OpenRouter response had no generated image' });
  });

  it('returns an error when the OpenRouter request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    const result = await openrouterFreeProvider.compositeProductIntoPhoto({
      sourceImageUrl: 'https://example.com/source.jpg',
      productImageUrl: 'https://example.com/product.jpg',
      productName: 'Bamboo Skewers',
    });

    expect(result).toEqual({ error: 'OpenRouter request failed: 503' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `../../src/imageEdit/openrouterFreeProvider` does not exist.

- [ ] **Step 3: Implement**

Create `mcp-server/src/imageEdit/types.ts`:

```ts
export interface ImageEditProvider {
  compositeProductIntoPhoto(input: {
    sourceImageUrl: string;
    productImageUrl: string;
    productName: string;
  }): Promise<{ resultImageUrl: string } | { error: string }>;
}
```

Create `mcp-server/src/imageEdit/openrouterFreeProvider.ts`:

```ts
import { requireEnv, storeImageBuffer } from '../blob.js';
import type { ImageEditProvider } from './types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// A free, multimodal image-output-capable OpenRouter model as of this plan's writing.
// Confirm at implementation time that this (or an equivalent free model) is still available —
// free image-editing model availability on OpenRouter changes; that's exactly why this is a
// swappable, reviewed-before-publish step rather than a hardcoded assumption elsewhere.
const DEFAULT_MODEL = 'google/gemini-2.0-flash-exp:free';

interface OpenRouterImageChoice {
  message?: {
    images?: Array<{ type: 'image_url'; image_url: { url: string } }>;
  };
}

export const openrouterFreeProvider: ImageEditProvider = {
  async compositeProductIntoPhoto({ sourceImageUrl, productImageUrl, productName }) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.IMAGE_EDIT_MODEL ?? DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Composite this product ("${productName}") naturally into the scene of the first photo, matching its lighting and perspective.`,
              },
              { type: 'image_url', image_url: { url: sourceImageUrl } },
              { type: 'image_url', image_url: { url: productImageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return { error: `OpenRouter request failed: ${response.status}` };
    }

    const data = (await response.json()) as { choices?: OpenRouterImageChoice[] };
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      return { error: 'OpenRouter response had no generated image' };
    }

    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { error: 'OpenRouter returned a non-data-URI image, which is not supported yet' };
    }
    const [, contentType, base64] = match;
    const resultImageUrl = await storeImageBuffer(Buffer.from(base64, 'base64'), contentType);
    return { resultImageUrl };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/imageEdit/types.ts mcp-server/src/imageEdit/openrouterFreeProvider.ts mcp-server/tests/imageEdit/openrouterFreeProvider.test.ts
git commit -m "feat(mcp-server): add swappable ImageEditProvider with OpenRouter free default"
```

---

## Task 7: mcp-server — image-edit provider selection

**Files:**
- Create: `mcp-server/src/imageEdit/index.ts`
- Test: `mcp-server/tests/imageEdit/index.test.ts`

**Interfaces:**
- Consumes: `ImageEditProvider` (Task 6), `openrouterFreeProvider` (Task 6).
- Produces (used by Task 10): `getImageEditProvider(): ImageEditProvider`, re-exports `ImageEditProvider`.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/imageEdit/index.test.ts`:

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { getImageEditProvider, type ImageEditProvider } from '../../src/imageEdit/index';
import { openrouterFreeProvider } from '../../src/imageEdit/openrouterFreeProvider';

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getImageEditProvider', () => {
  it('defaults to the OpenRouter free provider', () => {
    delete process.env.IMAGE_EDIT_PROVIDER;
    expect(getImageEditProvider()).toBe(openrouterFreeProvider);
  });

  it('throws a clear error for an unknown provider key', () => {
    process.env.IMAGE_EDIT_PROVIDER = 'not-a-real-provider';
    expect(() => getImageEditProvider()).toThrow(/Unknown IMAGE_EDIT_PROVIDER/);
  });
});

describe('ImageEditProvider interface swap', () => {
  it('a fake provider satisfying the interface works with the same calling code as the real one', async () => {
    async function callProvider(provider: ImageEditProvider) {
      return provider.compositeProductIntoPhoto({
        sourceImageUrl: 'https://example.com/source.jpg',
        productImageUrl: 'https://example.com/product.jpg',
        productName: 'Test Product',
      });
    }

    const fakeProvider: ImageEditProvider = {
      async compositeProductIntoPhoto() {
        return { resultImageUrl: 'https://example.com/fake-result.jpg' };
      },
    };

    const result = await callProvider(fakeProvider);
    expect(result).toEqual({ resultImageUrl: 'https://example.com/fake-result.jpg' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `../../src/imageEdit/index` does not exist.

- [ ] **Step 3: Implement**

Create `mcp-server/src/imageEdit/index.ts`:

```ts
import type { ImageEditProvider } from './types.js';
import { openrouterFreeProvider } from './openrouterFreeProvider.js';

export type { ImageEditProvider } from './types.js';

const providers: Record<string, ImageEditProvider> = {
  'openrouter-free': openrouterFreeProvider,
};

export function getImageEditProvider(): ImageEditProvider {
  const key = process.env.IMAGE_EDIT_PROVIDER ?? 'openrouter-free';
  const provider = providers[key];
  if (!provider) throw new Error(`Unknown IMAGE_EDIT_PROVIDER: ${key}`);
  return provider;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/imageEdit/index.ts mcp-server/tests/imageEdit/index.test.ts
git commit -m "feat(mcp-server): select image-edit provider via IMAGE_EDIT_PROVIDER env var"
```

---

## Task 8: mcp-server — discover unattached approved products

**Files:**
- Create: `mcp-server/src/productPlacementMatching.ts`
- Test: `mcp-server/tests/productPlacementMatching.test.ts`

**Interfaces:**
- Consumes: nothing new (pure function).
- Produces (used by Tasks 9, 10):
  `interface AffiliateLinkCandidate { id: string; label: string; url: string; imageUrl?: string; }`
  `computeUnattachedCandidates(allLinks: AffiliateLinkCandidate[], attachedIds: Set<string>, pendingIds: Set<string>): AffiliateLinkCandidate[]`

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/productPlacementMatching.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeUnattachedCandidates, type AffiliateLinkCandidate } from '../src/productPlacementMatching';

const links: AffiliateLinkCandidate[] = [
  { id: 'bamboo-skewers-1234', label: 'Bamboo Skewers', url: 'https://amazon.com/x' },
  { id: 'ceramic-bowl-5678', label: 'Ceramic Bowl', url: 'https://amazon.com/y' },
  { id: 'chef-knife-9012', label: 'Chef Knife', url: 'https://amazon.com/z' },
];

describe('computeUnattachedCandidates', () => {
  it('excludes links already attached to a published post', () => {
    const result = computeUnattachedCandidates(links, new Set(['bamboo-skewers-1234']), new Set());
    expect(result.map((c) => c.id)).toEqual(['ceramic-bowl-5678', 'chef-knife-9012']);
  });

  it('excludes links with a pending proposal in flight', () => {
    const result = computeUnattachedCandidates(links, new Set(), new Set(['ceramic-bowl-5678']));
    expect(result.map((c) => c.id)).toEqual(['bamboo-skewers-1234', 'chef-knife-9012']);
  });

  it('returns all links when nothing is attached or pending', () => {
    const result = computeUnattachedCandidates(links, new Set(), new Set());
    expect(result).toHaveLength(3);
  });

  it('a product with a past rejected proposal remains a candidate (only pending is excluded)', () => {
    // Simulates: chef-knife-9012 had a proposal that was rejected — it does not appear in
    // pendingIds (only 'pending' status proposals do), so discovery naturally re-includes it.
    const result = computeUnattachedCandidates(links, new Set(), new Set());
    expect(result.map((c) => c.id)).toContain('chef-knife-9012');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `../src/productPlacementMatching` does not exist.

- [ ] **Step 3: Implement**

Create `mcp-server/src/productPlacementMatching.ts`:

```ts
export interface AffiliateLinkCandidate {
  id: string;
  label: string;
  url: string;
  imageUrl?: string;
}

export function computeUnattachedCandidates(
  allLinks: AffiliateLinkCandidate[],
  attachedIds: Set<string>,
  pendingIds: Set<string>,
): AffiliateLinkCandidate[] {
  return allLinks.filter((link) => !attachedIds.has(link.id) && !pendingIds.has(link.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/productPlacementMatching.ts mcp-server/tests/productPlacementMatching.test.ts
git commit -m "feat(mcp-server): discover unattached approved affiliate products"
```

---

## Task 9: mcp-server — LLM match prompt + response parsing

**Files:**
- Modify: `mcp-server/src/productPlacementMatching.ts`
- Test: `mcp-server/tests/productPlacementMatching.test.ts` (extend)

**Interfaces:**
- Consumes: `type OpenRouterMessage` from `mcp-server/src/openrouter.ts` (existing, from
  sub-project 1), `AffiliateLinkCandidate` (Task 8).
- Produces (used by Task 10):
  `interface MatchablePostImage { id: number; kind: 'cover' | 'body'; alt: string; }`
  `interface MatchablePost { slug: string; title: string; ingredients: string[]; images: MatchablePostImage[]; }`
  `interface MatchResult { slug: string; imageId: number; rationale: string; }`
  `buildMatchPrompt(product: AffiliateLinkCandidate, posts: MatchablePost[]): OpenRouterMessage[]`
  `parseMatchResponse(rawText: string, posts: MatchablePost[]): MatchResult | null`

Design note: the LLM is given only title/ingredients (per spec §2) plus each enumerated image's
`alt` text (from `@lhr/content`'s `enumeratePostImages`) — alt text is the only per-image signal
available without sending photos, and it's descriptive enough (e.g. "close-up of coconut curry
with tofu") to support picking a specific photo. An unparseable or invalid LLM response is treated
as "no match" (returns `null`), never thrown — consistent with the spec's general resilience
posture (a bad response for one product should not crash the whole cycle).

- [ ] **Step 1: Write the failing test**

Add to `mcp-server/tests/productPlacementMatching.test.ts`:

```ts
import { buildMatchPrompt, parseMatchResponse, type MatchablePost } from '../src/productPlacementMatching';

const posts: MatchablePost[] = [
  {
    slug: 'chicago-deep-dish-pizza',
    title: 'Chicago Deep Dish Pizza',
    ingredients: ['Mozzarella', 'Italian sausage'],
    images: [
      { id: 0, kind: 'cover', alt: 'A whole deep dish pizza fresh from the oven' },
      { id: 1, kind: 'body', alt: 'Slicing the pizza with a wooden pizza server' },
    ],
  },
];

describe('buildMatchPrompt', () => {
  it('includes the product and each post with its images, as a system + user message pair', () => {
    const product = { id: 'wooden-pizza-server-1234', label: 'Wooden Pizza Server', url: 'https://amazon.com/x' };
    const messages = buildMatchPrompt(product, posts);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    const userContent = JSON.parse(messages[1].content);
    expect(userContent.product.label).toBe('Wooden Pizza Server');
    expect(userContent.posts[0].slug).toBe('chicago-deep-dish-pizza');
    expect(userContent.posts[0].images).toEqual(posts[0].images);
  });
});

describe('parseMatchResponse', () => {
  it('parses a valid match response', () => {
    const raw = JSON.stringify({ match: { slug: 'chicago-deep-dish-pizza', imageId: 1, rationale: 'Used to serve the slice' } });
    expect(parseMatchResponse(raw, posts)).toEqual({
      slug: 'chicago-deep-dish-pizza', imageId: 1, rationale: 'Used to serve the slice',
    });
  });

  it('returns null for an explicit no-match response', () => {
    expect(parseMatchResponse(JSON.stringify({ match: null }), posts)).toBeNull();
  });

  it('returns null for unparseable JSON, never throwing', () => {
    expect(parseMatchResponse('not json at all', posts)).toBeNull();
  });

  it('returns null when the referenced slug does not exist', () => {
    const raw = JSON.stringify({ match: { slug: 'nonexistent-post', imageId: 0, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when the referenced imageId does not exist on that post', () => {
    const raw = JSON.stringify({ match: { slug: 'chicago-deep-dish-pizza', imageId: 99, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `buildMatchPrompt`/`parseMatchResponse` are not exported.

- [ ] **Step 3: Implement**

Add to `mcp-server/src/productPlacementMatching.ts`:

```ts
import type { OpenRouterMessage } from './openrouter.js';

export interface MatchablePostImage {
  id: number;
  kind: 'cover' | 'body';
  alt: string;
}

export interface MatchablePost {
  slug: string;
  title: string;
  ingredients: string[];
  images: MatchablePostImage[];
}

export interface MatchResult {
  slug: string;
  imageId: number;
  rationale: string;
}

export function buildMatchPrompt(product: AffiliateLinkCandidate, posts: MatchablePost[]): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content:
        'You match affiliate products to the best-fit recipe post on a food blog, and pick which ' +
        'photo in that post the product should be composited into. Respond with ONLY JSON, no ' +
        'other text, in exactly this shape: {"match": {"slug": string, "imageId": number, ' +
        '"rationale": string}} or {"match": null} if nothing fits well enough.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        product: { label: product.label, url: product.url },
        posts: posts.map((post) => ({
          slug: post.slug,
          title: post.title,
          ingredients: post.ingredients,
          images: post.images,
        })),
      }),
    },
  ];
}

export function parseMatchResponse(rawText: string, posts: MatchablePost[]): MatchResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  const match = (parsed as { match?: unknown } | null)?.match;
  if (!match || typeof match !== 'object') return null;

  const { slug, imageId, rationale } = match as Record<string, unknown>;
  if (typeof slug !== 'string' || typeof imageId !== 'number' || typeof rationale !== 'string') return null;

  const post = posts.find((p) => p.slug === slug);
  if (!post || !post.images.some((img) => img.id === imageId)) return null;

  return { slug, imageId, rationale };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/productPlacementMatching.ts mcp-server/tests/productPlacementMatching.test.ts
git commit -m "feat(mcp-server): add LLM match prompt building and response parsing"
```

---

## Task 10: mcp-server — `matchProductsToRecipes()` orchestration

**Files:**
- Create: `mcp-server/src/matchProductsToRecipes.ts`
- Test: `mcp-server/tests/matchProductsToRecipes.test.ts`

**Interfaces:**
- Consumes: `listPublishedPosts` (Task 5), `getImageEditProvider`, `type ImageEditProvider` (Task
  7), `computeUnattachedCandidates`, `buildMatchPrompt`, `parseMatchResponse`, `type
  AffiliateLinkCandidate`, `type MatchablePost` (Tasks 8–9), `enumeratePostImages` from
  `@lhr/content` (Task 3), `callOpenRouter`, `type OpenRouterMessage` from `./openrouter.js`
  (existing), `readCollection` from `./catalog.js` (existing), `insertProductPlacementProposal`,
  `getPendingAffiliateLinkIds`, `type NewProductPlacementProposal` from `@lhr/db` (Task 2).
- Produces (used by Task 11, and eventually by the not-yet-built orchestrator — out of this
  plan's scope):
  `interface MatchProductsToRecipesDeps { githubClient: GitHubClient; pool: Pool; imageEditProvider?: ImageEditProvider; callLlm?: (messages: OpenRouterMessage[]) => Promise<string>; }`
  `matchProductsToRecipes(deps: MatchProductsToRecipesDeps): Promise<{ cycleId: string; proposalsCreated: number }>`

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/matchProductsToRecipes.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn() }));
vi.mock('@lhr/db', () => ({
  insertProductPlacementProposal: vi.fn().mockResolvedValue(1),
  getPendingAffiliateLinkIds: vi.fn().mockResolvedValue(new Set()),
}));

import { listFiles, getFile } from '../src/github.js';
import { insertProductPlacementProposal } from '@lhr/db';
import { matchProductsToRecipes } from '../src/matchProductsToRecipes';

const recipeMdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
ingredients:
  - item: "Mozzarella"
affiliateLinkIds: []
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "A whole deep dish pizza"
---

Body text.

![Slicing the pizza](https://example.com/slice.jpg)
`;

const affiliateLinkJson = JSON.stringify({ label: 'Wooden Pizza Server', url: 'https://amazon.com/x', tag: 'x' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFiles).mockImplementation(async (_client, dirPath: string) => {
    if (dirPath === 'src/content/posts') return ['pizza.mdx'];
    if (dirPath === 'src/content/affiliate-links') return ['wooden-pizza-server-1234.json'];
    return [];
  });
  vi.mocked(getFile).mockImplementation(async (_client, path: string) => {
    if (path === 'src/content/posts/pizza.mdx') return { content: recipeMdx, sha: 'a' };
    if (path === 'src/content/affiliate-links/wooden-pizza-server-1234.json') {
      return { content: affiliateLinkJson, sha: 'b' };
    }
    return null;
  });
});

describe('matchProductsToRecipes', () => {
  it('creates a pending proposal with the composited image when the LLM finds a good match and the image edit succeeds', async () => {
    const callLlm = vi.fn().mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    const imageEditProvider = {
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ resultImageUrl: 'https://example.com/composited.jpg' }),
    };

    const result = await matchProductsToRecipes({
      githubClient: {} as never,
      pool: {} as never,
      callLlm,
      imageEditProvider,
    });

    expect(result.proposalsCreated).toBe(1);
    expect(imageEditProvider.compositeProductIntoPhoto).toHaveBeenCalledWith({
      sourceImageUrl: 'https://example.com/slice.jpg',
      productImageUrl: '',
      productName: 'Wooden Pizza Server',
    });
    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        affiliateLinkId: 'wooden-pizza-server-1234',
        postSlug: 'pizza',
        targetImageKind: 'body',
        targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'pending',
      }),
    );
  });

  it('creates no proposal when the LLM finds no good match', async () => {
    const callLlm = vi.fn().mockResolvedValue(JSON.stringify({ match: null }));
    const imageEditProvider = { compositeProductIntoPhoto: vi.fn() };

    const result = await matchProductsToRecipes({ githubClient: {} as never, pool: {} as never, callLlm, imageEditProvider });

    expect(result.proposalsCreated).toBe(0);
    expect(imageEditProvider.compositeProductIntoPhoto).not.toHaveBeenCalled();
    expect(insertProductPlacementProposal).not.toHaveBeenCalled();
  });

  it('creates an edit_failed proposal when the match succeeds but the image edit fails', async () => {
    const callLlm = vi.fn().mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    const imageEditProvider = {
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ error: 'model unavailable' }),
    };

    await matchProductsToRecipes({ githubClient: {} as never, pool: {} as never, callLlm, imageEditProvider });

    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'edit_failed', compositedImageUrl: null }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `../src/matchProductsToRecipes` does not exist.

- [ ] **Step 3: Implement**

Create `mcp-server/src/matchProductsToRecipes.ts`:

```ts
import type { Pool } from 'pg';
import type { GitHubClient } from './github.js';
import { readCollection } from './catalog.js';
import { callOpenRouter, type OpenRouterMessage } from './openrouter.js';
import { listPublishedPosts } from './publishedPosts.js';
import { enumeratePostImages } from '@lhr/content';
import { getImageEditProvider, type ImageEditProvider } from './imageEdit/index.js';
import {
  computeUnattachedCandidates,
  buildMatchPrompt,
  parseMatchResponse,
  type AffiliateLinkCandidate,
  type MatchablePost,
} from './productPlacementMatching.js';
import { insertProductPlacementProposal, getPendingAffiliateLinkIds, type NewProductPlacementProposal } from '@lhr/db';

export interface MatchProductsToRecipesDeps {
  githubClient: GitHubClient;
  pool: Pool;
  imageEditProvider?: ImageEditProvider;
  callLlm?: (messages: OpenRouterMessage[]) => Promise<string>;
}

interface AffiliateLinkData {
  label: string;
  url: string;
  image?: string;
}

function newCycleId(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function matchProductsToRecipes(
  deps: MatchProductsToRecipesDeps,
): Promise<{ cycleId: string; proposalsCreated: number }> {
  const { githubClient, pool } = deps;
  const imageEditProvider = deps.imageEditProvider ?? getImageEditProvider();
  const callLlm = deps.callLlm ?? callOpenRouter;
  const cycleId = newCycleId();

  const [allLinkEntries, publishedPosts, pendingIds] = await Promise.all([
    readCollection<AffiliateLinkData>(githubClient, 'src/content/affiliate-links'),
    listPublishedPosts(githubClient),
    getPendingAffiliateLinkIds(pool),
  ]);

  const allLinks: AffiliateLinkCandidate[] = allLinkEntries.map((entry) => ({
    id: entry.id,
    label: entry.data.label,
    url: entry.data.url,
    imageUrl: entry.data.image,
  }));
  const attachedIds = new Set(publishedPosts.flatMap((p) => p.affiliateLinkIds));
  const candidates = computeUnattachedCandidates(allLinks, attachedIds, pendingIds);

  const postsWithImages = publishedPosts.map((post) => ({
    post,
    images: enumeratePostImages(post.raw).map((img, id) => ({ id, kind: img.kind, alt: img.alt })),
  }));
  const matchablePosts: MatchablePost[] = postsWithImages.map(({ post, images }) => ({
    slug: post.slug,
    title: post.title,
    ingredients: post.ingredients.map((i) => i.item),
    images,
  }));

  let proposalsCreated = 0;

  for (const candidate of candidates) {
    let rawResponse: string;
    try {
      rawResponse = await callLlm(buildMatchPrompt(candidate, matchablePosts));
    } catch {
      continue;
    }

    const match = parseMatchResponse(rawResponse, matchablePosts);
    if (!match) continue;

    const matchedEntry = postsWithImages.find(({ post }) => post.slug === match.slug);
    if (!matchedEntry) continue;
    const image = enumeratePostImages(matchedEntry.post.raw)[match.imageId];
    if (!image) continue;

    let compositedImageUrl: string | null = null;
    let status: 'pending' | 'edit_failed' = 'pending';

    if (!candidate.imageUrl) {
      status = 'edit_failed';
    } else {
      const editResult = await imageEditProvider.compositeProductIntoPhoto({
        sourceImageUrl: image.url,
        productImageUrl: candidate.imageUrl,
        productName: candidate.label,
      });
      if ('resultImageUrl' in editResult) {
        compositedImageUrl = editResult.resultImageUrl;
      } else {
        status = 'edit_failed';
      }
    }

    const proposal: NewProductPlacementProposal = {
      cycleId,
      affiliateLinkId: candidate.id,
      postSlug: match.slug,
      targetImageKind: image.kind,
      targetImageUrl: image.url,
      targetImageLine: image.line,
      matchRationale: match.rationale,
      compositedImageUrl,
      status,
    };
    await insertProductPlacementProposal(pool, proposal);
    proposalsCreated++;
  }

  return { cycleId, proposalsCreated };
}
```

Note on the test: `candidate.imageUrl` is `''`-vs-`undefined` — the fixture affiliate-link JSON has
no `image` field, so `entry.data.image` is `undefined`, which the orchestration code correctly
routes to the `edit_failed` branch, NOT to calling the provider with an empty string. Re-check the
first test case above: it asserts `imageEditProvider.compositeProductIntoPhoto` IS called with
`productImageUrl: ''` — that assertion is wrong given this implementation. Fix the test fixture
instead of the code: add `"image": "https://example.com/product.jpg"` to `affiliateLinkJson`, and
change that assertion's `productImageUrl` to `'https://example.com/product.jpg'`. Apply that fix
before running Step 2/Step 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS (after the test-fixture fix above).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/matchProductsToRecipes.ts mcp-server/tests/matchProductsToRecipes.test.ts
git commit -m "feat(mcp-server): add matchProductsToRecipes orchestration"
```

---

## Task 11: mcp-server — reconcile approved-but-uncommitted proposals

**Files:**
- Modify: `mcp-server/src/matchProductsToRecipes.ts`
- Test: `mcp-server/tests/matchProductsToRecipes.test.ts` (extend)

**Interfaces:**
- Consumes: `getFile`, `commitFilesToMain` from `./github.js` (existing), `applyProductPlacement`,
  `StaleImageTargetError` from `@lhr/content` (Task 4), `getApprovedProposals` from `@lhr/db`
  (Task 2).
- Produces: `reconcileApprovedProposals(deps: MatchProductsToRecipesDeps): Promise<void>`, called
  automatically at the start of `matchProductsToRecipes()`.

Design note (from spec §6's last bullet): the office app's approve route (Task 13) marks a
proposal `approved` in the DB, then attempts the GitHub commit — if that commit fails (network,
rate limit), the proposal is left `approved` without the live post reflecting it. Rather than add
a separate tracking column, reconciliation detects this by checking whether the live post content
already contains the proposal's `compositedImageUrl` and `affiliateLinkId`; if not, it retries the
same update+commit. A `StaleImageTargetError` here (the post changed again since approval) is left
for manual attention — not retried automatically, since retrying blindly is exactly what the
staleness check exists to prevent.

- [ ] **Step 1: Write the failing test**

Add to `mcp-server/tests/matchProductsToRecipes.test.ts`:

```ts
vi.mock('@lhr/db', () => ({
  insertProductPlacementProposal: vi.fn().mockResolvedValue(1),
  getPendingAffiliateLinkIds: vi.fn().mockResolvedValue(new Set()),
  getApprovedProposals: vi.fn().mockResolvedValue([]),
}));

import { getApprovedProposals } from '@lhr/db';
import { commitFilesToMain } from '../src/github.js';
import { reconcileApprovedProposals } from '../src/matchProductsToRecipes';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn(), commitFilesToMain: vi.fn() }));

describe('reconcileApprovedProposals', () => {
  it('retries the commit for an approved proposal the live post does not yet reflect', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([
      {
        id: 5, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
    ]);
    vi.mocked(getFile).mockResolvedValue({ content: recipeMdx, sha: 'a' });

    await reconcileApprovedProposals({ githubClient: {} as never, pool: {} as never });

    expect(commitFilesToMain).toHaveBeenCalledWith(
      {},
      [expect.objectContaining({ path: 'src/content/posts/pizza.mdx' })],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
  });

  it('does nothing when the live post already reflects the approved proposal', async () => {
    const alreadyUpdated = recipeMdx
      .replace('https://example.com/slice.jpg', 'https://example.com/composited.jpg')
      .replace('affiliateLinkIds: []', 'affiliateLinkIds:\n  - wooden-pizza-server-1234');
    vi.mocked(getApprovedProposals).mockResolvedValue([
      {
        id: 5, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
        targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
        matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'approved', decidedAt: new Date(), createdAt: new Date(),
      } as never,
    ]);
    vi.mocked(getFile).mockResolvedValue({ content: alreadyUpdated, sha: 'b' });

    await reconcileApprovedProposals({ githubClient: {} as never, pool: {} as never });

    expect(commitFilesToMain).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=mcp-server`
Expected: FAIL — `reconcileApprovedProposals` is not exported.

- [ ] **Step 3: Implement**

Add to `mcp-server/src/matchProductsToRecipes.ts`:

```ts
import { getFile, commitFilesToMain } from './github.js';
import { applyProductPlacement, StaleImageTargetError } from '@lhr/content';
import { getApprovedProposals } from '@lhr/db';

export async function reconcileApprovedProposals(deps: MatchProductsToRecipesDeps): Promise<void> {
  const { githubClient, pool } = deps;
  const approved = await getApprovedProposals(pool);

  for (const proposal of approved) {
    if (!proposal.compositedImageUrl) continue;

    const file = await getFile(githubClient, `src/content/posts/${proposal.postSlug}.mdx`, 'main');
    if (!file) continue;

    const alreadyReflected =
      file.content.includes(proposal.compositedImageUrl) && file.content.includes(proposal.affiliateLinkId);
    if (alreadyReflected) continue;

    try {
      const updated = applyProductPlacement(file.content, {
        targetImageKind: proposal.targetImageKind,
        targetImageUrl: proposal.targetImageUrl,
        targetImageLine: proposal.targetImageLine,
        compositedImageUrl: proposal.compositedImageUrl,
        affiliateLinkId: proposal.affiliateLinkId,
      });
      await commitFilesToMain(
        githubClient,
        [{ path: `src/content/posts/${proposal.postSlug}.mdx`, content: updated }],
        `Add product placement: ${proposal.affiliateLinkId} in ${proposal.postSlug}`,
      );
    } catch (err) {
      if (err instanceof StaleImageTargetError) continue;
      continue; // commit failed again; retried on the next cycle
    }
  }
}
```

And wire it into the top of `matchProductsToRecipes()`:

```ts
export async function matchProductsToRecipes(
  deps: MatchProductsToRecipesDeps,
): Promise<{ cycleId: string; proposalsCreated: number }> {
  await reconcileApprovedProposals(deps);

  const { githubClient, pool } = deps;
  // ... rest unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=mcp-server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/matchProductsToRecipes.ts mcp-server/tests/matchProductsToRecipes.test.ts
git commit -m "feat(mcp-server): reconcile approved proposals whose commit didn't land"
```

---

## Task 12: apps/lhr-office — `/product-placements` review queue page

**Files:**
- Create: `apps/lhr-office/src/pages/product-placements/index.astro`

**Interfaces:**
- Consumes: `getPool` from `../../lib/db.js`, `requireSession`/`AuthNotConfiguredError` from
  `../../lib/auth.js` (both existing), `getPendingProposals`, `type ProductPlacementProposal` from
  `@lhr/db` (Task 2).
- Produces: the `/product-placements/` route, and the `/api/product-placements/[id]/approve` and
  `/api/product-placements/[id]/reject` endpoints it calls from its client-side script (built in
  Tasks 13–14).

No automated test for this task: this codebase has no precedent for unit-testing `.astro` page
rendering (the analogous `/affiliate-review` page from sub-project 2 has none either — only its
API routes are tested). Verify this page manually after Task 14 by running `npm run dev
--workspace=apps/lhr-office` and confirming it renders pending proposals with working
approve/reject buttons.

- [ ] **Step 1: Implement**

Create `apps/lhr-office/src/pages/product-placements/index.astro`:

```astro
---
import { getPool } from '../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../lib/auth.js';
import { getPendingProposals, type ProductPlacementProposal } from '@lhr/db';

let notConfigured = false;
try {
  await requireSession();
} catch (err) {
  if (err instanceof AuthNotConfiguredError) {
    notConfigured = true;
  } else {
    throw err;
  }
}

const pool = notConfigured ? null : getPool();
const proposals: ProductPlacementProposal[] = pool ? await getPendingProposals(pool) : [];
---
{notConfigured ? (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Product placement review</title>
    </head>
    <body>
      <p>Admin auth isn't wired up yet on this app — this page isn't available until that lands.</p>
    </body>
  </html>
) : (
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Product placement review</title>
    <style>
      body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
      .photos { display: flex; gap: 1rem; }
      .photos img { width: 48%; max-height: 220px; object-fit: cover; border-radius: 4px; }
      .failed { padding: 2rem; text-align: center; background: #fef3c7; border-radius: 4px; width: 48%; }
      .meta { font-size: 0.9rem; color: #444; margin: 0.5rem 0; }
      .actions button { font-size: 1rem; padding: 0.5rem 1rem; margin-right: 0.5rem; cursor: pointer; }
      .approve { background: #16a34a; color: white; border: none; border-radius: 4px; }
      .reject { background: #dc2626; color: white; border: none; border-radius: 4px; }
      .card.gone { display: none; }
    </style>
  </head>
  <body>
    <h1>Product placement proposals</h1>
    {proposals.length === 0 && <p>No pending proposals right now.</p>}
    {proposals.map((p) => (
      <div class="card" id={`proposal-${p.id}`}>
        <h2>{p.affiliateLinkId} &rarr; {p.postSlug}</h2>
        <div class="photos">
          <img src={p.targetImageUrl} alt="Original photo" />
          {p.compositedImageUrl ? (
            <img src={p.compositedImageUrl} alt="Composited preview" />
          ) : (
            <div class="failed">Image generation failed</div>
          )}
        </div>
        <p class="meta">{p.targetImageKind === 'cover' ? 'Cover photo' : 'Body photo'} &middot; {p.matchRationale}</p>
        <div class="actions">
          <button class="approve" data-id={p.id} data-action="approve">Approve</button>
          <button class="reject" data-id={p.id} data-action="reject">Reject</button>
        </div>
      </div>
    ))}
    <script>
      document.querySelectorAll('button[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.getAttribute('data-id');
          const action = button.getAttribute('data-action');
          button.setAttribute('disabled', 'true');
          const res = await fetch(`/api/product-placements/${id}/${action}`, { method: 'POST' });
          if (res.ok) {
            document.getElementById(`proposal-${id}`)?.classList.add('gone');
          } else {
            const body = await res.json().catch(() => ({}));
            alert(`Failed: ${body.error ?? res.statusText}`);
            button.removeAttribute('disabled');
          }
        });
      });
    </script>
  </body>
</html>
)}
```

- [ ] **Step 2: Commit**

```bash
git add apps/lhr-office/src/pages/product-placements/index.astro
git commit -m "feat(office): add product placement review queue page"
```

---

## Task 13: apps/lhr-office — approve API route

**Files:**
- Create: `apps/lhr-office/src/pages/api/product-placements/[id]/approve.ts`
- Test: `apps/lhr-office/tests/productPlacementApprove.test.ts`

**Interfaces:**
- Consumes: `getPool` from `../../../../../lib/db.js`, `requireSession`/`AuthNotConfiguredError`
  from `../../../../../lib/auth.js` (existing), `getProposalById`, `markProposalStatus` from
  `@lhr/db` (Task 2), `createGitHubClient`, `getFile`, `commitFilesToMain` from `@lhr/github`
  (existing), `applyProductPlacement`, `StaleImageTargetError` from `@lhr/content` (Task 4).

Design note: staleness is checked (`applyProductPlacement` may throw `StaleImageTargetError`)
BEFORE the proposal is marked `approved` — a stale target means the whole approval is refused,
matching spec §6 ("approval is refused ... nothing is committed"). Once the update content is
computed successfully, the proposal IS marked `approved` before attempting the commit — if the
commit then throws, the route returns an error to the admin, but the proposal is deliberately left
`approved` (not rolled back) so Task 11's reconciliation pass picks it up on the next cycle. This
mirrors the exact scenario spec §6 describes.

- [ ] **Step 1: Write the failing test**

Create `apps/lhr-office/tests/productPlacementApprove.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = { getProposalById: vi.fn(), markProposalStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(),
  commitFilesToMain: vi.fn(),
};
vi.mock('@lhr/github', () => githubMock);

const { StaleImageTargetError } = await import('@lhr/content');
const contentMock = { applyProductPlacement: vi.fn() };
vi.mock('@lhr/content', async () => {
  const actual = await vi.importActual<typeof import('@lhr/content')>('@lhr/content');
  return { ...actual, applyProductPlacement: contentMock.applyProductPlacement };
});

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/product-placements/[id]/approve');

const pendingProposal = {
  id: 1, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
  targetImageKind: 'body' as const, targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending' as const, decidedAt: null, createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
  process.env.AUTHOR_GITHUB_TOKEN = 'test-token';
  githubMock.getFile.mockResolvedValue({ content: 'raw-mdx', sha: 'a' });
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/product-placements/[id]/approve', () => {
  it('returns 503 when the session gate is not configured, without touching the database', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(503);
    expect(dbMock.getProposalById).not.toHaveBeenCalled();
  });

  it('commits the updated post and marks the proposal approved', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    contentMock.applyProductPlacement.mockReturnValue('updated-mdx');

    const res = await POST(makeContext('1'));

    expect(res.status).toBe(200);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'approved');
    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/posts/pizza.mdx', content: 'updated-mdx' }],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
  });

  it('marks the proposal stale and does not commit when the target has changed', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    contentMock.applyProductPlacement.mockImplementation(() => {
      throw new StaleImageTargetError();
    });

    const res = await POST(makeContext('1'));

    expect(res.status).toBe(409);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'stale');
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown proposal', async () => {
    dbMock.getProposalById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for a proposal that is already decided', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'approved' });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 409 for a proposal with no composited image', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, compositedImageUrl: null });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/lhr-office`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement**

Create `apps/lhr-office/src/pages/api/product-placements/[id]/approve.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../lib/auth.js';
import { getProposalById, markProposalStatus } from '@lhr/db';
import { createGitHubClient, getFile, commitFilesToMain } from '@lhr/github';
import { applyProductPlacement, StaleImageTargetError } from '@lhr/content';

export async function POST({ params }: APIContext): Promise<Response> {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthNotConfiguredError) {
      return new Response(JSON.stringify({ error: 'Admin auth is not configured yet' }), { status: 503 });
    }
    throw err;
  }

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid proposal id' }), { status: 400 });
  }

  const pool = getPool();
  const proposal = await getProposalById(pool, id);
  if (!proposal) {
    return new Response(JSON.stringify({ error: 'Proposal not found' }), { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Proposal is already ${proposal.status}` }), { status: 409 });
  }
  if (!proposal.compositedImageUrl) {
    return new Response(JSON.stringify({ error: 'Proposal has no composited image to publish' }), { status: 409 });
  }

  const githubToken = process.env.AUTHOR_GITHUB_TOKEN;
  if (!githubToken) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing AUTHOR_GITHUB_TOKEN' }), { status: 500 });
  }
  const client = createGitHubClient(githubToken);

  const file = await getFile(client, `src/content/posts/${proposal.postSlug}.mdx`, 'main');
  if (!file) {
    return new Response(JSON.stringify({ error: `Post ${proposal.postSlug} no longer exists` }), { status: 409 });
  }

  let updatedContent: string;
  try {
    updatedContent = applyProductPlacement(file.content, {
      targetImageKind: proposal.targetImageKind,
      targetImageUrl: proposal.targetImageUrl,
      targetImageLine: proposal.targetImageLine,
      compositedImageUrl: proposal.compositedImageUrl,
      affiliateLinkId: proposal.affiliateLinkId,
    });
  } catch (err) {
    if (err instanceof StaleImageTargetError) {
      await markProposalStatus(pool, id, 'stale');
      return new Response(
        JSON.stringify({ error: 'The target photo has changed since this proposal was created; marked stale.' }),
        { status: 409 },
      );
    }
    throw err;
  }

  // Marked approved before the commit attempt is deliberate: if the commit below fails, this
  // proposal stays 'approved' (not rolled back) so mcp-server's reconcileApprovedProposals picks
  // it up and retries on the next cycle, instead of leaving it stuck 'pending' forever.
  await markProposalStatus(pool, id, 'approved');

  try {
    await commitFilesToMain(
      client,
      [{ path: `src/content/posts/${proposal.postSlug}.mdx`, content: updatedContent }],
      `Add product placement: ${proposal.affiliateLinkId} in ${proposal.postSlug}`,
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Approved, but publishing the change failed; it will retry automatically.' }),
      { status: 502 },
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/lhr-office`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/pages/api/product-placements/[id]/approve.ts apps/lhr-office/tests/productPlacementApprove.test.ts
git commit -m "feat(office): add product placement approve route"
```

---

## Task 14: apps/lhr-office — reject API route

**Files:**
- Create: `apps/lhr-office/src/pages/api/product-placements/[id]/reject.ts`
- Test: `apps/lhr-office/tests/productPlacementReject.test.ts`

**Interfaces:**
- Consumes: same auth/db imports as Task 13; no GitHub or `@lhr/content` involvement (rejecting
  never touches the live post).

- [ ] **Step 1: Write the failing test**

Create `apps/lhr-office/tests/productPlacementReject.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = { getProposalById: vi.fn(), markProposalStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/product-placements/[id]/reject');

const pendingProposal = {
  id: 1, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
  targetImageKind: 'body' as const, targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending' as const, decidedAt: null, createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/product-placements/[id]/reject', () => {
  it('returns 503 when the session gate is not configured', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(503);
    expect(dbMock.getProposalById).not.toHaveBeenCalled();
  });

  it('marks the proposal rejected', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(200);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'rejected');
  });

  it('returns 404 for an unknown proposal', async () => {
    dbMock.getProposalById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for a proposal that is already decided', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'rejected' });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
    expect(dbMock.markProposalStatus).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/lhr-office`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement**

Create `apps/lhr-office/src/pages/api/product-placements/[id]/reject.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../lib/auth.js';
import { getProposalById, markProposalStatus } from '@lhr/db';

export async function POST({ params }: APIContext): Promise<Response> {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthNotConfiguredError) {
      return new Response(JSON.stringify({ error: 'Admin auth is not configured yet' }), { status: 503 });
    }
    throw err;
  }

  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid proposal id' }), { status: 400 });
  }

  const pool = getPool();
  const proposal = await getProposalById(pool, id);
  if (!proposal) {
    return new Response(JSON.stringify({ error: 'Proposal not found' }), { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Proposal is already ${proposal.status}` }), { status: 409 });
  }

  await markProposalStatus(pool, id, 'rejected');

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/lhr-office`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/pages/api/product-placements/[id]/reject.ts apps/lhr-office/tests/productPlacementReject.test.ts
git commit -m "feat(office): add product placement reject route"
```

---

## Task 15: Nav link + env var documentation

**Files:**
- Modify: `apps/lhr-office/src/pages/index.astro`
- Modify: `.env.example`

No test: this is a documentation/wiring task with no testable behavior of its own (the page it
links to already has its own manual-verification note in Task 12).

- [ ] **Step 1: Add the nav link**

Modify `apps/lhr-office/src/pages/index.astro` — add one `<li>` to the existing list:

```astro
<li><a href="/product-placements/">Product placement review</a></li>
```

- [ ] **Step 2: Document the new env vars**

Add to `.env.example`:

```
IMAGE_EDIT_PROVIDER=
IMAGE_EDIT_MODEL=
```

- [ ] **Step 3: Manually verify the full flow**

Run `npm run dev --workspace=apps/lhr-office`, confirm the home page links to
`/product-placements/`, and that the page loads (showing "No pending proposals right now" against
an empty/dev database, or the "auth isn't wired up yet" message if `requireSession()` is still the
placeholder).

- [ ] **Step 4: Commit**

```bash
git add apps/lhr-office/src/pages/index.astro .env.example
git commit -m "feat(office): link to product placement review from the office home page"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (goals/scope) → Global Constraints + out-of-scope notes throughout;
  §2 (discovery/match/edit/write) → Tasks 8–10; §2 (review/approve/reject UI) → Tasks 12–14;
  §3 (swappable provider) → Tasks 6–7; §4 (enumeration/update mechanics) → Tasks 3–4; §5 (schema)
  → Task 1; §6 (error handling: no match, edit_failed, stale, duplicate-pending, reconciliation)
  → Tasks 8 (dup-pending), 9 (no match), 10 (edit_failed), 13 (stale), 11 (reconciliation); §7
  (testing approach) → a dedicated test in each task matching each listed bullet, including the
  fake-second-provider swap test (Task 7).
- **Deviation flagged up front:** the spec's `mcp-server/src/` placement for image
  enumeration/update was corrected to a new shared `@lhr/content` package (Global Constraints),
  since `apps/lhr-office` cannot import from `mcp-server/src/*` across the workspace boundary.
- **Type consistency checked:** `ProductPlacementProposal`/`NewProductPlacementProposal` (Task 2)
  are consumed with the same field names in Tasks 10, 11, 13; `PostImage`/`enumeratePostImages`
  (Task 3) and `ProductPlacementUpdate`/`applyProductPlacement`/`StaleImageTargetError` (Task 4)
  are consumed identically in Tasks 10, 11, 13; `ImageEditProvider` (Task 6) is used unchanged in
  Tasks 7, 10; `AffiliateLinkCandidate`/`MatchablePost`/`MatchResult` (Tasks 8–9) are consumed
  unchanged in Task 10.
