# Product-in-Photo Placement — Orchestrator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the product-in-photo-placement feature (match unattached affiliate products to recipe photos, edit the photo, propose the result for human review) against the current shared-orchestrator architecture on `main` — a zero-arg `@lhr/jobs` job, `@lhr/db` proposal storage, and a `/status`-SPA review UI — replacing the obsolete Astro/Basic-Auth implementation on `claude/product-placement-design-hyis83`.

**Architecture:** A dormant (unregistered) zero-arg job `matchProductsToRecipes` in `mcp-server` matches unattached affiliate products to recipe post photos via `@lhr/llm`'s `callLLM`, edits the matched photo via a swappable `ImageEditProvider` (OpenRouter free tier today, using a new image-output overload of `callLLM`), and stores proposals via a new `@lhr/db` module. A new Express router in `apps/lhr-office`, gated by the existing `requireSupabaseAuth` middleware, exposes the proposals to a new section of the React SPA's Approvals page for human approve/reject.

**Tech Stack:** TypeScript (strict, ES2022/NodeNext), `pg` via `@lhr/db`'s `Queryable`/`getPool()`, Vitest + `vi.mock` module mocking, Express + `supertest` for API routes, React + Testing Library for the SPA, `js-yaml` for MDX frontmatter.

**Spec:** `docs/superpowers/specs/active/2026-09-07-product-placement-orchestrator-redesign-design.md`

## Global Constraints

- The job is built completely but **never added to `apps/lhr-office/src/registry.ts`** in this plan — it ships dormant per the spec's Architecture section. No task touches `registry.ts`.
- Every `@lhr/db` module takes a `Queryable` (from `@lhr/db`'s `client.ts`), never a raw `pg.Pool` type, and reads the shared pool via `getPool()` — never call `.end()` on it (`packages/db/src/client.ts`, already merged).
- The job entry point is a zero-arg function (`export async function matchProductsToRecipes(): Promise<JobResult>`), tested by `vi.mock()`-ing `@lhr/db`, `./github.js`, and its sibling modules — never dependency injection — matching `mcp-server/src/sourceAffiliateCandidates.ts`.
- Review-UI ops (`mcp-server/src/productPlacementOps.ts`, `apps/lhr-office/src/routes/productPlacements.ts`) are plain functions taking a `Queryable`/token as explicit parameters, tested the same module-mock way as `mcp-server/src/affiliateCandidateOps.ts` — this is not a contradiction with the point above, just the same testing technique applied to non-job code.
- All existing env vars this feature needs are already in `.env.example`: `GITHUB_TOKEN`, `DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `IMAGE_EDIT_PROVIDER`, `IMAGE_EDIT_MODEL`. No task adds new env vars.
- Recipe posts live at `src/content/posts/*.mdx` with YAML frontmatter (`coverPhoto`/`coverPhotoAlt`, `affiliateLinkIds`, `type: recipe`) plus inline Markdown images (`![alt](url)`) in the body — confirmed against real content in this repo, not assumed.
- `apps/lhr-office`'s `createApp(...)` signature is `(db, registry, candidates, affiliateCandidates, clientAssets)` today (`apps/lhr-office/src/server.ts`). This plan appends `productPlacements` as a **sixth, trailing** parameter so every existing positional call site (including the ones in `apps/lhr-office/tests/server.test.ts` that already pass 5 args) keeps working unchanged.

---

### Task 1: `@lhr/db` — `product_placement_proposals` table and CRUD module

**Files:**
- Modify: `packages/db/src/schema.sql` (append table)
- Create: `packages/db/src/productPlacementProposals.ts`
- Modify: `packages/db/src/index.ts` (add `export * from './productPlacementProposals.js';`)
- Test: `packages/db/tests/productPlacementProposals.test.ts`

**Interfaces:**
- Produces: `ProductPlacementProposal`, `NewProductPlacementProposal`, `ProductPlacementImageKind` (`'cover' | 'body'`), `ProductPlacementStatus` (`'pending' | 'approved' | 'rejected' | 'edit_failed' | 'stale'`), and functions `insertProductPlacementProposal(db: Queryable, proposal: NewProductPlacementProposal): Promise<number>`, `getReviewableProposals(db: Queryable): Promise<ProductPlacementProposal[]>`, `getApprovedProposals(db: Queryable): Promise<ProductPlacementProposal[]>`, `getProposalById(db: Queryable, id: number): Promise<ProductPlacementProposal | null>`, `markProposalStatus(db: Queryable, id: number, status: 'approved' | 'rejected' | 'stale'): Promise<void>`, `getPendingAffiliateLinkIds(db: Queryable): Promise<Set<string>>` — all consumed by Tasks 9, 10, 11.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/db/tests/productPlacementProposals.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertProductPlacementProposal,
  getReviewableProposals,
  getApprovedProposals,
  getProposalById,
  markProposalStatus,
  getPendingAffiliateLinkIds,
  type NewProductPlacementProposal,
} from '../src/productPlacementProposals';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newProposal: NewProductPlacementProposal = {
  cycleId: '2026-09-09',
  affiliateLinkId: 'wooden-pizza-server-1234',
  postSlug: 'pizza',
  targetImageKind: 'body',
  targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'Used to serve the slice',
  compositedImageUrl: null,
  status: 'pending',
};

beforeEach(() => vi.clearAllMocks());

describe('insertProductPlacementProposal', () => {
  it('inserts a row and returns its id', async () => {
    const db = mockDb([{ id: 7 }]);
    const id = await insertProductPlacementProposal(db as never, newProposal);
    expect(id).toBe(7);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO product_placement_proposals');
    expect(params).toEqual([
      '2026-09-09', 'wooden-pizza-server-1234', 'pizza', 'body',
      'https://example.com/slice.jpg', '![Slicing the pizza](https://example.com/slice.jpg)',
      'Used to serve the slice', null, 'pending',
    ]);
  });
});

describe('getReviewableProposals', () => {
  it('selects pending and edit_failed proposals, oldest first', async () => {
    const db = mockDb([]);
    await getReviewableProposals(db as never);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain(`status IN ('pending', 'edit_failed')`);
    expect(sql).toContain('ORDER BY created_at ASC');
  });

  it('maps snake_case rows to camelCase proposals', async () => {
    const db = mockDb([{
      id: 1, cycle_id: '2026-09-09', affiliate_link_id: 'x', post_slug: 'pizza',
      target_image_kind: 'body', target_image_url: 'https://example.com/slice.jpg',
      target_image_line: null, match_rationale: 'r', composited_image_url: null,
      status: 'pending', decided_at: null, created_at: new Date('2026-09-09'),
    }]);
    const [proposal] = await getReviewableProposals(db as never);
    expect(proposal).toEqual({
      id: 1, cycleId: '2026-09-09', affiliateLinkId: 'x', postSlug: 'pizza',
      targetImageKind: 'body', targetImageUrl: 'https://example.com/slice.jpg',
      targetImageLine: null, matchRationale: 'r', compositedImageUrl: null,
      status: 'pending', decidedAt: null, createdAt: new Date('2026-09-09'),
    });
  });
});

describe('getApprovedProposals', () => {
  it('selects only approved proposals', async () => {
    const db = mockDb([]);
    await getApprovedProposals(db as never);
    expect(db.query.mock.calls[0][0]).toContain(`status = 'approved'`);
  });
});

describe('getProposalById', () => {
  it('returns null when no row matches', async () => {
    const db = mockDb([]);
    expect(await getProposalById(db as never, 999)).toBeNull();
  });
});

describe('markProposalStatus', () => {
  it('updates status and decided_at', async () => {
    const db = mockDb([]);
    await markProposalStatus(db as never, 1, 'approved');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('UPDATE product_placement_proposals SET status = $1, decided_at = now()');
    expect(params).toEqual(['approved', 1]);
  });
});

describe('getPendingAffiliateLinkIds', () => {
  it('returns a Set of affiliate_link_id for pending proposals', async () => {
    const db = mockDb([{ affiliate_link_id: 'a' }, { affiliate_link_id: 'b' }]);
    const ids = await getPendingAffiliateLinkIds(db as never);
    expect(ids).toEqual(new Set(['a', 'b']));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@lhr/db -- productPlacementProposals`
Expected: FAIL — `Cannot find module '../src/productPlacementProposals'`

- [ ] **Step 3: Add the table to the schema**

Append to `packages/db/src/schema.sql`:

```sql
-- Photo-in-post opportunities to attach an unattached affiliate product to a recipe post's photo,
-- written by the 'product-placement' job (unregistered/dormant until its image-edit path is
-- settled) and decided on from apps/lhr-office's Approvals page.
CREATE TABLE product_placement_proposals (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  affiliate_link_id TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  target_image_kind TEXT NOT NULL,       -- 'cover' | 'body'
  target_image_url TEXT NOT NULL,
  target_image_line TEXT,
  match_rationale TEXT NOT NULL,
  composited_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'edit_failed' | 'stale'
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Implement the module**

```typescript
// packages/db/src/productPlacementProposals.ts
import type { Queryable } from './client.js';

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

type ProposalRow = {
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
};

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
  db: Queryable,
  proposal: NewProductPlacementProposal,
): Promise<number> {
  const res = await db.query<{ id: number }>(
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
  );
  return res.rows[0].id;
}

export async function getReviewableProposals(db: Queryable): Promise<ProductPlacementProposal[]> {
  const res = await db.query<ProposalRow>(
    `SELECT * FROM product_placement_proposals WHERE status IN ('pending', 'edit_failed') ORDER BY created_at ASC`,
  );
  return res.rows.map(rowToProposal);
}

export async function getApprovedProposals(db: Queryable): Promise<ProductPlacementProposal[]> {
  const res = await db.query<ProposalRow>(
    `SELECT * FROM product_placement_proposals WHERE status = 'approved' ORDER BY decided_at ASC`,
  );
  return res.rows.map(rowToProposal);
}

export async function getProposalById(db: Queryable, id: number): Promise<ProductPlacementProposal | null> {
  const res = await db.query<ProposalRow>(`SELECT * FROM product_placement_proposals WHERE id = $1`, [id]);
  return res.rows[0] ? rowToProposal(res.rows[0]) : null;
}

export async function markProposalStatus(
  db: Queryable,
  id: number,
  status: 'approved' | 'rejected' | 'stale',
): Promise<void> {
  await db.query(
    `UPDATE product_placement_proposals SET status = $1, decided_at = now() WHERE id = $2`,
    [status, id],
  );
}

export async function getPendingAffiliateLinkIds(db: Queryable): Promise<Set<string>> {
  const res = await db.query<{ affiliate_link_id: string }>(
    `SELECT DISTINCT affiliate_link_id FROM product_placement_proposals WHERE status = 'pending'`,
  );
  return new Set(res.rows.map((r) => r.affiliate_link_id));
}
```

Add to `packages/db/src/index.ts`:

```typescript
export * from './productPlacementProposals.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=@lhr/db -- productPlacementProposals`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/productPlacementProposals.ts packages/db/src/index.ts packages/db/tests/productPlacementProposals.test.ts
git commit -m "feat(db): add product_placement_proposals table and CRUD module"
```

---

### Task 2: `@lhr/content` package — `enumeratePostImages`

**Files:**
- Create: `packages/content/package.json`, `packages/content/tsconfig.json`, `packages/content/vitest.config.ts`
- Create: `packages/content/src/index.ts`, `packages/content/src/postImages.ts`
- Test: `packages/content/tests/postImages.test.ts`
- Modify: root `package.json` (add `"packages/content"` to `workspaces`, add its build to `postinstall`)

**Interfaces:**
- Produces: `PostImage { kind: 'cover' | 'body'; url: string; alt: string; line: string | null }` and `enumeratePostImages(raw: string): PostImage[]`, consumed by Task 9.

- [ ] **Step 1: Scaffold the package**

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
    "vitest": "^3.0.0"
  }
}
```

`packages/content/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
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

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

Add `"packages/content"` to the `workspaces` array in root `package.json`, and add `&& npm run build --workspace=@lhr/content` to the end of its `postinstall` script.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/content/tests/postImages.test.ts
import { describe, expect, it } from 'vitest';
import { enumeratePostImages } from '../src/postImages';

const mdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "A whole deep dish pizza"
---

Body text.

![Slicing the pizza](https://example.com/slice.jpg)

More text.
`;

describe('enumeratePostImages', () => {
  it('returns the cover photo first, then body images in document order', () => {
    const images = enumeratePostImages(mdx);
    expect(images).toEqual([
      { kind: 'cover', url: 'https://example.com/cover.jpg', alt: 'A whole deep dish pizza', line: null },
      {
        kind: 'body',
        url: 'https://example.com/slice.jpg',
        alt: 'Slicing the pizza',
        line: '![Slicing the pizza](https://example.com/slice.jpg)',
      },
    ]);
  });

  it('returns an empty array for a post with no frontmatter delimiters', () => {
    expect(enumeratePostImages('Just some text, no frontmatter.')).toEqual([]);
  });

  it('skips the cover image when frontmatter has no coverPhoto, still finding body images', () => {
    const noCovers = `---\ntitle: "No Cover"\n---\n\n![alt](https://example.com/x.jpg)\n`;
    expect(enumeratePostImages(noCovers)).toEqual([
      { kind: 'body', url: 'https://example.com/x.jpg', alt: 'alt', line: '![alt](https://example.com/x.jpg)' },
    ]);
  });

  it('does not crash on empty frontmatter', () => {
    expect(enumeratePostImages('---\n\n---\n\nBody with no images.')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace=@lhr/content -- postImages`
Expected: FAIL — `Cannot find module '../src/postImages'`

- [ ] **Step 4: Implement**

```typescript
// packages/content/src/postImages.ts
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
    const frontmatter = yaml.load(frontmatterMatch[1]) as { coverPhoto?: string; coverPhotoAlt?: string } | undefined;
    if (frontmatter && frontmatter.coverPhoto) {
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

```typescript
// packages/content/src/index.ts
export * from './postImages.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace=@lhr/content -- postImages`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json packages/content
git commit -m "feat(content): add @lhr/content package with post image enumeration"
```

---

### Task 3: `@lhr/content` — `applyProductPlacement`

**Files:**
- Create: `packages/content/src/postImageUpdate.ts`
- Modify: `packages/content/src/index.ts` (add export)
- Test: `packages/content/tests/postImageUpdate.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `StaleImageTargetError`, `ProductPlacementUpdate { targetImageKind: 'cover' | 'body'; targetImageUrl: string; targetImageLine: string | null; compositedImageUrl: string; affiliateLinkId: string }`, `applyProductPlacement(raw: string, update: ProductPlacementUpdate): string`, consumed by Task 9's `reconcileApprovedProposals`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/content/tests/postImageUpdate.test.ts
import { describe, expect, it } from 'vitest';
import { applyProductPlacement, StaleImageTargetError } from '../src/postImageUpdate';

const mdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
affiliateLinkIds: []
coverPhoto: "https://example.com/cover.jpg"
coverPhotoAlt: "A whole deep dish pizza"
---

Body text.

![Slicing the pizza](https://example.com/slice.jpg)
`;

describe('applyProductPlacement', () => {
  it('replaces the cover photo URL and adds the affiliate link id', () => {
    const updated = applyProductPlacement(mdx, {
      targetImageKind: 'cover',
      targetImageUrl: 'https://example.com/cover.jpg',
      targetImageLine: null,
      compositedImageUrl: 'https://example.com/composited-cover.jpg',
      affiliateLinkId: 'wooden-pizza-server-1234',
    });
    expect(updated).toContain('coverPhoto: https://example.com/composited-cover.jpg');
    expect(updated).toContain('- wooden-pizza-server-1234');
  });

  it('replaces a body image line by exact match and adds the affiliate link id', () => {
    const line = '![Slicing the pizza](https://example.com/slice.jpg)';
    const updated = applyProductPlacement(mdx, {
      targetImageKind: 'body',
      targetImageUrl: 'https://example.com/slice.jpg',
      targetImageLine: line,
      compositedImageUrl: 'https://example.com/composited-slice.jpg',
      affiliateLinkId: 'wooden-pizza-server-1234',
    });
    expect(updated).toContain('![Slicing the pizza](https://example.com/composited-slice.jpg)');
    expect(updated).not.toContain(line);
  });

  it('does not duplicate an affiliate link id already present', () => {
    const withLink = mdx.replace('affiliateLinkIds: []', 'affiliateLinkIds: ["wooden-pizza-server-1234"]');
    const updated = applyProductPlacement(withLink, {
      targetImageKind: 'cover',
      targetImageUrl: 'https://example.com/cover.jpg',
      targetImageLine: null,
      compositedImageUrl: 'https://example.com/composited-cover.jpg',
      affiliateLinkId: 'wooden-pizza-server-1234',
    });
    expect(updated.match(/wooden-pizza-server-1234/g)).toHaveLength(1);
  });

  it('throws StaleImageTargetError when the cover photo no longer matches', () => {
    expect(() =>
      applyProductPlacement(mdx, {
        targetImageKind: 'cover',
        targetImageUrl: 'https://example.com/no-longer-there.jpg',
        targetImageLine: null,
        compositedImageUrl: 'https://example.com/composited.jpg',
        affiliateLinkId: 'x',
      }),
    ).toThrow(StaleImageTargetError);
  });

  it('throws StaleImageTargetError when the body image line no longer exists', () => {
    expect(() =>
      applyProductPlacement(mdx, {
        targetImageKind: 'body',
        targetImageUrl: 'https://example.com/slice.jpg',
        targetImageLine: '![Gone now](https://example.com/gone.jpg)',
        compositedImageUrl: 'https://example.com/composited.jpg',
        affiliateLinkId: 'x',
      }),
    ).toThrow(StaleImageTargetError);
  });

  it('throws a plain Error when there is no frontmatter at all', () => {
    expect(() =>
      applyProductPlacement('no frontmatter here', {
        targetImageKind: 'cover',
        targetImageUrl: 'x',
        targetImageLine: null,
        compositedImageUrl: 'y',
        affiliateLinkId: 'x',
      }),
    ).toThrow('No frontmatter delimiters found in post content');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@lhr/content -- postImageUpdate`
Expected: FAIL — `Cannot find module '../src/postImageUpdate'`

- [ ] **Step 3: Implement**

```typescript
// packages/content/src/postImageUpdate.ts
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

Add to `packages/content/src/index.ts`:

```typescript
export * from './postImageUpdate.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@lhr/content -- postImageUpdate`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/content/src/postImageUpdate.ts packages/content/src/index.ts packages/content/tests/postImageUpdate.test.ts
git commit -m "feat(content): apply product placement updates to a post's MDX"
```

---

### Task 4: `mcp-server` — `publishedPosts.ts`

**Files:**
- Create: `mcp-server/src/publishedPosts.ts`
- Test: `mcp-server/tests/publishedPosts.test.ts`

**Interfaces:**
- Consumes: `listFiles(client: GitHubClient, dirPath: string, ref: string): Promise<string[]>` and `getFile(client: GitHubClient, path: string, ref: string): Promise<{ content: string; sha: string } | null>` from `mcp-server/src/github.ts` (already on `main`, unchanged).
- Produces: `PublishedPost { slug: string; raw: string; title: string; ingredients: Array<{ item: string }>; affiliateLinkIds: string[] }` and `listPublishedPosts(client: GitHubClient): Promise<PublishedPost[]>`, consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/tests/publishedPosts.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ listFiles: vi.fn(), getFile: vi.fn() }));
import { listFiles, getFile } from '../src/github.js';
import { listPublishedPosts } from '../src/publishedPosts';

const recipeMdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
ingredients:
  - item: "Mozzarella"
affiliateLinkIds: ["existing-link"]
coverPhoto: "https://example.com/cover.jpg"
---

Body.
`;

const articleMdx = `---
type: article
title: "A Trip to Chicago"
---

Body.
`;

beforeEach(() => vi.clearAllMocks());

describe('listPublishedPosts', () => {
  it('returns only recipe posts, parsed from frontmatter', async () => {
    vi.mocked(listFiles).mockResolvedValue(['pizza.mdx', 'trip.mdx', 'not-a-post.txt']);
    vi.mocked(getFile).mockImplementation(async (_client, path: string) => {
      if (path === 'src/content/posts/pizza.mdx') return { content: recipeMdx, sha: 'a' };
      if (path === 'src/content/posts/trip.mdx') return { content: articleMdx, sha: 'b' };
      return null;
    });

    const posts = await listPublishedPosts({} as never);

    expect(listFiles).toHaveBeenCalledWith({}, 'src/content/posts', 'main');
    expect(posts).toEqual([
      {
        slug: 'pizza',
        raw: recipeMdx,
        title: 'Chicago Deep Dish Pizza',
        ingredients: [{ item: 'Mozzarella' }],
        affiliateLinkIds: ['existing-link'],
      },
    ]);
  });

  it('skips a file whose frontmatter fails to parse or is missing', async () => {
    vi.mocked(listFiles).mockResolvedValue(['broken.mdx']);
    vi.mocked(getFile).mockResolvedValue({ content: 'no frontmatter here', sha: 'a' });

    expect(await listPublishedPosts({} as never)).toEqual([]);
  });

  it('skips a file getFile returns null for', async () => {
    vi.mocked(listFiles).mockResolvedValue(['gone.mdx']);
    vi.mocked(getFile).mockResolvedValue(null);

    expect(await listPublishedPosts({} as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=lhr-authoring-mcp-server -- publishedPosts`
Expected: FAIL — `Cannot find module '../src/publishedPosts'`

- [ ] **Step 3: Implement**

```typescript
// mcp-server/src/publishedPosts.ts
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
    const frontmatter = yaml.load(match[1]) as RecipeFrontmatter | undefined;
    if (!frontmatter || frontmatter.type !== 'recipe') continue;

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-authoring-mcp-server -- publishedPosts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/publishedPosts.ts mcp-server/tests/publishedPosts.test.ts
git commit -m "feat(mcp-server): list published recipe posts for product matching"
```

---

### Task 5: `@lhr/llm` — image-output overload of `callLLM`

**Files:**
- Modify: `packages/llm/src/index.ts`
- Test: `packages/llm/tests/index.test.ts` (add cases)

**Interfaces:**
- Produces: `ContentPart` union, widened `LlmMessage.content: string | ContentPart[]`, `CallLlmImageOptions extends CallLlmOptions { responseFormat: 'image'; models?: string[] }`, and a second `callLLM` overload returning `Promise<{ imageBase64: string; contentType: string }>` — consumed by Task 6.
- The existing single-overload signature (`callLLM(messages, options?): Promise<string>`) and every current caller stay source-compatible: no other file changes.

- [ ] **Step 1: Write the failing tests**

Add to `packages/llm/tests/index.test.ts`:

```typescript
describe('callLLM image overload', () => {
  it('sends an image-capable model list and returns the generated image as base64 + contentType', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }],
          },
        }],
      }),
    }) as unknown as typeof fetch;

    const result = await callLLM(
      [{
        role: 'user',
        content: [
          { type: 'text', text: 'Composite this product into the scene.' },
          { type: 'image_url', image_url: { url: 'https://example.com/source.jpg' } },
          { type: 'image_url', image_url: { url: 'https://example.com/product.jpg' } },
        ],
      }],
      { responseFormat: 'image' },
    );

    expect(result).toEqual({ imageBase64: 'QUJD', contentType: 'image/png' });
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Composite this product into the scene.' },
      { type: 'image_url', image_url: { url: 'https://example.com/source.jpg' } },
      { type: 'image_url', image_url: { url: 'https://example.com/product.jpg' } },
    ]);
  });

  it('throws when the response has no generated image', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    }) as unknown as typeof fetch;

    await expect(
      callLLM([{ role: 'user', content: 'x' }], { responseFormat: 'image' }),
    ).rejects.toThrow(/no generated image/);
  });

  it('throws when the response image is not a data URI', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'https://not-a-data-uri.com/x.png' } }] } }],
      }),
    }) as unknown as typeof fetch;

    await expect(
      callLLM([{ role: 'user', content: 'x' }], { responseFormat: 'image' }),
    ).rejects.toThrow(/non-data-URI/);
  });

  it('retries on 429 for an image request the same as a text request', async () => {
    const rateLimited = { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), text: async () => '' };
    const success = {
      ok: true,
      json: async () => ({
        choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] } }],
      }),
    };
    global.fetch = vi.fn().mockResolvedValueOnce(rateLimited).mockResolvedValueOnce(success) as unknown as typeof fetch;

    const result = await callLLM([{ role: 'user', content: 'x' }], { responseFormat: 'image' });
    expect(result).toEqual({ imageBase64: 'QUJD', contentType: 'image/png' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('omitting responseFormat still returns a string (text overload unaffected)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'text reply' } }] }),
    }) as unknown as typeof fetch;

    const result: string = await callLLM([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('text reply');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@lhr/llm`
Expected: FAIL — `result` is a string, `.imageBase64` is undefined; `responseFormat` not recognized by current types.

- [ ] **Step 3: Implement the overload**

Replace the body of `packages/llm/src/index.ts` from `export interface LlmMessage` through the end of `callLLM` with:

```typescript
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

const DEFAULT_IMAGE_MODELS = ['google/gemini-2.0-flash-exp:free'];

export interface CallLlmImageOptions extends CallLlmOptions {
  responseFormat: 'image';
  models?: string[];
}

interface OpenRouterImageChoice {
  message?: {
    images?: Array<{ type: 'image_url'; image_url: { url: string } }>;
  };
}

function parseDataUri(uri: string): { contentType: string; base64: string } {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('OpenRouter returned a non-data-URI image, which is not supported yet');
  return { contentType: match[1], base64: match[2] };
}

export function callLLM(messages: LlmMessage[], options?: CallLlmOptions): Promise<string>;
export function callLLM(
  messages: LlmMessage[],
  options: CallLlmImageOptions,
): Promise<{ imageBase64: string; contentType: string }>;
export async function callLLM(
  messages: LlmMessage[],
  options?: CallLlmOptions | CallLlmImageOptions,
): Promise<string | { imageBase64: string; contentType: string }> {
  const deadline = options?.deadline;
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new Error('OpenRouter call skipped: ran out of time for this pipeline run');
  }

  const isImageRequest = (options as CallLlmImageOptions | undefined)?.responseFormat === 'image';
  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const models = isImageRequest
    ? ((options as CallLlmImageOptions).models ?? DEFAULT_IMAGE_MODELS)
    : process.env.OPENROUTER_MODEL
      ? [process.env.OPENROUTER_MODEL]
      : DEFAULT_MODELS;

  const doFetch = () =>
    fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ models, messages }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let response = await doFetch();
  for (let attempt = 1; response.status === 429 && attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
    await sleep(retryDelayMs(response));
    response = await doFetch();
  }

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`OpenRouter request failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  if (isImageRequest) {
    const data = (await response.json()) as { choices?: OpenRouterImageChoice[] };
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) throw new Error('OpenRouter response had no generated image');
    const { contentType, base64 } = parseDataUri(imageUrl);
    return { imageBase64: base64, contentType };
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter response had no message content');
  }
  return content;
}
```

(Leave every earlier declaration in the file — `OPENROUTER_URL`, `DEFAULT_MODELS`, `MAX_RATE_LIMIT_ATTEMPTS`, `DEFAULT_RATE_LIMIT_BACKOFF_MS`, `REQUEST_TIMEOUT_MS`, `requireEnv`, `sleep`, `retryDelayMs`, `safeResponseText` — untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@lhr/llm`
Expected: PASS (all existing tests plus the 5 new ones)

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/index.ts packages/llm/tests/index.test.ts
git commit -m "feat(llm): add an image-output overload to callLLM"
```

---

### Task 6: `mcp-server` — swappable `ImageEditProvider`

**Files:**
- Create: `mcp-server/src/imageEdit/types.ts`, `mcp-server/src/imageEdit/openrouterFreeProvider.ts`, `mcp-server/src/imageEdit/index.ts`
- Modify: `mcp-server/package.json` (add `@lhr/llm` dependency — already present on `main`'s real `mcp-server/package.json`, so only verify, don't duplicate)
- Test: `mcp-server/tests/imageEdit/openrouterFreeProvider.test.ts`, `mcp-server/tests/imageEdit/index.test.ts`

**Interfaces:**
- Consumes: `callLLM` (image overload, Task 5) and `storeImageBuffer(buffer: Buffer, contentType: string): Promise<string>` from `mcp-server/src/blob.ts` (already on `main`, unchanged).
- Produces: `ImageEditProvider { compositeProductIntoPhoto(input: { sourceImageUrl: string; productImageUrl: string; productName: string }): Promise<{ resultImageUrl: string } | { error: string }> }` and `getImageEditProvider(): ImageEditProvider`, consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/tests/imageEdit/openrouterFreeProvider.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@lhr/llm', () => ({ callLLM: vi.fn() }));
vi.mock('../../src/blob.js', () => ({ storeImageBuffer: vi.fn() }));

import { callLLM } from '@lhr/llm';
import { storeImageBuffer } from '../../src/blob.js';
import { openrouterFreeProvider } from '../../src/imageEdit/openrouterFreeProvider';

beforeEach(() => vi.clearAllMocks());

describe('openrouterFreeProvider.compositeProductIntoPhoto', () => {
  const input = {
    sourceImageUrl: 'https://example.com/source.jpg',
    productImageUrl: 'https://example.com/product.jpg',
    productName: 'Wooden Pizza Server',
  };

  it('calls the image overload of callLLM with both images and stores the result', async () => {
    vi.mocked(callLLM).mockResolvedValue({ imageBase64: 'QUJD', contentType: 'image/png' } as never);
    vi.mocked(storeImageBuffer).mockResolvedValue('https://example.com/composited.jpg');

    const result = await openrouterFreeProvider.compositeProductIntoPhoto(input);

    expect(result).toEqual({ resultImageUrl: 'https://example.com/composited.jpg' });
    expect(callLLM).toHaveBeenCalledWith(
      [expect.objectContaining({
        role: 'user',
        content: [
          expect.objectContaining({ type: 'text' }),
          { type: 'image_url', image_url: { url: input.sourceImageUrl } },
          { type: 'image_url', image_url: { url: input.productImageUrl } },
        ],
      })],
      { responseFormat: 'image' },
    );
    expect(storeImageBuffer).toHaveBeenCalledWith(Buffer.from('QUJD', 'base64'), 'image/png');
  });

  it('returns {error} instead of throwing when callLLM rejects', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('OpenRouter request failed: 502'));
    const result = await openrouterFreeProvider.compositeProductIntoPhoto(input);
    expect(result).toEqual({ error: expect.stringContaining('502') });
  });

  it('returns {error} instead of throwing when storeImageBuffer rejects', async () => {
    vi.mocked(callLLM).mockResolvedValue({ imageBase64: 'QUJD', contentType: 'image/png' } as never);
    vi.mocked(storeImageBuffer).mockRejectedValue(new Error('R2 upload failed'));
    const result = await openrouterFreeProvider.compositeProductIntoPhoto(input);
    expect(result).toEqual({ error: expect.stringContaining('R2 upload failed') });
  });
});
```

```typescript
// mcp-server/tests/imageEdit/index.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { getImageEditProvider } from '../../src/imageEdit/index';

beforeEach(() => {
  delete process.env.IMAGE_EDIT_PROVIDER;
});

describe('getImageEditProvider', () => {
  it('defaults to openrouter-free when IMAGE_EDIT_PROVIDER is unset', () => {
    expect(getImageEditProvider()).toBeDefined();
  });

  it('throws on an unknown provider key', () => {
    process.env.IMAGE_EDIT_PROVIDER = 'not-a-real-provider';
    expect(() => getImageEditProvider()).toThrow(/Unknown IMAGE_EDIT_PROVIDER/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=lhr-authoring-mcp-server -- imageEdit`
Expected: FAIL — `Cannot find module '../../src/imageEdit/openrouterFreeProvider'`

- [ ] **Step 3: Implement**

```typescript
// mcp-server/src/imageEdit/types.ts
export interface ImageEditProvider {
  compositeProductIntoPhoto(input: {
    sourceImageUrl: string;
    productImageUrl: string;
    productName: string;
  }): Promise<{ resultImageUrl: string } | { error: string }>;
}
```

```typescript
// mcp-server/src/imageEdit/openrouterFreeProvider.ts
import { callLLM } from '@lhr/llm';
import { storeImageBuffer } from '../blob.js';
import type { ImageEditProvider } from './types.js';

export const openrouterFreeProvider: ImageEditProvider = {
  async compositeProductIntoPhoto({ sourceImageUrl, productImageUrl, productName }) {
    try {
      const models = process.env.IMAGE_EDIT_MODEL ? [process.env.IMAGE_EDIT_MODEL] : undefined;
      const { imageBase64, contentType } = await callLLM(
        [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Composite this product ("${productName}") naturally into the scene of the first photo, matching its lighting and perspective.`,
            },
            { type: 'image_url', image_url: { url: sourceImageUrl } },
            { type: 'image_url', image_url: { url: productImageUrl } },
          ],
        }],
        { responseFormat: 'image', ...(models ? { models } : {}) },
      );
      const resultImageUrl = await storeImageBuffer(Buffer.from(imageBase64, 'base64'), contentType);
      return { resultImageUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { error: `Failed to composite product into photo: ${message}` };
    }
  },
};
```

```typescript
// mcp-server/src/imageEdit/index.ts
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

Confirm `mcp-server/package.json` already lists `@lhr/llm` under `dependencies` (it does on `main`) — no edit needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-authoring-mcp-server -- imageEdit`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/imageEdit mcp-server/tests/imageEdit
git commit -m "feat(mcp-server): add swappable ImageEditProvider using callLLM's image overload"
```

---

### Task 7: `mcp-server` — LLM match prompt and response parsing

**Files:**
- Create: `mcp-server/src/productPlacementMatching.ts`
- Test: `mcp-server/tests/productPlacementMatching.test.ts`

**Interfaces:**
- Consumes: `LlmMessage` from `@lhr/llm` (Task 5, text-only shape — no image content here).
- Produces: `AffiliateLinkCandidate { id: string; label: string; url: string; imageUrl?: string }`, `MatchablePostImage { id: number; kind: 'cover' | 'body'; alt: string }`, `MatchablePost { slug: string; title: string; ingredients: string[]; images: MatchablePostImage[] }`, `MatchResult { slug: string; imageId: number; rationale: string }`, `computeUnattachedCandidates(allLinks, attachedIds: Set<string>, pendingIds: Set<string>): AffiliateLinkCandidate[]`, `buildMatchPrompt(product: AffiliateLinkCandidate, posts: MatchablePost[]): LlmMessage[]`, `parseMatchResponse(rawText: string, posts: MatchablePost[]): MatchResult | null` — all consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/tests/productPlacementMatching.test.ts
import { describe, expect, it } from 'vitest';
import {
  computeUnattachedCandidates,
  buildMatchPrompt,
  parseMatchResponse,
  type AffiliateLinkCandidate,
  type MatchablePost,
} from '../src/productPlacementMatching';

const links: AffiliateLinkCandidate[] = [
  { id: 'a', label: 'A', url: 'https://x.com/a' },
  { id: 'b', label: 'B', url: 'https://x.com/b' },
  { id: 'c', label: 'C', url: 'https://x.com/c' },
];

const posts: MatchablePost[] = [
  { slug: 'pizza', title: 'Pizza', ingredients: ['Mozzarella'], images: [{ id: 0, kind: 'cover', alt: 'cover' }] },
];

describe('computeUnattachedCandidates', () => {
  it('excludes links already attached to a post or already pending review', () => {
    const result = computeUnattachedCandidates(links, new Set(['a']), new Set(['b']));
    expect(result).toEqual([links[2]]);
  });
});

describe('buildMatchPrompt', () => {
  it('builds a system + user LlmMessage pair naming the product and posts', () => {
    const messages = buildMatchPrompt(links[0], posts);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    const userContent = JSON.parse(messages[1].content as string);
    expect(userContent.product.label).toBe('A');
    expect(userContent.posts[0].slug).toBe('pizza');
  });
});

describe('parseMatchResponse', () => {
  it('parses a valid match referencing a real post and image id', () => {
    const raw = JSON.stringify({ match: { slug: 'pizza', imageId: 0, rationale: 'fits the cover' } });
    expect(parseMatchResponse(raw, posts)).toEqual({ slug: 'pizza', imageId: 0, rationale: 'fits the cover' });
  });

  it('returns null for {match: null}', () => {
    expect(parseMatchResponse(JSON.stringify({ match: null }), posts)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseMatchResponse('not json', posts)).toBeNull();
  });

  it('returns null when the slug does not match any known post', () => {
    const raw = JSON.stringify({ match: { slug: 'unknown', imageId: 0, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when the imageId does not exist on the matched post', () => {
    const raw = JSON.stringify({ match: { slug: 'pizza', imageId: 99, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when slug is not a string', () => {
    const raw = JSON.stringify({ match: { slug: 42, imageId: 0, rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when imageId is not a number', () => {
    const raw = JSON.stringify({ match: { slug: 'pizza', imageId: '0', rationale: 'x' } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });

  it('returns null when rationale is not a string', () => {
    const raw = JSON.stringify({ match: { slug: 'pizza', imageId: 0, rationale: 42 } });
    expect(parseMatchResponse(raw, posts)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=lhr-authoring-mcp-server -- productPlacementMatching`
Expected: FAIL — `Cannot find module '../src/productPlacementMatching'`

- [ ] **Step 3: Implement**

```typescript
// mcp-server/src/productPlacementMatching.ts
import type { LlmMessage } from '@lhr/llm';

export interface AffiliateLinkCandidate {
  id: string;
  label: string;
  url: string;
  imageUrl?: string;
}

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

export function computeUnattachedCandidates(
  allLinks: AffiliateLinkCandidate[],
  attachedIds: Set<string>,
  pendingIds: Set<string>,
): AffiliateLinkCandidate[] {
  return allLinks.filter((link) => !attachedIds.has(link.id) && !pendingIds.has(link.id));
}

export function buildMatchPrompt(product: AffiliateLinkCandidate, posts: MatchablePost[]): LlmMessage[] {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-authoring-mcp-server -- productPlacementMatching`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/productPlacementMatching.ts mcp-server/tests/productPlacementMatching.test.ts
git commit -m "feat(mcp-server): add LLM match prompt building and response parsing"
```

---

### Task 8: `mcp-server` — `reconcileApprovedProposals`

**Files:**
- Create: `mcp-server/src/matchProductsToRecipes.ts` (this task writes only `reconcileApprovedProposals`; Task 9 appends the job body to the same file)
- Modify: `mcp-server/package.json` (add `@lhr/content` to `dependencies`)
- Test: `mcp-server/tests/matchProductsToRecipes.test.ts` (this task writes the `reconcileApprovedProposals` describe block; Task 9 appends the rest)

**Interfaces:**
- Consumes: `getFile`, `commitFilesToMain`, `type GitHubClient` from `./github.js`; `applyProductPlacement`, `StaleImageTargetError` from `@lhr/content` (Task 3); `getApprovedProposals`, `markProposalStatus`, `type Queryable` from `@lhr/db` (Task 1).
- Produces: `reconcileApprovedProposals(db: Queryable, githubClient: GitHubClient): Promise<void>`, consumed by Task 9's `matchProductsToRecipes`.

- [ ] **Step 1: Add `@lhr/content` to `mcp-server/package.json`**

In `mcp-server/package.json`, add `"@lhr/content": "*",` to `dependencies` (alphabetical, next to `@lhr/db`).

- [ ] **Step 2: Write the failing tests**

```typescript
// mcp-server/tests/matchProductsToRecipes.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github.js', () => ({ getFile: vi.fn(), commitFilesToMain: vi.fn(), listFiles: vi.fn() }));
vi.mock('@lhr/db', () => ({
  getApprovedProposals: vi.fn(),
  markProposalStatus: vi.fn(),
  getPendingAffiliateLinkIds: vi.fn(),
  insertProductPlacementProposal: vi.fn(),
}));

import { getFile, commitFilesToMain } from '../src/github.js';
import { getApprovedProposals, markProposalStatus } from '@lhr/db';
import { reconcileApprovedProposals } from '../src/matchProductsToRecipes';

const approvedProposal = {
  id: 1, cycleId: '2026-09-09', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
  targetImageKind: 'body' as const, targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'r', compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'approved' as const, decidedAt: new Date(), createdAt: new Date(),
};

const postMdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
affiliateLinkIds: []
coverPhoto: "https://example.com/cover.jpg"
---

Body.

![Slicing the pizza](https://example.com/slice.jpg)
`;

beforeEach(() => vi.clearAllMocks());

describe('reconcileApprovedProposals', () => {
  it('commits the MDX update for an approved proposal not yet reflected in the post', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([approvedProposal] as never);
    vi.mocked(getFile).mockResolvedValue({ content: postMdx, sha: 'a' });

    await reconcileApprovedProposals({} as never, {} as never);

    expect(commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/posts/pizza.mdx', content: expect.stringContaining('composited.jpg') }],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
  });

  it('skips a proposal that is already reflected in the post (idempotent)', async () => {
    const alreadyDone = postMdx
      .replace('slice.jpg', 'composited.jpg')
      .replace('affiliateLinkIds: []', 'affiliateLinkIds: ["wooden-pizza-server-1234"]');
    vi.mocked(getApprovedProposals).mockResolvedValue([approvedProposal] as never);
    vi.mocked(getFile).mockResolvedValue({ content: alreadyDone, sha: 'a' });

    await reconcileApprovedProposals({} as never, {} as never);

    expect(commitFilesToMain).not.toHaveBeenCalled();
  });

  it('skips a proposal with no compositedImageUrl', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([{ ...approvedProposal, compositedImageUrl: null }] as never);

    await reconcileApprovedProposals({} as never, {} as never);

    expect(getFile).not.toHaveBeenCalled();
  });

  it('marks the proposal stale and continues when the target image no longer matches the post', async () => {
    const changedPost = postMdx.replace('slice.jpg', 'different-image.jpg');
    vi.mocked(getApprovedProposals).mockResolvedValue([approvedProposal] as never);
    vi.mocked(getFile).mockResolvedValue({ content: changedPost, sha: 'a' });

    await reconcileApprovedProposals({} as never, {} as never);

    expect(markProposalStatus).toHaveBeenCalledWith({}, 1, 'stale');
    expect(commitFilesToMain).not.toHaveBeenCalled();
  });

  it('continues to the next proposal when getFile throws a transient GitHub error', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([approvedProposal, { ...approvedProposal, id: 2 }] as never);
    vi.mocked(getFile).mockRejectedValueOnce(new Error('GitHub API 502')).mockResolvedValueOnce({ content: postMdx, sha: 'a' });

    await expect(reconcileApprovedProposals({} as never, {} as never)).resolves.toBeUndefined();
    expect(commitFilesToMain).toHaveBeenCalledTimes(1);
  });

  it('does nothing when getFile returns null (post deleted)', async () => {
    vi.mocked(getApprovedProposals).mockResolvedValue([approvedProposal] as never);
    vi.mocked(getFile).mockResolvedValue(null);

    await reconcileApprovedProposals({} as never, {} as never);

    expect(commitFilesToMain).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test --workspace=lhr-authoring-mcp-server -- matchProductsToRecipes`
Expected: FAIL — `Cannot find module '../src/matchProductsToRecipes'`

- [ ] **Step 4: Implement**

```typescript
// mcp-server/src/matchProductsToRecipes.ts
import type { Queryable } from '@lhr/db';
import { getApprovedProposals, markProposalStatus } from '@lhr/db';
import { getFile, commitFilesToMain, type GitHubClient } from './github.js';
import { applyProductPlacement, StaleImageTargetError } from '@lhr/content';

export async function reconcileApprovedProposals(db: Queryable, githubClient: GitHubClient): Promise<void> {
  const approved = await getApprovedProposals(db);

  for (const proposal of approved) {
    if (!proposal.compositedImageUrl) continue;

    try {
      const file = await getFile(githubClient, `src/content/posts/${proposal.postSlug}.mdx`, 'main');
      if (!file) continue;

      const alreadyReflected =
        file.content.includes(proposal.compositedImageUrl) && file.content.includes(proposal.affiliateLinkId);
      if (alreadyReflected) continue;

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
      if (err instanceof StaleImageTargetError) {
        await markProposalStatus(db, proposal.id, 'stale');
      }
      // Any other error (transient GitHub failure) is retried on the next cycle.
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=lhr-authoring-mcp-server -- matchProductsToRecipes`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add mcp-server/package.json mcp-server/src/matchProductsToRecipes.ts mcp-server/tests/matchProductsToRecipes.test.ts
git commit -m "feat(mcp-server): reconcile approved proposals whose commit didn't land"
```

---

### Task 9: `mcp-server` — `matchProductsToRecipes` job body

**Files:**
- Modify: `mcp-server/src/matchProductsToRecipes.ts` (append the job entry point)
- Modify: `mcp-server/tests/matchProductsToRecipes.test.ts` (append its tests)

**Interfaces:**
- Consumes: `getPool`, `Queryable`, `getPendingAffiliateLinkIds`, `insertProductPlacementProposal`, `type NewProductPlacementProposal` from `@lhr/db` (Task 1); `createGitHubClient` from `./github.js`; `readCollection` from `./catalog.js` (already on `main`); `listPublishedPosts` from `./publishedPosts.js` (Task 4); `enumeratePostImages` from `@lhr/content` (Task 2); `getImageEditProvider` from `./imageEdit/index.js` (Task 6); `computeUnattachedCandidates`, `buildMatchPrompt`, `parseMatchResponse` from `./productPlacementMatching.js` (Task 7); `callLLM` from `@lhr/llm` (Task 5); `reconcileApprovedProposals` from this same file (Task 8); `requireEnv` from `./blob.js`; `type JobResult` from `./generateWeeklyVariantRecipe.js` (already on `main` — this is how every sibling job avoids a circular import with `@lhr/jobs`).
- Produces: `matchProductsToRecipes(): Promise<JobResult>` — the `Job`-contract entry point. **Not registered in `apps/lhr-office/src/registry.ts`** by this plan (see Global Constraints).

- [ ] **Step 1: Write the failing tests**

Append to `mcp-server/tests/matchProductsToRecipes.test.ts` (add these mocks alongside the existing `vi.mock` calls at the top of the file, and this `describe` block at the end):

```typescript
// Add to the vi.mock('../src/github.js', ...) factory at the top of the file:
//   listFiles: vi.fn()   (already present)
// Add these additional mocks near the top of the file, alongside the existing ones:
vi.mock('@lhr/llm', () => ({ callLLM: vi.fn() }));
vi.mock('../src/imageEdit/index.js', () => ({ getImageEditProvider: vi.fn() }));
vi.mock('../src/publishedPosts.js', () => ({ listPublishedPosts: vi.fn() }));
vi.mock('../src/catalog.js', () => ({ readCollection: vi.fn() }));

// Extend the '@lhr/db' mock factory (already declared above) to also return:
//   getPool: vi.fn(() => ({})),
//   getPendingAffiliateLinkIds: vi.fn().mockResolvedValue(new Set()),
//   insertProductPlacementProposal: vi.fn().mockResolvedValue(1),

import { callLLM } from '@lhr/llm';
import { getImageEditProvider } from '../src/imageEdit/index.js';
import { listPublishedPosts } from '../src/publishedPosts.js';
import { readCollection } from '../src/catalog.js';
import { getPendingAffiliateLinkIds, insertProductPlacementProposal } from '@lhr/db';
import { matchProductsToRecipes } from '../src/matchProductsToRecipes';

const publishedPost = {
  slug: 'pizza',
  raw: postMdx,
  title: 'Chicago Deep Dish Pizza',
  ingredients: [{ item: 'Mozzarella' }],
  affiliateLinkIds: [],
};

const affiliateLinkEntry = {
  id: 'wooden-pizza-server-1234',
  data: { label: 'Wooden Pizza Server', url: 'https://amazon.com/x', image: 'https://example.com/product.jpg' },
};

beforeEach(() => {
  process.env.GITHUB_TOKEN = 'test-token';
  vi.mocked(listPublishedPosts).mockResolvedValue([publishedPost]);
  vi.mocked(readCollection).mockResolvedValue([affiliateLinkEntry]);
  vi.mocked(getPendingAffiliateLinkIds).mockResolvedValue(new Set());
});

describe('matchProductsToRecipes', () => {
  it('reconciles first, then creates a pending proposal when the LLM finds a good match and the image edit succeeds', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    vi.mocked(getImageEditProvider).mockReturnValue({
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ resultImageUrl: 'https://example.com/composited.jpg' }),
    });
    vi.mocked(getApprovedProposals).mockResolvedValue([]);

    const result = await matchProductsToRecipes();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('1 proposal');
    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        affiliateLinkId: 'wooden-pizza-server-1234',
        postSlug: 'pizza',
        targetImageKind: 'body',
        compositedImageUrl: 'https://example.com/composited.jpg',
        status: 'pending',
      }),
    );
  });

  it('returns success with zero proposals when the LLM finds no good match', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ match: null }));
    vi.mocked(getApprovedProposals).mockResolvedValue([]);

    const result = await matchProductsToRecipes();

    expect(result.status).toBe('success');
    expect(insertProductPlacementProposal).not.toHaveBeenCalled();
  });

  it('creates an edit_failed proposal when the match succeeds but the image edit fails', async () => {
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    vi.mocked(getImageEditProvider).mockReturnValue({
      compositeProductIntoPhoto: vi.fn().mockResolvedValue({ error: 'model unavailable' }),
    });
    vi.mocked(getApprovedProposals).mockResolvedValue([]);

    await matchProductsToRecipes();

    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'edit_failed', compositedImageUrl: null }),
    );
  });

  it('creates an edit_failed proposal without calling the image-edit provider when the candidate has no product image', async () => {
    vi.mocked(readCollection).mockResolvedValue([{ ...affiliateLinkEntry, data: { ...affiliateLinkEntry.data, image: undefined } }]);
    vi.mocked(callLLM).mockResolvedValue(
      JSON.stringify({ match: { slug: 'pizza', imageId: 1, rationale: 'Used to serve the slice' } }),
    );
    const compositeProductIntoPhoto = vi.fn();
    vi.mocked(getImageEditProvider).mockReturnValue({ compositeProductIntoPhoto });
    vi.mocked(getApprovedProposals).mockResolvedValue([]);

    await matchProductsToRecipes();

    expect(compositeProductIntoPhoto).not.toHaveBeenCalled();
    expect(insertProductPlacementProposal).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'edit_failed' }),
    );
  });

  it('skips a candidate and continues when callLLM rejects', async () => {
    vi.mocked(readCollection).mockResolvedValue([
      affiliateLinkEntry,
      { id: 'second-product', data: { label: 'Second', url: 'https://amazon.com/y', image: 'https://example.com/y.jpg' } },
    ]);
    vi.mocked(callLLM)
      .mockRejectedValueOnce(new Error('OpenRouter request failed: 502'))
      .mockResolvedValueOnce(JSON.stringify({ match: null }));
    vi.mocked(getApprovedProposals).mockResolvedValue([]);

    const result = await matchProductsToRecipes();

    expect(result.status).toBe('success');
    expect(insertProductPlacementProposal).not.toHaveBeenCalled();
  });

  it('excludes affiliate links already attached to a post or already pending review', async () => {
    vi.mocked(listPublishedPosts).mockResolvedValue([{ ...publishedPost, affiliateLinkIds: ['wooden-pizza-server-1234'] }]);
    vi.mocked(getApprovedProposals).mockResolvedValue([]);

    const result = await matchProductsToRecipes();

    expect(result.details?.proposalsCreated).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=lhr-authoring-mcp-server -- matchProductsToRecipes`
Expected: FAIL — `matchProductsToRecipes` is not exported / is `undefined`

- [ ] **Step 3: Append the job body to `mcp-server/src/matchProductsToRecipes.ts`**

Add these imports to the top of the file (alongside the ones from Task 8):

```typescript
import { getPool, getPendingAffiliateLinkIds, insertProductPlacementProposal, type NewProductPlacementProposal } from '@lhr/db';
import { createGitHubClient } from './github.js';
import { readCollection } from './catalog.js';
import { callLLM } from '@lhr/llm';
import { listPublishedPosts } from './publishedPosts.js';
import { enumeratePostImages } from '@lhr/content';
import { getImageEditProvider } from './imageEdit/index.js';
import {
  computeUnattachedCandidates,
  buildMatchPrompt,
  parseMatchResponse,
  type AffiliateLinkCandidate,
  type MatchablePost,
} from './productPlacementMatching.js';
import { requireEnv } from './blob.js';
import type { JobResult } from './generateWeeklyVariantRecipe.js';
```

Append the job function:

```typescript
interface AffiliateLinkData {
  label: string;
  url: string;
  image?: string;
}

function newCycleId(): string {
  return new Date().toISOString().slice(0, 10);
}

// The Job-contract entry point. NOT YET registered in apps/lhr-office/src/registry.ts — see the
// spec's Architecture section: the image-edit path depends on a free/rate-limited OpenRouter
// model today and is due for replacement by local processing, so this ships complete but dormant
// until a one-line registry addition turns it on.
export async function matchProductsToRecipes(): Promise<JobResult> {
  const githubToken = requireEnv('GITHUB_TOKEN');
  const githubClient = createGitHubClient(githubToken);
  const db = getPool();

  await reconcileApprovedProposals(db, githubClient);

  const imageEditProvider = getImageEditProvider();
  const cycleId = newCycleId();

  const [allLinkEntries, publishedPosts, pendingIds] = await Promise.all([
    readCollection<AffiliateLinkData>(githubClient, 'src/content/affiliate-links'),
    listPublishedPosts(githubClient),
    getPendingAffiliateLinkIds(db),
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
  let editFailures = 0;

  for (const candidate of candidates) {
    let rawResponse: string;
    try {
      rawResponse = await callLLM(buildMatchPrompt(candidate, matchablePosts));
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

    if (status === 'edit_failed') editFailures++;

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
    await insertProductPlacementProposal(db, proposal);
    proposalsCreated++;
  }

  const summary = `Found ${candidates.length} unattached candidate(s); created ${proposalsCreated} proposal(s) for cycle ${cycleId}${editFailures > 0 ? ` (${editFailures} edit_failed)` : ''}.`;
  const details = { cycleId, candidatesConsidered: candidates.length, proposalsCreated, editFailures };

  return { status: editFailures > 0 && proposalsCreated === editFailures ? 'partial' : 'success', summary, details };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-authoring-mcp-server -- matchProductsToRecipes`
Expected: PASS (all `reconcileApprovedProposals` tests from Task 8 plus the 6 new ones)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/matchProductsToRecipes.ts mcp-server/tests/matchProductsToRecipes.test.ts
git commit -m "feat(mcp-server): add matchProductsToRecipes job (unregistered)"
```

---

### Task 10: `mcp-server` — `productPlacementOps.ts` (approve/reject)

**Files:**
- Create: `mcp-server/src/productPlacementOps.ts`
- Test: `mcp-server/tests/productPlacementOps.test.ts`

**Interfaces:**
- Consumes: `getProposalById`, `markProposalStatus`, `type Queryable` from `@lhr/db` (Task 1); `commitFilesToMain`, `getFile`, `type GitHubClient` from `./github.js`; `applyProductPlacement`, `StaleImageTargetError` from `@lhr/content` (Task 3).
- Produces: `ProposalNotFoundError`, `ProposalAlreadyDecidedError`, `ApprovedProductPlacement { postSlug: string; affiliateLinkId: string }`, `RejectedProductPlacement { postSlug: string; affiliateLinkId: string }`, `approveProductPlacement(db: Queryable, githubClient: GitHubClient, id: number): Promise<ApprovedProductPlacement>`, `rejectProductPlacement(db: Queryable, id: number): Promise<RejectedProductPlacement>` — consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/tests/productPlacementOps.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const githubMock = { commitFilesToMain: vi.fn(), getFile: vi.fn() };
vi.mock('../src/github.js', () => githubMock);

const dbMock = { getProposalById: vi.fn(), markProposalStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const {
  approveProductPlacement,
  rejectProductPlacement,
  ProposalNotFoundError,
  ProposalAlreadyDecidedError,
} = await import('../src/productPlacementOps');

const db = { query: vi.fn() } as never;
const githubClient = {} as never;

const pendingProposal = {
  id: 1, cycleId: '2026-09-09', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
  targetImageKind: 'body' as const, targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'r', compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending' as const, decidedAt: null, createdAt: new Date(),
};

const postMdx = `---
type: recipe
title: "Chicago Deep Dish Pizza"
affiliateLinkIds: []
coverPhoto: "https://example.com/cover.jpg"
---

Body.

![Slicing the pizza](https://example.com/slice.jpg)
`;

beforeEach(() => vi.clearAllMocks());

describe('approveProductPlacement', () => {
  it('commits the MDX update and marks the proposal approved', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    githubMock.getFile.mockResolvedValue({ content: postMdx, sha: 'a' });

    const result = await approveProductPlacement(db, githubClient, 1);

    expect(result).toEqual({ postSlug: 'pizza', affiliateLinkId: 'wooden-pizza-server-1234' });
    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      githubClient,
      [{ path: 'src/content/posts/pizza.mdx', content: expect.stringContaining('composited.jpg') }],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(db, 1, 'approved');
  });

  it('throws ProposalNotFoundError for an unknown id', async () => {
    dbMock.getProposalById.mockResolvedValue(null);
    await expect(approveProductPlacement(db, githubClient, 999)).rejects.toThrow(ProposalNotFoundError);
  });

  it('throws ProposalAlreadyDecidedError for a non-pending/edit_failed proposal', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'approved' });
    await expect(approveProductPlacement(db, githubClient, 1)).rejects.toThrow(ProposalAlreadyDecidedError);
  });

  it('allows approving an edit_failed proposal that has no compositedImageUrl by committing no image change', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'edit_failed', compositedImageUrl: null });
    githubMock.getFile.mockResolvedValue({ content: postMdx, sha: 'a' });

    await approveProductPlacement(db, githubClient, 1);

    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(db, 1, 'approved');
  });
});

describe('rejectProductPlacement', () => {
  it('marks the proposal rejected without any GitHub write', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);

    const result = await rejectProductPlacement(db, 1);

    expect(result).toEqual({ postSlug: 'pizza', affiliateLinkId: 'wooden-pizza-server-1234' });
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(db, 1, 'rejected');
  });

  it('throws ProposalNotFoundError for an unknown id', async () => {
    dbMock.getProposalById.mockResolvedValue(null);
    await expect(rejectProductPlacement(db, 999)).rejects.toThrow(ProposalNotFoundError);
  });

  it('throws ProposalAlreadyDecidedError for an already-decided proposal', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'rejected' });
    await expect(rejectProductPlacement(db, 1)).rejects.toThrow(ProposalAlreadyDecidedError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=lhr-authoring-mcp-server -- productPlacementOps`
Expected: FAIL — `Cannot find module '../src/productPlacementOps'`

- [ ] **Step 3: Implement**

```typescript
// mcp-server/src/productPlacementOps.ts
import { getProposalById, markProposalStatus, type Queryable, type ProductPlacementProposal } from '@lhr/db';
import { commitFilesToMain, getFile, type GitHubClient } from './github.js';
import { applyProductPlacement } from '@lhr/content';

export class ProposalNotFoundError extends Error {
  constructor(id: number) {
    super(`Proposal ${id} not found`);
    this.name = 'ProposalNotFoundError';
  }
}

export class ProposalAlreadyDecidedError extends Error {
  constructor(id: number, status: ProductPlacementProposal['status']) {
    super(`Proposal ${id} is already ${status}`);
    this.name = 'ProposalAlreadyDecidedError';
  }
}

async function loadReviewable(db: Queryable, id: number): Promise<ProductPlacementProposal> {
  const proposal = await getProposalById(db, id);
  if (!proposal) throw new ProposalNotFoundError(id);
  if (proposal.status !== 'pending' && proposal.status !== 'edit_failed') {
    throw new ProposalAlreadyDecidedError(id, proposal.status);
  }
  return proposal;
}

export interface ApprovedProductPlacement {
  postSlug: string;
  affiliateLinkId: string;
}

export async function approveProductPlacement(
  db: Queryable,
  githubClient: GitHubClient,
  id: number,
): Promise<ApprovedProductPlacement> {
  const proposal = await loadReviewable(db, id);

  if (proposal.compositedImageUrl) {
    const file = await getFile(githubClient, `src/content/posts/${proposal.postSlug}.mdx`, 'main');
    if (file) {
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
    }
  }

  await markProposalStatus(db, id, 'approved');
  return { postSlug: proposal.postSlug, affiliateLinkId: proposal.affiliateLinkId };
}

export interface RejectedProductPlacement {
  postSlug: string;
  affiliateLinkId: string;
}

export async function rejectProductPlacement(db: Queryable, id: number): Promise<RejectedProductPlacement> {
  const proposal = await loadReviewable(db, id);
  await markProposalStatus(db, id, 'rejected');
  return { postSlug: proposal.postSlug, affiliateLinkId: proposal.affiliateLinkId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-authoring-mcp-server -- productPlacementOps`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/productPlacementOps.ts mcp-server/tests/productPlacementOps.test.ts
git commit -m "feat(mcp-server): add approve/reject ops for product placement proposals"
```

---

### Task 11: `apps/lhr-office` — `routes/productPlacements.ts`

**Files:**
- Create: `apps/lhr-office/src/routes/productPlacements.ts`
- Test: `apps/lhr-office/tests/routes/productPlacements.test.ts`

**Interfaces:**
- Consumes: `getReviewableProposals`, `type Queryable`, `type ProductPlacementProposal` from `@lhr/db` (Task 1); `createGitHubClient` from `lhr-authoring-mcp-server/dist-lib/github.js`; `approveProductPlacement`, `rejectProductPlacement`, `type ApprovedProductPlacement`, `type RejectedProductPlacement` from `lhr-authoring-mcp-server/dist-lib/productPlacementOps.js` (Task 10, built).
- Produces: `ProductPlacementOps { getPending: () => Promise<ProductPlacementProposal[]>; approve: (id: number) => Promise<ApprovedProductPlacement>; reject: (id: number) => Promise<RejectedProductPlacement> }`, `defaultProductPlacementOps(db: Queryable): ProductPlacementOps`, `createProductPlacementsRouter(ops: ProductPlacementOps): express.Router` — consumed by Task 12.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/lhr-office/tests/routes/productPlacements.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProductPlacementsRouter } from '../../src/routes/productPlacements';

function buildApp(ops: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/product-placements', createProductPlacementsRouter(ops));
  return app;
}

const noOps = { getPending: vi.fn().mockResolvedValue([]), approve: vi.fn(), reject: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/product-placements', () => {
  it('returns the pending proposals', async () => {
    const ops = { ...noOps, getPending: vi.fn().mockResolvedValue([{ id: 1, postSlug: 'pizza' }]) };
    const res = await request(buildApp(ops)).get('/api/product-placements');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, postSlug: 'pizza' }]);
  });

  it('returns 500 with the error message when ops.getPending throws', async () => {
    const ops = { ...noOps, getPending: vi.fn().mockRejectedValue(new Error('db down')) };
    const res = await request(buildApp(ops)).get('/api/product-placements');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});

describe('POST /api/product-placements/:id/approve', () => {
  it('approves and returns the result', async () => {
    const ops = { ...noOps, approve: vi.fn().mockResolvedValue({ postSlug: 'pizza', affiliateLinkId: 'x' }) };
    const res = await request(buildApp(ops)).post('/api/product-placements/1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ postSlug: 'pizza', affiliateLinkId: 'x' });
    expect(ops.approve).toHaveBeenCalledWith(1);
  });

  it('returns 500 with the error message when approve throws', async () => {
    const ops = { ...noOps, approve: vi.fn().mockRejectedValue(new Error('Proposal 1 not found')) };
    const res = await request(buildApp(ops)).post('/api/product-placements/1/approve');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Proposal 1 not found' });
  });
});

describe('POST /api/product-placements/:id/reject', () => {
  it('rejects and returns the result', async () => {
    const ops = { ...noOps, reject: vi.fn().mockResolvedValue({ postSlug: 'pizza', affiliateLinkId: 'x' }) };
    const res = await request(buildApp(ops)).post('/api/product-placements/1/reject');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ postSlug: 'pizza', affiliateLinkId: 'x' });
    expect(ops.reject).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=lhr-office -- routes/productPlacements`
Expected: FAIL — `Cannot find module '../../src/routes/productPlacements'`

- [ ] **Step 3: Implement**

```typescript
// apps/lhr-office/src/routes/productPlacements.ts
import express from 'express';
import type { Queryable, ProductPlacementProposal } from '@lhr/db';
import { getReviewableProposals } from '@lhr/db';
import { createGitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import {
  approveProductPlacement,
  rejectProductPlacement,
  type ApprovedProductPlacement,
  type RejectedProductPlacement,
} from 'lhr-authoring-mcp-server/dist-lib/productPlacementOps.js';

export interface ProductPlacementOps {
  getPending: () => Promise<ProductPlacementProposal[]>;
  approve: (id: number) => Promise<ApprovedProductPlacement>;
  reject: (id: number) => Promise<RejectedProductPlacement>;
}

function requireGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return token;
}

export function defaultProductPlacementOps(db: Queryable): ProductPlacementOps {
  return {
    getPending: () => getReviewableProposals(db),
    approve: (id) => approveProductPlacement(db, createGitHubClient(requireGitHubToken()), id),
    reject: (id) => rejectProductPlacement(db, id),
  };
}

export function createProductPlacementsRouter(ops: ProductPlacementOps): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      res.json(await ops.getPending());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/:id/approve', async (req, res) => {
    try {
      res.json(await ops.approve(Number(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/:id/reject', async (req, res) => {
    try {
      res.json(await ops.reject(Number(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-office -- routes/productPlacements`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/routes/productPlacements.ts apps/lhr-office/tests/routes/productPlacements.test.ts
git commit -m "feat(office): add product-placements API route"
```

---

### Task 12: `apps/lhr-office` — wire the router into `server.ts`

**Files:**
- Modify: `apps/lhr-office/src/server.ts`
- Modify: `apps/lhr-office/tests/server.test.ts` (add coverage for the new route; existing calls are unaffected — see Global Constraints)

**Interfaces:**
- Consumes: `ProductPlacementOps`, `defaultProductPlacementOps`, `createProductPlacementsRouter` from `./routes/productPlacements.js` (Task 11).
- Produces: `createApp(db, registry, candidates, affiliateCandidates, clientAssets, productPlacements)` — `productPlacements` is a new, trailing, defaulted parameter; `/api/product-placements` mounted behind `requireSupabaseAuth`.

- [ ] **Step 1: Write the failing test**

Add to `apps/lhr-office/tests/server.test.ts` (near the other route describe blocks; reuses the file's existing `fakeDb`, valid-JWT-mocking setup for `requireSupabaseAuth` that the affiliate-candidates tests already use):

```typescript
describe('GET /api/product-placements', () => {
  it('returns proposals from the injected ProductPlacementOps', async () => {
    const productPlacements = {
      getPending: vi.fn().mockResolvedValue([{ id: 1, postSlug: 'pizza' }]),
      approve: vi.fn(),
      reject: vi.fn(),
    };
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, undefined, productPlacements);
    const res = await request(app).get('/api/product-placements').set('Authorization', validAuthHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, postSlug: 'pizza' }]);
  });

  it('rejects without a valid Supabase session, same as every other /api route', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/product-placements');
    expect(res.status).toBe(401);
  });
});
```

(If `apps/lhr-office/tests/server.test.ts` mocks `jose`'s `jwtVerify` to produce `validAuthHeader` for the existing `AffiliateCandidateOps` tests, reuse that exact same mock/header — do not create a second auth-mocking scheme.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=lhr-office -- server.test`
Expected: FAIL — `createApp` only accepts 5 params; `/api/product-placements` 404s

- [ ] **Step 3: Implement**

In `apps/lhr-office/src/server.ts`, add the import:

```typescript
import {
  createProductPlacementsRouter,
  defaultProductPlacementOps,
  type ProductPlacementOps,
} from './routes/productPlacements.js';
```

Add to the `export type { ... }` line:

```typescript
export type { CandidateOps, AffiliateCandidateOps, ProductPlacementOps };
```

Change the `createApp` signature to append the new trailing parameter:

```typescript
export function createApp(
  db: Queryable,
  registry: JobRegistration[] = defaultRegistry,
  candidates: CandidateOps = defaultCandidateOps(),
  affiliateCandidates: AffiliateCandidateOps = defaultAffiliateCandidateOps(db),
  clientAssets: Record<string, ClientAsset> = defaultClientAssets,
  productPlacements: ProductPlacementOps = defaultProductPlacementOps(db),
): express.Express {
```

Add the route mount alongside the other `/api/*` routers:

```typescript
app.use('/api/product-placements', requireSupabaseAuth, createProductPlacementsRouter(productPlacements));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=lhr-office`
Expected: PASS (every existing test plus the 2 new ones — confirms the trailing-parameter choice didn't break any positional call site)

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/server.ts apps/lhr-office/tests/server.test.ts
git commit -m "feat(office): mount the product-placements router in the API app"
```

---

### Task 13: `apps/lhr-office` client — Product placements section on the Approvals page

**Files:**
- Modify: `apps/lhr-office/client/src/lib/types.ts` (add type)
- Modify: `apps/lhr-office/client/src/pages/Approvals.tsx` (add section)
- Modify: `apps/lhr-office/client/src/pages/Approvals.test.tsx` (add coverage)

**Interfaces:**
- Consumes: `useApiResource<T>(path: string): ApiResourceState<T>` and `apiFetch<T>(path, init?)` (both already on `main`, unchanged).
- Produces: `ProductPlacementProposal` client type; no new exports from `Approvals.tsx` (it's a page component, not a library module).

- [ ] **Step 1: Add the type**

Add to `apps/lhr-office/client/src/lib/types.ts`:

```typescript
export interface ProductPlacementProposal {
  id: number;
  postSlug: string;
  affiliateLinkId: string;
  targetImageUrl: string;
  compositedImageUrl: string | null;
  matchRationale: string;
  status: 'pending' | 'edit_failed';
}
```

- [ ] **Step 2: Write the failing test**

Add to `apps/lhr-office/client/src/pages/Approvals.test.tsx`, extending the existing `mockData()` helper's `apiFetchMock.mockImplementation` with one more branch:

```typescript
// Inside mockData()'s apiFetchMock.mockImplementation, add before the final `return { ok: true };`:
if (path === '/api/product-placements') {
  return [{
    id: 1, postSlug: 'pizza', affiliateLinkId: 'wooden-pizza-server-1234',
    targetImageUrl: 'https://example.com/slice.jpg',
    compositedImageUrl: 'https://example.com/composited.jpg',
    matchRationale: 'Used to serve the slice', status: 'pending',
  }];
}
```

Add a new `describe` block:

```typescript
describe('Approvals — product placements', () => {
  it('renders a proposal with before/after thumbnails and approves it', async () => {
    render(<Approvals />);
    await screen.findByText('wooden-pizza-server-1234');

    const before = screen.getByAltText('Current photo');
    const after = screen.getByAltText('Proposed photo');
    expect(before).toHaveAttribute('src', 'https://example.com/slice.jpg');
    expect(after).toHaveAttribute('src', 'https://example.com/composited.jpg');

    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[approveButtons.length - 1]);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/product-placements/1/approve', { method: 'POST' }),
    );
  });

  it('rejects a proposal', async () => {
    render(<Approvals />);
    await screen.findByText('wooden-pizza-server-1234');

    const rejectButtons = await screen.findAllByRole('button', { name: 'Reject' });
    fireEvent.click(rejectButtons[rejectButtons.length - 1]);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/product-placements/1/reject', { method: 'POST' }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace=lhr-office -- Approvals`
Expected: FAIL — no element with text `wooden-pizza-server-1234`, no "Current photo"/"Proposed photo" alt text

- [ ] **Step 4: Implement the section**

In `apps/lhr-office/client/src/pages/Approvals.tsx`, add the import:

```typescript
import type { AffiliateCandidate, CompetitorsResponse, ProductPlacementProposal, RecipeCandidateSummary } from '../lib/types';
```

Add the resource hook alongside the others:

```typescript
const productPlacements = useApiResource<ProductPlacementProposal[]>('/api/product-placements');
```

Add a new `<section>` before the closing `</div>` of the component:

```tsx
<section>
  <h2>Product placements</h2>
  {productPlacements.error && <p role="alert">{productPlacements.error}</p>}
  <ul>
    {(productPlacements.data ?? []).map((p) => (
      <li key={p.id}>
        <span>{p.affiliateLinkId}</span>
        <img src={p.targetImageUrl} alt="Current photo" width={80} />
        {p.compositedImageUrl && <img src={p.compositedImageUrl} alt="Proposed photo" width={80} />}
        <p>{p.matchRationale}</p>
        <button
          onClick={() =>
            runAction(() => apiFetch(`/api/product-placements/${p.id}/approve`, { method: 'POST' }), productPlacements.refetch)
          }
        >
          Approve
        </button>
        <button
          onClick={() =>
            runAction(() => apiFetch(`/api/product-placements/${p.id}/reject`, { method: 'POST' }), productPlacements.refetch)
          }
        >
          Reject
        </button>
      </li>
    ))}
  </ul>
</section>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=lhr-office -- Approvals`
Expected: PASS (all existing Approvals tests plus the 2 new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/client/src/lib/types.ts apps/lhr-office/client/src/pages/Approvals.tsx apps/lhr-office/client/src/pages/Approvals.test.tsx
git commit -m "feat(office): add product placements section to the Approvals page"
```

---

## Self-Review Notes

- **Spec coverage:** Job registration (dormant) → Task 9's docstring + Global Constraints; job body → Tasks 4–9; data model → Task 1; `callLLM` overload → Task 5; image editing → Task 6; review UI (ops/route/server/client) → Tasks 10–13; testing approach (module-mock job logic, DI-style ops+route, client mocks) → reflected in every task's test style. No spec section is without a task.
- **Placeholder scan:** every step above contains complete code, not a description; no "add appropriate tests" steps remain.
- **Type consistency check:** `ProductPlacementProposal`/`NewProductPlacementProposal` (Task 1) → consumed identically in Tasks 8, 9, 11; `ImageEditProvider` (Task 6) → consumed identically in Task 9; `ProductPlacementOps`/`ApprovedProductPlacement`/`RejectedProductPlacement` (Tasks 10–11) → consumed identically in Tasks 11–12; `createApp`'s new trailing parameter name (`productPlacements`) is consistent between Task 12's signature and its test calls.
- **Corrected from the superseded 2026-08-25 plan:** the old `matchProductsToRecipes` returned `{cycleId, proposalsCreated}` and took an injected `deps` object — neither matches the `Job = () => Promise<JobResult>` contract this codebase's orchestrator actually requires. Task 9 fixes both: zero-arg, `JobResult`-returning, module-mocked.
