# Affiliate Sourcing Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standing weekly pipeline that sources ~20 candidate Amazon products from Keepa, scores them against a learned approve/deny preference model, and presents them on a password-protected review page where approving a candidate immediately commits a new `src/content/affiliate-links` entry to `main` and denying just records the decision.

**Architecture:** Two components split by where they run. A local, cron-invoked script (`mcp-server/scripts/source-affiliate-candidates.ts`) queries Keepa for trending products in seeded categories, filters out ASINs already known, scores and ranks the rest against `decision_history` (reserving ~20% unweighted "wildcard" slots), looks up each candidate's commission rate from a static rate-card, and writes the cycle to a shared Postgres database (Neon). A deployed review UI — a route inside the shared internal `lhr-office` Vercel app (see Global Constraints on hosting) — reads pending candidates from the same database; approving one builds and commits an `affiliate-links/*.json` file via the existing GitHub-as-database commit helper (now extracted to `@lhr/github` so both the local script and the deployed app can use it) and records the decision; denying only records the decision. A new shared `@lhr/db` package holds the Postgres schema/queries, the pure scoring function, and the pure "build an affiliate-link file from a candidate" function, so sourcing-side and review-side code never duplicate this logic.

**Tech Stack:** TypeScript (strict), Zod, `pg` (node-postgres, talking to Neon Postgres via `DATABASE_URL`), `@octokit/rest` (via new `@lhr/github` package), native `fetch` (Keepa HTTP calls — no new HTTP client dependency), Astro with `output: 'server'` + `@astrojs/vercel` adapter (review UI), Vitest (all new tests), `tsx` (script/CLI runners, matching existing `backfill:ingredient-links` convention).

**Spec:** [docs/superpowers/specs/active/2026-08-24-affiliate-sourcing-agent-design.md](../../../../.claude/worktrees/recipe-affiliate-agent-system-bd11aa/docs/superpowers/specs/active/2026-08-24-affiliate-sourcing-agent-design.md) *(this spec currently lives in a sibling worktree, branch `claude/recipe-affiliate-agent-system-bd11aa`, commit `d126642`; a full copy of every section this plan implements is quoted or paraphrased below so no separate lookup is required to execute this plan)*

## Global Constraints

- **Hosting supersedes spec §3.** The spec's §3 calls for a standalone `lhr-affiliate-review` Vercel project. On 2026-08-24, while this plan was being written, a sibling session (working on the not-yet-written trends-watcher spec) reported that the site author wants **one shared internal hub app** (`apps/lhr-office`) hosting all internal tools, not one project per tool. This was confirmed directly with the author. Every task below builds against `apps/lhr-office` accordingly — treat this as replacing spec §3, not spec §3 itself.
- **Access control supersedes both spec §3 and this plan's own earlier Deployment Protection assumption.** Also on 2026-08-24, confirmed directly with the author: `apps/lhr-office` will NOT be gated by Vercel Deployment Protection at all — it's being replaced by real username/password admin accounts (a `requireAdminSession()` helper, `office_admins`/`office_sessions` tables), owned by the same not-yet-committed trends-watcher spec. That interface isn't available to read yet. Rather than inventing a competing auth system or blocking this plan indefinitely on unwritten sibling code, Task 13 adds a deliberately minimal, fail-closed placeholder (`apps/lhr-office/src/lib/auth.ts`'s `requireSession()`, which unconditionally denies) that every route this plan adds calls first. This keeps the interim deployed state safe (nothing is ever reachable) without duplicating or guessing at the real auth system's shape. Swapping the stub for the real import once it lands is a follow-up, out of this plan's scope.
- No affiliate network besides Amazon Associates, and no Product Advertising API — Keepa is the only external product-data source this phase (spec §1).
- Commission and sales-volume figures are estimates (public rate-card lookup + Keepa's popularity proxy), never real personal earnings data, and must be visibly labeled as estimates everywhere they're shown (spec §1).
- Approving a candidate immediately creates a real `affiliate-links` entry; denying only records the decision. Neither action blocks on the other (spec §1, §2).
- Of each cycle's ~20 slots, ~20% are reserved as unweighted "wildcards" pulled straight from the raw trending list, never touched by the preference-weighted score — this is what keeps the system from ossifying onto only past approvals, and is also what makes the cold-start (empty history) case converge to pure popularity ranking (spec §5).
- A Keepa API failure or rate-limit hit must exit the cycle without writing any candidates — never ship a partial or garbage list (spec §7).
- A candidate whose ASIN is already in `affiliate-links` or already decided (approved or denied) in `decision_history` must never be re-queued (spec §7).
- A category with no rate-card entry falls back to a default rate with `commission_rate_is_fallback` set, and the UI must visibly flag it as a rough estimate (spec §7).
- If an approval's Postgres write succeeds but its GitHub commit fails, the candidate stays `status='approved'` with no file; the next cron run must detect and retry it rather than silently losing it (spec §7).
- All new Postgres-touching functions take an explicit `Pool` (or `GitHubClient`) as their first parameter rather than reaching for a module-level singleton — this mirrors the existing `mcp-server/src/github.ts` dependency-injection style and is what makes every new module mockable in tests exactly like the rest of this codebase.
- External API details this plan could not fully verify at planning time (Keepa's exact CSV field indices, and Amazon's real category-node IDs / current published commission rates) are called out explicitly at their task with a concrete verification step — never silently hard-coded as fact.

---

### Task 1: Extract `@lhr/github` from `mcp-server/src/github.ts`

The review app (a separate npm workspace under `apps/lhr-office`) needs the same `createGitHubClient` / `commitFilesToMain` / `listFiles` helpers mcp-server already has, in order to commit an approved candidate's `affiliate-links` file. Rather than duplicating ~120 lines of GitHub-as-database logic in two places, extract it into a new shared workspace package, `@lhr/db`'s sibling `@lhr/github`, then make `mcp-server/src/github.ts` a one-line re-export. This keeps every one of the 30 existing files across mcp-server that import `../github`/`./github` (source and, critically, `vi.mock('../../src/github', ...)` test mocks) working completely unchanged — the module path they import from doesn't move, only what backs it.

**Files:**
- Create: `packages/github/package.json`
- Create: `packages/github/tsconfig.json`
- Create: `packages/github/src/index.ts` (move from `mcp-server/src/github.ts`, content unchanged)
- Create: `packages/github/tests/github.test.ts` (move from `mcp-server/tests/github.test.ts`, only the import path changes)
- Modify: `mcp-server/src/github.ts` (replace full content with a re-export)
- Modify: `mcp-server/package.json` (add `@lhr/github` dependency, remove now-unused `@octokit/rest`)
- Delete: `mcp-server/tests/github.test.ts` (superseded by the moved copy)
- Modify: `package.json` (root — add `packages/github` to `workspaces`, add its build to `postinstall`)

**Interfaces:**
- Produces: `@lhr/github` exporting everything `mcp-server/src/github.ts` exported before this task — `createGitHubClient(token): GitHubClient`, `GitHubClient`, `FileWrite`, `getFile`, `listFiles`, `createBranch`, `listBranches`, `deleteBranch`, `putFile`, `commitFilesToMain(client, files, message): Promise<string>`. Consumed by Task 11 (`reconcileApprovedCandidates.ts`) and Tasks 15–16 (the review app's approve/deny routes).

- [ ] **Step 1: Create the `@lhr/github` package**

`packages/github/package.json`:

```json
{
  "name": "@lhr/github",
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
    "@octokit/rest": "^21.1.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/github/tsconfig.json`:

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

- [ ] **Step 2: Move the implementation verbatim**

Copy the entire current content of `mcp-server/src/github.ts` into a new `packages/github/src/index.ts`, unchanged. (Read `mcp-server/src/github.ts` first — it currently exports `REPO_OWNER`/`REPO_NAME` constants, `GitHubClient`, `FileWrite`, `createGitHubClient`, `getFile`, `listFiles`, `createBranch`, `listBranches`, `deleteBranch`, `putFile`, `commitFilesToMain`. Every line moves as-is.)

- [ ] **Step 3: Move the existing test file**

Copy `mcp-server/tests/github.test.ts` to `packages/github/tests/github.test.ts`, changing only the import line:

```ts
const { createGitHubClient, getFile, listFiles, createBranch, listBranches, deleteBranch, putFile, commitFilesToMain } =
  await import('../src/index');
```

(was `await import('../src/github')` — everything else in the file, including the `vi.mock('@octokit/rest', ...)` block, is unchanged.)

- [ ] **Step 4: Add a vitest config for the new package**

`packages/github/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Run the moved test in place**

Run: `cd packages/github && npx vitest run`
Expected: FAIL — `@octokit/rest` and `vitest`/`typescript` aren't installed for this new workspace yet.

- [ ] **Step 6: Wire the new workspace into the root**

In root `package.json`, update `workspaces` and `postinstall`:

```json
{
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/github"
  ],
  "scripts": {
    "postinstall": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/github",
```

(keep the rest of `package.json` unchanged). Then from the repo root run:

```bash
npm install
```

Expected: installs `packages/github`'s dependencies and hoists `@octokit/rest`/`typescript`/`vitest` into the workspace's `node_modules`; `postinstall` builds `@lhr/schemas` then `@lhr/github`, producing `packages/github/dist/index.js` and `.d.ts`.

- [ ] **Step 7: Run the moved test again to verify it passes**

Run: `cd packages/github && npx vitest run`
Expected: PASS — all cases from the original `github.test.ts` pass unchanged.

- [ ] **Step 8: Replace `mcp-server/src/github.ts` with a re-export shim**

Replace the entire content of `mcp-server/src/github.ts` with:

```ts
export * from '@lhr/github';
```

- [ ] **Step 9: Delete the now-superseded test copy**

```bash
rm mcp-server/tests/github.test.ts
```

- [ ] **Step 10: Point mcp-server at the new package and drop the now-unused direct dependency**

In `mcp-server/package.json`, remove `"@octokit/rest": "^21.1.0"` from `dependencies` and add:

```json
    "@lhr/github": "*",
```

Then from the repo root:

```bash
npm install
```

- [ ] **Step 11: Run the full mcp-server test suite to confirm nothing broke**

Run: `cd mcp-server && npx vitest run`
Expected: PASS — every one of the ~30 files that imports `../github`/`./github` or does `vi.mock('../../src/github', ...)` still resolves correctly, because the module path they reference (`mcp-server/src/github.ts`) still exists; it just re-exports `@lhr/github` now.

- [ ] **Step 12: Commit**

```bash
git add packages/github mcp-server/src/github.ts mcp-server/package.json mcp-server/tests/github.test.ts package.json package-lock.json
git commit -m "Extract GitHub-as-database helper into shared @lhr/github package"
```

---

### Task 2: `@lhr/db` package scaffold, schema, and migration

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/scripts/migrate.ts`
- Create: `packages/db/tests/migrate.test.ts`
- Modify: `package.json` (root — add `packages/db` to `workspaces` and `postinstall`)
- Modify: `.env.example` (add `DATABASE_URL`)

**Interfaces:**
- Produces: `runMigrations(pool: Pool): Promise<void>` from `packages/db/src/migrate.ts`, and the `candidates`/`decision_history` table definitions. Consumed by every later `@lhr/db` task (3–6) and by the `db:migrate` CLI script operators run once against a fresh Neon database.

- [ ] **Step 1: Scaffold the package**

`packages/db/package.json`:

```json
{
  "name": "@lhr/db",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "db:migrate": "tsx scripts/migrate.ts"
  },
  "dependencies": {
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@lhr/schemas": "*",
    "@types/pg": "^8.11.0",
    "tsx": "^4.23.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/db/tsconfig.json` (identical shape to `packages/github/tsconfig.json`):

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

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 2: Write the failing migration test**

`packages/db/tests/migrate.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/migrate';

describe('runMigrations', () => {
  it('creates the candidates table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS candidates'))).toBe(true);
  });

  it('creates the decision_history table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS decision_history'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/db && npx vitest run`
Expected: FAIL — `../src/migrate` does not exist yet.

- [ ] **Step 4: Write the schema and migration**

`packages/db/src/schema.ts`:

```ts
export const CANDIDATES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  product_url TEXT NOT NULL,
  commission_rate NUMERIC NOT NULL,
  commission_rate_is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_monthly_sales INTEGER,
  bsr INTEGER,
  bsr_category TEXT,
  rating NUMERIC,
  review_count INTEGER,
  score NUMERIC NOT NULL,
  is_wildcard BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const DECISION_HISTORY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS decision_history (
  id SERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  commission_rate NUMERIC NOT NULL,
  estimated_monthly_sales INTEGER,
  decision TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
```

`packages/db/src/migrate.ts`:

```ts
import type { Pool } from 'pg';
import { CANDIDATES_TABLE_SQL, DECISION_HISTORY_TABLE_SQL } from './schema.js';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(CANDIDATES_TABLE_SQL);
  await pool.query(DECISION_HISTORY_TABLE_SQL);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/db && npx vitest run`
Expected: PASS

- [ ] **Step 6: Add the CLI migration runner**

`packages/db/scripts/migrate.ts`:

```ts
import { Pool } from 'pg';
import { runMigrations } from '../src/migrate.js';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL env var is required.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  await runMigrations(pool);
  console.log('Migrations applied.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Wire the workspace into the root and add the env var**

In root `package.json`:

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/github",
    "packages/db"
  ],
  "scripts": {
    "postinstall": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/github && npm run build --workspace=@lhr/db",
```

In `.env.example`, append:

```
DATABASE_URL=
```

Then from the repo root:

```bash
npm install
```

- [ ] **Step 8: Commit**

```bash
git add packages/db package.json package-lock.json .env.example
git commit -m "Add @lhr/db package with Postgres schema and migration runner"
```

---

### Task 3: `@lhr/db` candidates CRUD

**Files:**
- Create: `packages/db/src/candidates.ts`
- Create: `packages/db/tests/candidates.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `pg`'s `Pool` type only).
- Produces: `Candidate`, `NewCandidate` types; `insertCandidates(pool, candidates: NewCandidate[]): Promise<void>`; `getPendingCandidates(pool, cycleId: string): Promise<Candidate[]>`; `getLatestPendingCycleId(pool): Promise<string | null>`; `getCandidateById(pool, id: number): Promise<Candidate | null>`; `markCandidateStatus(pool, id: number, status: 'approved' | 'denied'): Promise<void>`; `getApprovedCandidates(pool): Promise<Candidate[]>`. Consumed by Task 12 (sourcing script), Task 11 (reconciliation), and Tasks 14–16 (review app).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/candidates.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertCandidates,
  getPendingCandidates,
  getLatestPendingCycleId,
  getCandidateById,
  markCandidateStatus,
  getApprovedCandidates,
  type NewCandidate,
} from '../src/candidates';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const baseCandidate: NewCandidate = {
  cycleId: '2026-W35',
  asin: 'B0EXAMPLE1',
  title: 'Ceramic Mixing Bowl Set',
  category: 'Kitchen',
  priceCents: 2999,
  imageUrl: 'https://example.com/bowl.jpg',
  productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03,
  commissionRateIsFallback: false,
  estimatedMonthlySales: 450,
  bsr: 1200,
  bsrCategory: 'Kitchen',
  rating: 4.6,
  reviewCount: 812,
  score: 0.71,
  isWildcard: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCandidates', () => {
  it('issues one insert query per candidate', async () => {
    const pool = mockPool();
    await insertCandidates(pool as never, [baseCandidate, { ...baseCandidate, asin: 'B0EXAMPLE2' }]);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO candidates');
    expect(pool.query.mock.calls[0][1]).toEqual([
      '2026-W35', 'B0EXAMPLE1', 'Ceramic Mixing Bowl Set', 'Kitchen', 2999,
      'https://example.com/bowl.jpg', 'https://www.amazon.com/dp/B0EXAMPLE1',
      0.03, false, 450, 1200, 'Kitchen', 4.6, 812, 0.71, false,
    ]);
  });
});

describe('getPendingCandidates', () => {
  it('queries by cycle_id and pending status, mapping snake_case rows to camelCase', async () => {
    const row = {
      id: 1, cycle_id: '2026-W35', asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set', category: 'Kitchen',
      price_cents: 2999, image_url: 'https://example.com/bowl.jpg', product_url: 'https://www.amazon.com/dp/B0EXAMPLE1',
      commission_rate: '0.03', commission_rate_is_fallback: false, estimated_monthly_sales: 450,
      bsr: 1200, bsr_category: 'Kitchen', rating: '4.6', review_count: 812, score: '0.71', is_wildcard: false,
      status: 'pending', decided_at: null, created_at: new Date('2026-08-24T00:00:00Z'),
    };
    const pool = mockPool([row]);
    const result = await getPendingCandidates(pool as never, '2026-W35');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"), ['2026-W35']);
    expect(result).toEqual([{
      id: 1, cycleId: '2026-W35', asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set', category: 'Kitchen',
      priceCents: 2999, imageUrl: 'https://example.com/bowl.jpg', productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
      commissionRate: 0.03, commissionRateIsFallback: false, estimatedMonthlySales: 450,
      bsr: 1200, bsrCategory: 'Kitchen', rating: 4.6, reviewCount: 812, score: 0.71, isWildcard: false,
      status: 'pending', decidedAt: null, createdAt: new Date('2026-08-24T00:00:00Z'),
    }]);
  });
});

describe('getLatestPendingCycleId', () => {
  it('returns the most recent cycle_id with pending candidates', async () => {
    const pool = mockPool([{ cycle_id: '2026-W35' }]);
    const result = await getLatestPendingCycleId(pool as never);
    expect(result).toBe('2026-W35');
  });

  it('returns null when there are no pending candidates', async () => {
    const pool = mockPool([]);
    const result = await getLatestPendingCycleId(pool as never);
    expect(result).toBeNull();
  });
});

describe('getCandidateById', () => {
  it('returns null when no row matches', async () => {
    const pool = mockPool([]);
    const result = await getCandidateById(pool as never, 999);
    expect(result).toBeNull();
  });
});

describe('markCandidateStatus', () => {
  it('updates status and decided_at', async () => {
    const pool = mockPool();
    await markCandidateStatus(pool as never, 1, 'approved');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE candidates SET status'), ['approved', 1]);
  });
});

describe('getApprovedCandidates', () => {
  it('queries for approved status only', async () => {
    const pool = mockPool([]);
    await getApprovedCandidates(pool as never);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'approved'"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run tests/candidates.test.ts`
Expected: FAIL — `../src/candidates` does not exist yet.

- [ ] **Step 3: Implement**

`packages/db/src/candidates.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export interface Candidate {
  id: number;
  cycleId: string;
  asin: string;
  title: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  productUrl: string;
  commissionRate: number;
  commissionRateIsFallback: boolean;
  estimatedMonthlySales: number | null;
  bsr: number | null;
  bsrCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  score: number;
  isWildcard: boolean;
  status: 'pending' | 'approved' | 'denied';
  decidedAt: Date | null;
  createdAt: Date;
}

export interface NewCandidate {
  cycleId: string;
  asin: string;
  title: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  productUrl: string;
  commissionRate: number;
  commissionRateIsFallback: boolean;
  estimatedMonthlySales: number | null;
  bsr: number | null;
  bsrCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  score: number;
  isWildcard: boolean;
}

interface CandidateRow {
  id: number;
  cycle_id: string;
  asin: string;
  title: string;
  category: string;
  price_cents: number;
  image_url: string;
  product_url: string;
  commission_rate: string;
  commission_rate_is_fallback: boolean;
  estimated_monthly_sales: number | null;
  bsr: number | null;
  bsr_category: string | null;
  rating: string | null;
  review_count: number | null;
  score: string;
  is_wildcard: boolean;
  status: 'pending' | 'approved' | 'denied';
  decided_at: Date | null;
  created_at: Date;
}

function rowToCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    asin: row.asin,
    title: row.title,
    category: row.category,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    commissionRate: Number(row.commission_rate),
    commissionRateIsFallback: row.commission_rate_is_fallback,
    estimatedMonthlySales: row.estimated_monthly_sales,
    bsr: row.bsr,
    bsrCategory: row.bsr_category,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: row.review_count,
    score: Number(row.score),
    isWildcard: row.is_wildcard,
    status: row.status,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function insertCandidates(pool: Pool, candidates: NewCandidate[]): Promise<void> {
  for (const c of candidates) {
    await pool.query(
      `INSERT INTO candidates
        (cycle_id, asin, title, category, price_cents, image_url, product_url,
         commission_rate, commission_rate_is_fallback, estimated_monthly_sales,
         bsr, bsr_category, rating, review_count, score, is_wildcard)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        c.cycleId, c.asin, c.title, c.category, c.priceCents, c.imageUrl, c.productUrl,
        c.commissionRate, c.commissionRateIsFallback, c.estimatedMonthlySales,
        c.bsr, c.bsrCategory, c.rating, c.reviewCount, c.score, c.isWildcard,
      ],
    );
  }
}

export async function getPendingCandidates(pool: Pool, cycleId: string): Promise<Candidate[]> {
  const res = (await pool.query(
    `SELECT * FROM candidates WHERE cycle_id = $1 AND status = 'pending' ORDER BY score DESC`,
    [cycleId],
  )) as QueryResult<CandidateRow>;
  return res.rows.map(rowToCandidate);
}

export async function getLatestPendingCycleId(pool: Pool): Promise<string | null> {
  const res = (await pool.query(
    `SELECT DISTINCT cycle_id FROM candidates WHERE status = 'pending' ORDER BY cycle_id DESC LIMIT 1`,
  )) as QueryResult<{ cycle_id: string }>;
  return res.rows[0]?.cycle_id ?? null;
}

export async function getCandidateById(pool: Pool, id: number): Promise<Candidate | null> {
  const res = (await pool.query(`SELECT * FROM candidates WHERE id = $1`, [id])) as QueryResult<CandidateRow>;
  return res.rows[0] ? rowToCandidate(res.rows[0]) : null;
}

export async function markCandidateStatus(pool: Pool, id: number, status: 'approved' | 'denied'): Promise<void> {
  await pool.query(`UPDATE candidates SET status = $1, decided_at = now() WHERE id = $2`, [status, id]);
}

export async function getApprovedCandidates(pool: Pool): Promise<Candidate[]> {
  const res = (await pool.query(
    `SELECT * FROM candidates WHERE status = 'approved' ORDER BY decided_at ASC`,
  )) as QueryResult<CandidateRow>;
  return res.rows.map(rowToCandidate);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run tests/candidates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/candidates.ts packages/db/tests/candidates.test.ts
git commit -m "Add candidates table CRUD to @lhr/db"
```

---

### Task 4: `@lhr/db` decision history

**Files:**
- Create: `packages/db/src/decisionHistory.ts`
- Create: `packages/db/tests/decisionHistory.test.ts`

**Interfaces:**
- Produces: `DecisionHistoryRecord` type; `insertDecisionHistory(pool, record): Promise<void>`; `getAllDecisionHistory(pool): Promise<DecisionHistoryRecord[]>`; `getDecidedAsins(pool): Promise<Set<string>>`. Consumed by Task 8 (existing-ASIN filtering), Task 12 (sourcing script scoring input), and Tasks 15–16 (review app decision recording).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/decisionHistory.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertDecisionHistory, getAllDecisionHistory, getDecidedAsins } from '../src/decisionHistory';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertDecisionHistory', () => {
  it('inserts a decision row with the given fields', async () => {
    const pool = mockPool();
    await insertDecisionHistory(pool as never, {
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999,
      commissionRate: 0.03, estimatedMonthlySales: 450, decision: 'approved',
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO decision_history'),
      ['B0EXAMPLE1', 'Kitchen', 2999, 0.03, 450, 'approved'],
    );
  });
});

describe('getAllDecisionHistory', () => {
  it('maps snake_case rows to camelCase records', async () => {
    const pool = mockPool([{
      asin: 'B0EXAMPLE1', category: 'Kitchen', price_cents: 2999, commission_rate: '0.03',
      estimated_monthly_sales: 450, decision: 'approved', decided_at: new Date('2026-08-01T00:00:00Z'),
    }]);
    const result = await getAllDecisionHistory(pool as never);
    expect(result).toEqual([{
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999, commissionRate: 0.03,
      estimatedMonthlySales: 450, decision: 'approved', decidedAt: new Date('2026-08-01T00:00:00Z'),
    }]);
  });
});

describe('getDecidedAsins', () => {
  it('returns a set of distinct ASINs', async () => {
    const pool = mockPool([{ asin: 'B0EXAMPLE1' }, { asin: 'B0EXAMPLE2' }]);
    const result = await getDecidedAsins(pool as never);
    expect(result).toEqual(new Set(['B0EXAMPLE1', 'B0EXAMPLE2']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run tests/decisionHistory.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement**

`packages/db/src/decisionHistory.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export interface DecisionHistoryRecord {
  asin: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  estimatedMonthlySales: number | null;
  decision: 'approved' | 'denied';
  decidedAt: Date;
}

export interface NewDecisionHistoryRecord {
  asin: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  estimatedMonthlySales: number | null;
  decision: 'approved' | 'denied';
}

interface DecisionHistoryRow {
  asin: string;
  category: string;
  price_cents: number;
  commission_rate: string;
  estimated_monthly_sales: number | null;
  decision: 'approved' | 'denied';
  decided_at: Date;
}

export async function insertDecisionHistory(pool: Pool, record: NewDecisionHistoryRecord): Promise<void> {
  await pool.query(
    `INSERT INTO decision_history (asin, category, price_cents, commission_rate, estimated_monthly_sales, decision)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [record.asin, record.category, record.priceCents, record.commissionRate, record.estimatedMonthlySales, record.decision],
  );
}

export async function getAllDecisionHistory(pool: Pool): Promise<DecisionHistoryRecord[]> {
  const res = (await pool.query(
    `SELECT asin, category, price_cents, commission_rate, estimated_monthly_sales, decision, decided_at FROM decision_history`,
  )) as QueryResult<DecisionHistoryRow>;
  return res.rows.map((row) => ({
    asin: row.asin,
    category: row.category,
    priceCents: row.price_cents,
    commissionRate: Number(row.commission_rate),
    estimatedMonthlySales: row.estimated_monthly_sales,
    decision: row.decision,
    decidedAt: row.decided_at,
  }));
}

export async function getDecidedAsins(pool: Pool): Promise<Set<string>> {
  const res = (await pool.query(`SELECT DISTINCT asin FROM decision_history`)) as QueryResult<{ asin: string }>;
  return new Set(res.rows.map((r) => r.asin));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run tests/decisionHistory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/decisionHistory.ts packages/db/tests/decisionHistory.test.ts
git commit -m "Add decision_history CRUD to @lhr/db"
```

---

### Task 5: `@lhr/db` scoring — bucketed approve rates, wildcard reservation, cold start

This is the "transparent, inspectable scoring function" from spec §5. It operates entirely on in-memory data (a candidate pool + a decision-history fixture) so it's fully unit-testable without a database.

**Files:**
- Create: `packages/db/src/scoring.ts`
- Create: `packages/db/tests/scoring.test.ts`

**Interfaces:**
- Consumes: `DecisionHistoryRecord`-shaped objects (from Task 4) for history input.
- Produces: `ScoringCandidate`, `ScoredCandidate` types; `priceBand`, `commissionBand`, `popularityScore`, `computeBucketApproveRates`, `scoreCandidate`, `selectCycle(candidates, history, slots?, wildcardFraction?): ScoredCandidate[]`. Consumed by Task 12 (sourcing script).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectCycle, computeBucketApproveRates, popularityScore, type DecisionRecord, type ScoringCandidate } from '../src/scoring';

function candidate(overrides: Partial<ScoringCandidate> & { asin: string }): ScoringCandidate {
  return {
    category: 'Kitchen',
    priceCents: 2000,
    commissionRate: 0.03,
    estimatedMonthlySales: 100,
    rating: 4.0,
    ...overrides,
  };
}

describe('computeBucketApproveRates', () => {
  it('computes approve rate per category/price-band/commission-band bucket', () => {
    const history: DecisionRecord[] = [
      { category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' },
      { category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' },
      { category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'denied' },
      { category: 'Grocery', priceCents: 2000, commissionRate: 0.01, decision: 'denied' },
    ];
    const rates = computeBucketApproveRates(history);
    expect(rates.get('Kitchen|15-40|mid')).toBeCloseTo(2 / 3);
    expect(rates.get('Grocery|15-40|low')).toBe(0);
  });
});

describe('selectCycle bucketed weighting', () => {
  it('ranks a candidate from a historically well-approved bucket above an identically popular one from a poorly-approved bucket', () => {
    const history: DecisionRecord[] = [
      ...Array(8).fill({ category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'approved' }),
      ...Array(2).fill({ category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'denied' }),
      ...Array(1).fill({ category: 'Electronics', priceCents: 2000, commissionRate: 0.01, decision: 'approved' }),
      ...Array(9).fill({ category: 'Electronics', priceCents: 2000, commissionRate: 0.01, decision: 'denied' }),
    ];
    const candidates = [
      candidate({ asin: 'GOOD-BUCKET', category: 'Kitchen', commissionRate: 0.03 }),
      candidate({ asin: 'BAD-BUCKET', category: 'Electronics', commissionRate: 0.01 }),
    ];
    const [selected] = selectCycle(candidates, history, 1, 0);
    expect(selected.asin).toBe('GOOD-BUCKET');
  });
});

describe('selectCycle wildcard reservation', () => {
  it('reserves ~20% of slots as unweighted wildcards not selected by score', () => {
    const history: DecisionRecord[] = Array(20).fill({ category: 'Kitchen', priceCents: 2000, commissionRate: 0.03, decision: 'denied' });
    const candidates: ScoringCandidate[] = [
      // One clearly popular-but-denied-bucket candidate that would never win on score alone.
      candidate({ asin: 'POPULAR-BUT-LOW-SCORE', category: 'Kitchen', estimatedMonthlySales: 5000, rating: 5 }),
      // 19 filler candidates in a neutral (no history) bucket, all with zero popularity.
      ...Array.from({ length: 19 }, (_, i) => candidate({ asin: `FILLER-${i}`, category: 'Grocery', estimatedMonthlySales: 0, rating: null })),
    ];
    const selected = selectCycle(candidates, history, 20, 0.2);
    expect(selected).toHaveLength(20);
    const wildcards = selected.filter((c) => c.isWildcard);
    expect(wildcards).toHaveLength(4);
    // The popular candidate lost on score (denied-bucket) but should still surface as a wildcard.
    expect(selected.some((c) => c.asin === 'POPULAR-BUT-LOW-SCORE' && c.isWildcard)).toBe(true);
  });
});

describe('selectCycle cold start', () => {
  it('converges to pure popularity ranking when decision_history is empty', () => {
    const candidates: ScoringCandidate[] = [
      candidate({ asin: 'LOW', estimatedMonthlySales: 10, rating: 3 }),
      candidate({ asin: 'HIGH', estimatedMonthlySales: 9000, rating: 4.8 }),
      candidate({ asin: 'MID', estimatedMonthlySales: 500, rating: 4.0 }),
    ];
    const selected = selectCycle(candidates, [], 3, 0.2);
    const byPopularity = [...candidates].sort((a, b) => popularityScore(b) - popularityScore(a)).map((c) => c.asin);
    expect(selected.map((c) => c.asin)).toEqual(byPopularity);
  });
});

describe('selectCycle with fewer candidates than slots', () => {
  it('ships every candidate found rather than padding', () => {
    const candidates: ScoringCandidate[] = [
      candidate({ asin: 'ONE' }),
      candidate({ asin: 'TWO' }),
    ];
    const selected = selectCycle(candidates, [], 20, 0.2);
    expect(selected).toHaveLength(2);
  });

  it('returns an empty array for an empty candidate pool', () => {
    expect(selectCycle([], [], 20, 0.2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run tests/scoring.test.ts`
Expected: FAIL — `../src/scoring` does not exist yet.

- [ ] **Step 3: Implement**

`packages/db/src/scoring.ts`:

```ts
export interface DecisionRecord {
  category: string;
  priceCents: number;
  commissionRate: number;
  decision: 'approved' | 'denied';
}

export interface ScoringCandidate {
  asin: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  estimatedMonthlySales: number | null;
  rating: number | null;
}

export interface ScoredCandidate extends ScoringCandidate {
  score: number;
  isWildcard: boolean;
}

export function priceBand(priceCents: number): 'under-15' | '15-40' | '40-plus' {
  if (priceCents < 1500) return 'under-15';
  if (priceCents <= 4000) return '15-40';
  return '40-plus';
}

export function commissionBand(rate: number): 'low' | 'mid' | 'high' {
  if (rate < 0.02) return 'low';
  if (rate < 0.04) return 'mid';
  return 'high';
}

function bucketKey(category: string, priceCents: number, commissionRate: number): string {
  return `${category}|${priceBand(priceCents)}|${commissionBand(commissionRate)}`;
}

export function computeBucketApproveRates(history: DecisionRecord[]): Map<string, number> {
  const counts = new Map<string, { approved: number; total: number }>();
  for (const record of history) {
    const key = bucketKey(record.category, record.priceCents, record.commissionRate);
    const entry = counts.get(key) ?? { approved: 0, total: 0 };
    entry.total += 1;
    if (record.decision === 'approved') entry.approved += 1;
    counts.set(key, entry);
  }
  const rates = new Map<string, number>();
  for (const [key, { approved, total }] of counts) rates.set(key, approved / total);
  return rates;
}

const MAX_MONTHLY_SALES_FOR_SCORING = 10_000;
const NEUTRAL_RATING = 3.5;
const NEUTRAL_APPROVE_RATE = 0.5;
const APPROVE_RATE_WEIGHT = 0.6;
const POPULARITY_WEIGHT = 0.4;
const SALES_WEIGHT_WITHIN_POPULARITY = 0.7;
const RATING_WEIGHT_WITHIN_POPULARITY = 0.3;

export function popularityScore(candidate: Pick<ScoringCandidate, 'estimatedMonthlySales' | 'rating'>): number {
  const sales = candidate.estimatedMonthlySales ?? 0;
  const normalizedSales = Math.min(Math.log10(sales + 1) / Math.log10(MAX_MONTHLY_SALES_FOR_SCORING + 1), 1);
  const normalizedRating = (candidate.rating ?? NEUTRAL_RATING) / 5;
  return SALES_WEIGHT_WITHIN_POPULARITY * normalizedSales + RATING_WEIGHT_WITHIN_POPULARITY * normalizedRating;
}

export function scoreCandidate(candidate: ScoringCandidate, bucketRates: Map<string, number>): number {
  const key = bucketKey(candidate.category, candidate.priceCents, candidate.commissionRate);
  const approveRate = bucketRates.get(key) ?? NEUTRAL_APPROVE_RATE;
  return APPROVE_RATE_WEIGHT * approveRate + POPULARITY_WEIGHT * popularityScore(candidate);
}

export function selectCycle(
  candidates: ScoringCandidate[],
  history: DecisionRecord[],
  slots = 20,
  wildcardFraction = 0.2,
): ScoredCandidate[] {
  if (candidates.length === 0) return [];

  const bucketRates = computeBucketApproveRates(history);
  const scored = candidates.map((c) => ({ ...c, score: scoreCandidate(c, bucketRates) }));

  const take = Math.min(slots, scored.length);
  const wildcardCount = Math.round(take * wildcardFraction);
  const rankedCount = take - wildcardCount;

  const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
  const ranked: ScoredCandidate[] = byScoreDesc.slice(0, rankedCount).map((c) => ({ ...c, isWildcard: false }));
  const rankedAsins = new Set(ranked.map((c) => c.asin));

  const byPopularityDesc = [...scored]
    .filter((c) => !rankedAsins.has(c.asin))
    .sort((a, b) => popularityScore(b) - popularityScore(a));
  const wildcards: ScoredCandidate[] = byPopularityDesc.slice(0, wildcardCount).map((c) => ({ ...c, isWildcard: true }));

  return [...ranked, ...wildcards];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run tests/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/scoring.ts packages/db/tests/scoring.test.ts
git commit -m "Add bucketed preference scoring with wildcard reservation to @lhr/db"
```

---

### Task 6: `@lhr/db` — build an `affiliate-links` file from a candidate

**Files:**
- Create: `packages/db/src/affiliateLinkFile.ts`
- Create: `packages/db/tests/affiliateLinkFile.test.ts`

**Interfaces:**
- Consumes: `affiliateLinkSchema` from `@lhr/schemas` (test-only, to prove the generated JSON validates).
- Produces: `AffiliateLinkFileInput`, `slugifyProductTitle(title): string`, `affiliateLinkFilename(candidate): string`, `buildAffiliateLinkFile(candidate, associatesTag): { path: string; content: string }`. Consumed by Task 11 (reconciliation) and Task 15 (approve route).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/affiliateLinkFile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { affiliateLinkSchema } from '@lhr/schemas';
import { buildAffiliateLinkFile, affiliateLinkFilename, slugifyProductTitle } from '../src/affiliateLinkFile';

const candidate = { asin: 'B0EXAMPLE1', title: 'Ceramic Mixing Bowl Set (3-Pack)', imageUrl: 'https://example.com/bowl.jpg' };

describe('slugifyProductTitle', () => {
  it('lowercases and hyphenates, stripping punctuation', () => {
    expect(slugifyProductTitle('Ceramic Mixing Bowl Set (3-Pack)')).toBe('ceramic-mixing-bowl-set-3-pack');
  });
});

describe('affiliateLinkFilename', () => {
  it('combines the slugified title with the last 4 chars of the ASIN', () => {
    expect(affiliateLinkFilename(candidate)).toBe('ceramic-mixing-bowl-set-3-pack-ple1.json');
  });
});

describe('buildAffiliateLinkFile', () => {
  it('builds a schema-valid affiliate-links file under the expected path', () => {
    const file = buildAffiliateLinkFile(candidate, 'lhr-20');
    expect(file.path).toBe('src/content/affiliate-links/ceramic-mixing-bowl-set-3-pack-ple1.json');
    const data = JSON.parse(file.content);
    expect(affiliateLinkSchema.safeParse(data).success).toBe(true);
    expect(data.url).toBe('https://www.amazon.com/dp/B0EXAMPLE1?tag=lhr-20');
    expect(data.label).toBe('Ceramic Mixing Bowl Set (3-Pack)');
    expect(data.image).toBe('https://example.com/bowl.jpg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run tests/affiliateLinkFile.test.ts`
Expected: FAIL — `../src/affiliateLinkFile` does not exist yet.

- [ ] **Step 3: Implement**

`packages/db/src/affiliateLinkFile.ts`:

```ts
export interface AffiliateLinkFileInput {
  asin: string;
  title: string;
  imageUrl: string;
}

export function slugifyProductTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function affiliateLinkFilename(candidate: AffiliateLinkFileInput): string {
  const suffix = candidate.asin.slice(-4).toLowerCase();
  return `${slugifyProductTitle(candidate.title)}-${suffix}.json`;
}

export function buildAffiliateLinkFile(
  candidate: AffiliateLinkFileInput,
  associatesTag: string,
): { path: string; content: string } {
  const url = `https://www.amazon.com/dp/${candidate.asin}?tag=${associatesTag}`;
  const data = {
    label: candidate.title,
    url,
    tag: slugifyProductTitle(candidate.title),
    image: candidate.imageUrl,
    imageAlt: candidate.title,
  };
  return {
    path: `src/content/affiliate-links/${affiliateLinkFilename(candidate)}`,
    content: JSON.stringify(data, null, 2),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run tests/affiliateLinkFile.test.ts`
Expected: PASS

- [ ] **Step 5: Add the `@lhr/db` barrel export and build it**

`packages/db/src/index.ts`:

```ts
export * from './candidates.js';
export * from './decisionHistory.js';
export * from './scoring.js';
export * from './affiliateLinkFile.js';
export * from './migrate.js';
export * from './schema.js';
```

Run: `cd packages/db && npm run build`
Expected: succeeds, producing `packages/db/dist/index.js` and `.d.ts` files re-exporting everything above.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/affiliateLinkFile.ts packages/db/tests/affiliateLinkFile.test.ts packages/db/src/index.ts
git commit -m "Add affiliate-link file builder to @lhr/db and export the package barrel"
```

---

### Task 7: `mcp-server/src/amazonCommissionRates.ts`

**Files:**
- Create: `mcp-server/src/amazonCommissionRates.ts`
- Create: `mcp-server/tests/amazonCommissionRates.test.ts`

**Interfaces:**
- Produces: `CommissionRateResult { rate: number; isFallback: boolean }`, `lookupCommissionRate(category: string): CommissionRateResult`. Consumed by Task 12 (sourcing script) and Task 11 (not directly, but the rates it produces flow into candidate rows read by reconciliation).

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/amazonCommissionRates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lookupCommissionRate } from '../src/amazonCommissionRates';

describe('lookupCommissionRate', () => {
  it('returns the known rate for a listed category, not flagged as fallback', () => {
    expect(lookupCommissionRate('Kitchen')).toEqual({ rate: 0.03, isFallback: false });
    expect(lookupCommissionRate('Grocery')).toEqual({ rate: 0.01, isFallback: false });
  });

  it('returns the default rate flagged as fallback for an unlisted category', () => {
    expect(lookupCommissionRate('Totally Unknown Category')).toEqual({ rate: 0.01, isFallback: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/amazonCommissionRates.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement**

`mcp-server/src/amazonCommissionRates.ts`:

```ts
export interface CommissionRateResult {
  rate: number;
  isFallback: boolean;
}

// Static snapshot of Amazon's published Associates rate card (spec §4). Rates change over
// time — verify against https://affiliate-program.amazon.com/help/operating/schedule before
// relying on these for a real cycle.
const CATEGORY_RATES: Record<string, number> = {
  Kitchen: 0.03,
  Grocery: 0.01,
  Electronics: 0.01,
};

const DEFAULT_RATE = 0.01;

export function lookupCommissionRate(category: string): CommissionRateResult {
  const rate = CATEGORY_RATES[category];
  if (rate === undefined) return { rate: DEFAULT_RATE, isFallback: true };
  return { rate, isFallback: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/amazonCommissionRates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/amazonCommissionRates.ts mcp-server/tests/amazonCommissionRates.test.ts
git commit -m "Add Amazon Associates commission rate-card lookup"
```

---

### Task 8: `mcp-server/src/existingAsins.ts` — exclusion set

Implements spec §7's "candidate already exists ... filtered out before ever reaching the queue." `decision_history` (Task 4) is the authoritative source since it's the only place that stores raw ASINs. As defense in depth, this also best-effort-parses ASINs out of existing `affiliate-links` URLs where they follow the `/dp/<ASIN>/` pattern this system itself produces (Task 6) — pre-existing manually-added links using shortened `amzn.to` URLs can't be parsed this way and are simply not excludable by ASIN; that's a known, acceptable limitation, not a bug to fix here.

**Files:**
- Create: `mcp-server/src/existingAsins.ts`
- Create: `mcp-server/tests/existingAsins.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `readCollection` from `mcp-server/src/catalog.ts` (existing).
- Produces: `extractAsinFromUrl(url: string): string | null`, `getExcludedAsins(client, decidedAsins: Set<string>): Promise<Set<string>>`. Consumed by Task 12 (sourcing script).

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/existingAsins.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const catalogMock = { readCollection: vi.fn() };
vi.mock('../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../src/catalog')>('../src/catalog');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { extractAsinFromUrl, getExcludedAsins } = await import('../src/existingAsins');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractAsinFromUrl', () => {
  it('extracts the ASIN from a /dp/ URL with a trailing slash', () => {
    expect(extractAsinFromUrl('https://www.amazon.com/dp/B0EXAMPLE1/')).toBe('B0EXAMPLE1');
  });

  it('extracts the ASIN from a /dp/ URL with a query string', () => {
    expect(extractAsinFromUrl('https://www.amazon.com/dp/B0EXAMPLE1?tag=lhr-20')).toBe('B0EXAMPLE1');
  });

  it('returns null for a shortened amzn.to URL', () => {
    expect(extractAsinFromUrl('https://amzn.to/3SQybP5')).toBeNull();
  });
});

describe('getExcludedAsins', () => {
  it('merges decided ASINs with ones parsed out of existing affiliate-links URLs', async () => {
    catalogMock.readCollection.mockResolvedValue([
      { id: 'bamboo-skewers-9c2e', data: { url: 'https://amzn.to/3SQybP5' } },
      { id: 'ceramic-mixing-bowls', data: { url: 'https://www.amazon.com/dp/B0EXAMPLE2/' } },
    ]);
    const result = await getExcludedAsins({} as never, new Set(['B0EXAMPLE1']));
    expect(result).toEqual(new Set(['B0EXAMPLE1', 'B0EXAMPLE2']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/existingAsins.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement**

`mcp-server/src/existingAsins.ts`:

```ts
import type { GitHubClient } from './github.js';
import { readCollection } from './catalog.js';

const ASIN_URL_PATTERN = /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/;

export function extractAsinFromUrl(url: string): string | null {
  const match = url.match(ASIN_URL_PATTERN);
  return match ? match[1] : null;
}

export async function getExcludedAsins(client: GitHubClient, decidedAsins: Set<string>): Promise<Set<string>> {
  const excluded = new Set(decidedAsins);
  const affiliateLinks = await readCollection<{ url: string }>(client, 'src/content/affiliate-links');
  for (const entry of affiliateLinks) {
    const asin = extractAsinFromUrl(entry.data.url);
    if (asin) excluded.add(asin);
  }
  return excluded;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/existingAsins.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/existingAsins.ts mcp-server/tests/existingAsins.test.ts
git commit -m "Add ASIN exclusion-set builder combining decision_history and existing affiliate-links"
```

---

### Task 9: `mcp-server/src/computeCycleId.ts`

A pure ISO-week cycle identifier, extracted as its own tiny module so it's independently testable (mirroring how `backfill-ingredient-links.ts` keeps its testable logic in `src/backfillIngredientLinks.ts` rather than inline in the script).

**Files:**
- Create: `mcp-server/src/computeCycleId.ts`
- Create: `mcp-server/tests/computeCycleId.test.ts`

**Interfaces:**
- Produces: `computeCycleId(date: Date): string`, formatted `YYYY-Www` (ISO week). Consumed by Task 12 (sourcing script).

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/computeCycleId.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeCycleId } from '../src/computeCycleId';

describe('computeCycleId', () => {
  it('formats a mid-year Monday as its ISO week', () => {
    expect(computeCycleId(new Date('2026-08-24T12:00:00Z'))).toBe('2026-W35');
  });

  it('formats the first week of January correctly', () => {
    expect(computeCycleId(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });

  it('assigns the last days of December to week 53 when the ISO year rolls over', () => {
    expect(computeCycleId(new Date('2026-12-31T00:00:00Z'))).toBe('2026-W53');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/computeCycleId.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement**

`mcp-server/src/computeCycleId.ts`:

```ts
export function computeCycleId(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/computeCycleId.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/computeCycleId.ts mcp-server/tests/computeCycleId.test.ts
git commit -m "Add ISO-week cycle ID helper"
```

---

### Task 10: `mcp-server/src/keepa.ts`

**Verification note (read before implementing):** Keepa's official API docs (`keepa.com/api-docs`) returned HTTP 403 to automated fetches while writing this plan, so the exact numeric Keepa CSV field indices and Amazon category-node IDs below are the best-documented values found via secondary sources (the `keepaapi` Python client docs and Keepa's public `api_backend` GitHub repo), not confirmed against a live response. **Before trusting this module's output for a real sourcing cycle**, make one real Keepa API call (`GET https://api.keepa.com/product?key=<key>&domain=1&asin=<any well-known ASIN>&stats=180`) and confirm: (a) `csv[1]` is the NEW price series, `csv[3]` is the SALES (BSR) series, `csv[16]` is RATING (×10), `csv[17]` is COUNT_REVIEWS; (b) the `rootCategory`/`categoryTree` shape matches what `parseKeepaProduct` below expects. Adjust the `CSV_*` constants and `parseKeepaProduct` if the live response differs. Do the same for `CATEGORY_SEEDS`' `rootCategoryId` values via `GET https://api.keepa.com/category?key=<key>&domain=1&category=0`.

**Files:**
- Create: `mcp-server/src/keepa.ts`
- Create: `mcp-server/tests/keepa.test.ts`
- Modify: `.env.example` (add `KEEPA_API_KEY`)

**Interfaces:**
- Produces: `CategorySeed`, `CATEGORY_SEEDS`, `KeepaCandidate`, `parseKeepaProduct` (exported for direct testing), `findTrendingCandidates(apiKey: string, seeds?: CategorySeed[]): Promise<KeepaCandidate[]>`. Consumed by Task 12 (sourcing script).

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/keepa.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { findTrendingCandidates, parseKeepaProduct, CATEGORY_SEEDS } from '../src/keepa';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseKeepaProduct', () => {
  it('parses a Keepa product response into a KeepaCandidate', () => {
    const product = {
      asin: 'B0EXAMPLE1',
      title: 'Ceramic Mixing Bowl Set',
      categoryTree: [{ name: 'Kitchen' }],
      images: 'abc123.jpg,def456.jpg',
      monthlySold: 450,
      csv: [
        [], // AMAZON (index 0) — unused
        [123456, 2999], // NEW (index 1)
        [], // USED (index 2) — unused
        [123456, 1200], // SALES / BSR (index 3)
        [], [], [], [], [], [], [], [], [], [], [], [], // indices 4-15 unused
        [123456, 46], // RATING (index 16), stored ×10
        [123456, 812], // COUNT_REVIEWS (index 17)
      ],
    };
    const result = parseKeepaProduct(product);
    expect(result).toEqual({
      asin: 'B0EXAMPLE1',
      title: 'Ceramic Mixing Bowl Set',
      category: 'Kitchen',
      priceCents: 2999,
      imageUrl: 'https://m.media-amazon.com/images/I/abc123.jpg',
      productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
      bsr: 1200,
      bsrCategory: 'Kitchen',
      rating: 4.6,
      reviewCount: 812,
      estimatedMonthlySales: 450,
    });
  });

  it('falls back to null/Uncategorized fields when data is missing', () => {
    const product = { asin: 'B0EXAMPLE2', title: 'Mystery Item', csv: [] };
    const result = parseKeepaProduct(product);
    expect(result.category).toBe('Uncategorized');
    expect(result.priceCents).toBe(0);
    expect(result.bsr).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.estimatedMonthlySales).toBeNull();
    expect(result.imageUrl).toBe('');
  });
});

describe('findTrendingCandidates', () => {
  it('queries the product finder per seed, dedupes ASINs, then fetches product details once', async () => {
    const finderCalls: unknown[] = [];
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlString = url.toString();
      if (urlString.includes('/query')) {
        finderCalls.push(JSON.parse(init!.body as string));
        return { ok: true, json: async () => ({ asinList: ['B0EXAMPLE1', 'B0EXAMPLE2'] }) } as Response;
      }
      if (urlString.includes('/product')) {
        expect(urlString).toContain('asin=B0EXAMPLE1,B0EXAMPLE2');
        return {
          ok: true,
          json: async () => ({
            products: [
              { asin: 'B0EXAMPLE1', title: 'Item One', csv: [] },
              { asin: 'B0EXAMPLE2', title: 'Item Two', csv: [] },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected URL: ${urlString}`);
    }) as unknown as typeof fetch;

    const result = await findTrendingCandidates('test-key', [CATEGORY_SEEDS[0]]);
    expect(finderCalls).toHaveLength(1);
    expect((finderCalls[0] as { selection: { rootCategory: number } }).selection.rootCategory).toBe(CATEGORY_SEEDS[0].rootCategoryId);
    expect(result.map((c) => c.asin)).toEqual(['B0EXAMPLE1', 'B0EXAMPLE2']);
  });

  it('throws when the product finder request fails, so the caller can skip the cycle', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(findTrendingCandidates('test-key', [CATEGORY_SEEDS[0]])).rejects.toThrow('Keepa product finder request failed: 429');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/keepa.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement**

`mcp-server/src/keepa.ts`:

```ts
export interface CategorySeed {
  category: string;
  rootCategoryId: number;
  keywords: string[];
}

// Best-known Amazon US category node IDs — verify via GET https://api.keepa.com/category
// before a real sourcing cycle (see this task's verification note in the plan).
export const CATEGORY_SEEDS: CategorySeed[] = [
  { category: 'Kitchen', rootCategoryId: 284507, keywords: ['kitchen tools', 'cookware', 'bakeware'] },
  { category: 'Grocery', rootCategoryId: 16310211, keywords: ['pantry staples', 'spices', 'condiments'] },
];

export interface KeepaCandidate {
  asin: string;
  title: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  productUrl: string;
  bsr: number | null;
  bsrCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  estimatedMonthlySales: number | null;
}

const KEEPA_DOMAIN_US = 1;
const KEEPA_BASE_URL = 'https://api.keepa.com';

async function findAsinsForSeed(seed: CategorySeed, apiKey: string): Promise<string[]> {
  const selection = {
    rootCategory: seed.rootCategoryId,
    current_SALES_gte: 1,
    sort: [['current_SALES', 'asc']],
    perPage: 50,
    page: 0,
  };
  const res = await fetch(`${KEEPA_BASE_URL}/query?key=${apiKey}&domain=${KEEPA_DOMAIN_US}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection }),
  });
  if (!res.ok) throw new Error(`Keepa product finder request failed: ${res.status}`);
  const data = (await res.json()) as { asinList?: string[] };
  return data.asinList ?? [];
}

interface KeepaProductResponse {
  asin: string;
  title: string;
  categoryTree?: Array<{ name: string }>;
  csv?: Array<number[] | undefined>;
  images?: string;
  monthlySold?: number | null;
}

const CSV_NEW = 1;
const CSV_SALES = 3;
const CSV_RATING = 16;
const CSV_COUNT_REVIEWS = 17;

function latestCsvValue(csv: Array<number[] | undefined> | undefined, index: number): number | null {
  const series = csv?.[index];
  if (!series || series.length < 2) return null;
  const value = series[series.length - 1];
  return value === -1 ? null : value;
}

function buildImageUrl(imagesCsv: string | undefined): string {
  const first = imagesCsv?.split(',')[0];
  return first ? `https://m.media-amazon.com/images/I/${first}` : '';
}

export function parseKeepaProduct(product: KeepaProductResponse): KeepaCandidate {
  const priceCents = latestCsvValue(product.csv, CSV_NEW) ?? 0;
  const bsr = latestCsvValue(product.csv, CSV_SALES);
  const ratingRaw = latestCsvValue(product.csv, CSV_RATING);
  const category = product.categoryTree?.[0]?.name ?? 'Uncategorized';
  return {
    asin: product.asin,
    title: product.title,
    category,
    priceCents,
    imageUrl: buildImageUrl(product.images),
    productUrl: `https://www.amazon.com/dp/${product.asin}`,
    bsr,
    bsrCategory: bsr === null ? null : category,
    rating: ratingRaw === null ? null : ratingRaw / 10,
    reviewCount: latestCsvValue(product.csv, CSV_COUNT_REVIEWS),
    estimatedMonthlySales: product.monthlySold ?? null,
  };
}

async function fetchProductDetails(asins: string[], apiKey: string): Promise<KeepaCandidate[]> {
  if (asins.length === 0) return [];
  const res = await fetch(`${KEEPA_BASE_URL}/product?key=${apiKey}&domain=${KEEPA_DOMAIN_US}&asin=${asins.join(',')}&stats=180`);
  if (!res.ok) throw new Error(`Keepa product request failed: ${res.status}`);
  const data = (await res.json()) as { products?: KeepaProductResponse[] };
  return (data.products ?? []).map(parseKeepaProduct);
}

export async function findTrendingCandidates(apiKey: string, seeds: CategorySeed[] = CATEGORY_SEEDS): Promise<KeepaCandidate[]> {
  const asinLists = await Promise.all(seeds.map((seed) => findAsinsForSeed(seed, apiKey)));
  const uniqueAsins = Array.from(new Set(asinLists.flat()));
  return fetchProductDetails(uniqueAsins, apiKey);
}
```

Note: `bsrCategory` above is set from `category` whenever a BSR value exists (rather than unconditionally), since a null BSR means Keepa has no rank data for this product at all — pairing it with a category name would misleadingly imply rank data exists. Fix the test in Step 1's first case: it expects `bsrCategory: 'Kitchen'` because that fixture has a non-null `bsr` (1200); the second (missing-data) case expects `bsr: null` but doesn't assert `bsrCategory` — add one more assertion there before moving on:

- [ ] **Step 3b: Tighten the fallback test**

In `mcp-server/tests/keepa.test.ts`, in the `'falls back to null/Uncategorized fields when data is missing'` test, add:

```ts
    expect(result.bsrCategory).toBeNull();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/keepa.test.ts`
Expected: PASS

- [ ] **Step 5: Add the env var**

In `.env.example`, append:

```
KEEPA_API_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/keepa.ts mcp-server/tests/keepa.test.ts .env.example
git commit -m "Add Keepa client for trending-candidate sourcing"
```

---

### Task 11: `mcp-server/src/reconcileApprovedCandidates.ts`

Implements spec §7's reconciliation: "the next cron run reconciles by re-attempting the commit for any approved candidate with no matching affiliate-links file yet."

**Files:**
- Create: `mcp-server/src/reconcileApprovedCandidates.ts`
- Create: `mcp-server/tests/reconcileApprovedCandidates.test.ts`
- Modify: `mcp-server/package.json` (add `@lhr/db` dependency)

**Interfaces:**
- Consumes: `GitHubClient`, `listFiles`, `commitFilesToMain` (from `../github.js`, i.e. `@lhr/github` via the Task 1 shim); `getApprovedCandidates`, `affiliateLinkFilename`, `buildAffiliateLinkFile` (from `@lhr/db`).
- Produces: `reconcileApprovedCandidates(client, pool, associatesTag): Promise<{ reconciledAsins: string[] }>`. Consumed by Task 12 (sourcing script).

- [ ] **Step 1: Add the `@lhr/db` dependency**

In `mcp-server/package.json`, add to `dependencies`:

```json
    "@lhr/db": "*",
```

Run: `npm install` from the repo root.

- [ ] **Step 2: Write the failing tests**

`mcp-server/tests/reconcileApprovedCandidates.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github', () => ({
  listFiles: vi.fn(),
  commitFilesToMain: vi.fn(),
}));
vi.mock('@lhr/db', () => ({
  getApprovedCandidates: vi.fn(),
  affiliateLinkFilename: vi.fn((c: { asin: string; title: string }) => `${c.title.toLowerCase().replace(/\s+/g, '-')}-${c.asin.slice(-4).toLowerCase()}.json`),
  buildAffiliateLinkFile: vi.fn((c: { asin: string; title: string }, tag: string) => ({
    path: `src/content/affiliate-links/${c.title.toLowerCase().replace(/\s+/g, '-')}-${c.asin.slice(-4).toLowerCase()}.json`,
    content: JSON.stringify({ label: c.title, url: `https://www.amazon.com/dp/${c.asin}?tag=${tag}` }),
  })),
}));

const { listFiles, commitFilesToMain } = await import('../src/github');
const { getApprovedCandidates } = await import('@lhr/db');
const { reconcileApprovedCandidates } = await import('../src/reconcileApprovedCandidates');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcileApprovedCandidates', () => {
  it('commits a file for an approved candidate missing one, and skips ones that already have a file', async () => {
    vi.mocked(getApprovedCandidates).mockResolvedValue([
      { asin: 'B0MISSING1', title: 'Missing Item' },
      { asin: 'B0PRESENT1', title: 'Present Item' },
    ] as never);
    vi.mocked(listFiles).mockResolvedValue(['present-item-ent1.json']);

    const result = await reconcileApprovedCandidates({} as never, {} as never, 'lhr-20');

    expect(result.reconciledAsins).toEqual(['B0MISSING1']);
    expect(commitFilesToMain).toHaveBeenCalledTimes(1);
    expect(commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/affiliate-links/missing-item-ing1.json', content: expect.any(String) }],
      expect.stringContaining('Missing Item'),
    );
  });

  it('does nothing when there are no approved candidates', async () => {
    vi.mocked(getApprovedCandidates).mockResolvedValue([]);
    const result = await reconcileApprovedCandidates({} as never, {} as never, 'lhr-20');
    expect(result.reconciledAsins).toEqual([]);
    expect(commitFilesToMain).not.toHaveBeenCalled();
  });

  it('does nothing when every approved candidate already has a file', async () => {
    vi.mocked(getApprovedCandidates).mockResolvedValue([{ asin: 'B0PRESENT1', title: 'Present Item' }] as never);
    vi.mocked(listFiles).mockResolvedValue(['present-item-ent1.json']);
    const result = await reconcileApprovedCandidates({} as never, {} as never, 'lhr-20');
    expect(result.reconciledAsins).toEqual([]);
    expect(commitFilesToMain).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mcp-server && npx vitest run tests/reconcileApprovedCandidates.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 4: Implement**

`mcp-server/src/reconcileApprovedCandidates.ts`:

```ts
import type { Pool } from 'pg';
import { listFiles, commitFilesToMain, type GitHubClient } from './github.js';
import { getApprovedCandidates, affiliateLinkFilename, buildAffiliateLinkFile } from '@lhr/db';

export interface ReconcileResult {
  reconciledAsins: string[];
}

export async function reconcileApprovedCandidates(
  client: GitHubClient,
  pool: Pool,
  associatesTag: string,
): Promise<ReconcileResult> {
  const approved = await getApprovedCandidates(pool);
  if (approved.length === 0) return { reconciledAsins: [] };

  const existingFiles = new Set(await listFiles(client, 'src/content/affiliate-links', 'main'));
  const missing = approved.filter((c) => !existingFiles.has(affiliateLinkFilename(c)));
  if (missing.length === 0) return { reconciledAsins: [] };

  for (const candidate of missing) {
    const file = buildAffiliateLinkFile(candidate, associatesTag);
    await commitFilesToMain(client, [file], `Add affiliate link: ${candidate.title}`);
  }
  return { reconciledAsins: missing.map((c) => c.asin) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp-server && npx vitest run tests/reconcileApprovedCandidates.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/reconcileApprovedCandidates.ts mcp-server/tests/reconcileApprovedCandidates.test.ts mcp-server/package.json package-lock.json
git commit -m "Add reconciliation pass for approved candidates missing a committed file"
```

---

### Task 12: `mcp-server/scripts/source-affiliate-candidates.ts` — the weekly cron entrypoint

Wires together every module from Tasks 3–11 into the orchestration spec §2 describes. This script itself isn't unit tested (matching the existing `scripts/backfill-ingredient-links.ts` precedent — its logic is already covered by the unit tests on the modules it calls); this task instead ends with a manual dry-run against a real Neon dev database to confirm the wiring, per spec.

**Files:**
- Create: `mcp-server/scripts/source-affiliate-candidates.ts`
- Modify: `mcp-server/package.json` (add `source:affiliate-candidates` script)
- Modify: `.env.example` (add `AMAZON_ASSOCIATES_TAG`, `AUTHOR_GITHUB_TOKEN` if not already present)

**Interfaces:**
- Consumes: `createGitHubClient` (`./src/github.js`), `findTrendingCandidates` (`./src/keepa.js`), `lookupCommissionRate` (`./src/amazonCommissionRates.js`), `getExcludedAsins` (`./src/existingAsins.js`), `reconcileApprovedCandidates` (`./src/reconcileApprovedCandidates.js`), `computeCycleId` (`./src/computeCycleId.js`), `insertCandidates`, `getDecidedAsins`, `getAllDecisionHistory`, `selectCycle`, `type NewCandidate` (`@lhr/db`).
- Produces: nothing importable — this is a CLI entrypoint (`main()` run on import, matching `scripts/backfill-ingredient-links.ts`).

- [ ] **Step 1: Check `.env.example` for the remaining env vars**

Confirm whether `AUTHOR_GITHUB_TOKEN` already appears in `.env.example` (it's read by `mcp-server/src/server.ts:151` today but, as of this plan, isn't documented there). Append whichever of these two lines are missing:

```
AUTHOR_GITHUB_TOKEN=
AMAZON_ASSOCIATES_TAG=
```

- [ ] **Step 2: Implement the script**

`mcp-server/scripts/source-affiliate-candidates.ts`:

```ts
import { Pool } from 'pg';
import { createGitHubClient } from '../src/github.js';
import { findTrendingCandidates } from '../src/keepa.js';
import { lookupCommissionRate } from '../src/amazonCommissionRates.js';
import { getExcludedAsins } from '../src/existingAsins.js';
import { reconcileApprovedCandidates } from '../src/reconcileApprovedCandidates.js';
import { computeCycleId } from '../src/computeCycleId.js';
import {
  insertCandidates,
  getDecidedAsins,
  getAllDecisionHistory,
  selectCycle,
  type NewCandidate,
} from '@lhr/db';

const CYCLE_SLOTS = 20;

async function main() {
  const keepaApiKey = process.env.KEEPA_API_KEY;
  const githubToken = process.env.AUTHOR_GITHUB_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;
  const associatesTag = process.env.AMAZON_ASSOCIATES_TAG;
  if (!keepaApiKey || !githubToken || !databaseUrl || !associatesTag) {
    console.error('KEEPA_API_KEY, AUTHOR_GITHUB_TOKEN, DATABASE_URL, and AMAZON_ASSOCIATES_TAG env vars are all required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = createGitHubClient(githubToken);

  const reconciled = await reconcileApprovedCandidates(client, pool, associatesTag);
  if (reconciled.reconciledAsins.length > 0) {
    console.log(`Reconciled ${reconciled.reconciledAsins.length} approved candidate(s) missing a file: ${reconciled.reconciledAsins.join(', ')}`);
  }

  let trending;
  try {
    trending = await findTrendingCandidates(keepaApiKey);
  } catch (err) {
    console.error('Keepa request failed; skipping this cycle rather than shipping a partial list.', err);
    await pool.end();
    process.exit(1);
  }

  const decidedAsins = await getDecidedAsins(pool);
  const excludedAsins = await getExcludedAsins(client, decidedAsins);
  const fresh = trending.filter((c) => !excludedAsins.has(c.asin));

  if (fresh.length === 0) {
    console.log('No new candidates found after filtering; nothing to write this cycle.');
    await pool.end();
    return;
  }

  const history = await getAllDecisionHistory(pool);
  const scoringInput = fresh.map((c) => ({
    asin: c.asin,
    category: c.category,
    priceCents: c.priceCents,
    commissionRate: lookupCommissionRate(c.category).rate,
    estimatedMonthlySales: c.estimatedMonthlySales,
    rating: c.rating,
  }));
  const selected = selectCycle(scoringInput, history, CYCLE_SLOTS);

  if (selected.length < CYCLE_SLOTS) {
    console.log(`Only ${selected.length} qualifying candidate(s) found this cycle (target ${CYCLE_SLOTS}); shipping what's found.`);
  }

  const cycleId = computeCycleId(new Date());
  const byAsin = new Map(fresh.map((c) => [c.asin, c]));
  const newCandidates: NewCandidate[] = selected.map((s) => {
    const full = byAsin.get(s.asin)!;
    const { rate, isFallback } = lookupCommissionRate(full.category);
    return {
      cycleId,
      asin: full.asin,
      title: full.title,
      category: full.category,
      priceCents: full.priceCents,
      imageUrl: full.imageUrl,
      productUrl: full.productUrl,
      commissionRate: rate,
      commissionRateIsFallback: isFallback,
      estimatedMonthlySales: full.estimatedMonthlySales,
      bsr: full.bsr,
      bsrCategory: full.bsrCategory,
      rating: full.rating,
      reviewCount: full.reviewCount,
      score: s.score,
      isWildcard: s.isWildcard,
    };
  });

  await insertCandidates(pool, newCandidates);
  console.log(`Wrote ${newCandidates.length} candidate(s) for cycle ${cycleId} (${newCandidates.filter((c) => c.isWildcard).length} wildcard).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Wire the npm script**

In `mcp-server/package.json`, add to `scripts`:

```json
    "source:affiliate-candidates": "tsx scripts/source-affiliate-candidates.ts",
```

- [ ] **Step 4: Typecheck**

Run: `cd mcp-server && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If `scripts/**/*.ts` isn't in `mcp-server/tsconfig.json`'s `include`, add `"scripts/**/*.ts"` to it — check first, since `backfill-ingredient-links.ts` already lives there and presumably already typechecks today.)

- [ ] **Step 5: Manual dry run against a real dev database**

This step needs real credentials the automated test suite can't provide — run it by hand once:

```bash
cd packages/db && npm run db:migrate   # requires DATABASE_URL pointed at a dev Neon database
cd ../../mcp-server && npm run source:affiliate-candidates
```

Expected: logs either "Wrote N candidate(s) for cycle ..." or a clear reason nothing was written (Keepa failure, zero fresh candidates). Confirm via `psql "$DATABASE_URL" -c "SELECT asin, title, status FROM candidates;"` that rows landed as expected.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/scripts/source-affiliate-candidates.ts mcp-server/package.json .env.example mcp-server/tsconfig.json
git commit -m "Add weekly affiliate-candidate sourcing cron script"
```

---

### Task 13: Scaffold (or extend) the shared `apps/lhr-office` app

Per this plan's Global Constraints, the review UI is a route inside a shared internal hub app rather than its own Vercel project. Because a sibling session may be building `apps/lhr-office`'s baseline scaffold concurrently (as part of the not-yet-written trends-watcher plan), this task is written to be safe either way: create the scaffold only if it doesn't already exist, then add this feature's dependencies regardless.

**This task also adds a fail-closed auth placeholder.** `apps/lhr-office` will eventually be gated by real username/password admin accounts (`requireAdminSession()`, owned by the not-yet-committed trends-watcher spec) instead of Vercel Deployment Protection — but that interface doesn't exist anywhere to read yet. Rather than block this plan on it or invent a competing auth system, this task adds a deliberately minimal `requireSession()` that unconditionally denies. Every route Tasks 14–16 add calls it first, so the deployed app is safe (nothing reachable) until a human swaps this stub for the real import later — a one-line change per call site, out of this plan's scope.

**Files:**
- Create (only if missing): `apps/lhr-office/package.json`, `apps/lhr-office/astro.config.mjs`, `apps/lhr-office/tsconfig.json`, `apps/lhr-office/src/pages/index.astro`
- Create: `apps/lhr-office/src/lib/db.ts`
- Create: `apps/lhr-office/src/lib/auth.ts`
- Create: `apps/lhr-office/tests/auth.test.ts`
- Create: `apps/lhr-office/vitest.config.ts`
- Modify: `package.json` (root — add `apps/lhr-office` to `workspaces` if not already present)
- Modify: `vitest.config.ts` (root — exclude `apps/**` from the root test run, matching the existing `mcp-server/**` exclusion)

**Interfaces:**
- Produces: `getPool(): Pool` from `apps/lhr-office/src/lib/db.ts` — a lazily-created, per-warm-instance singleton `Pool`, mirroring the standard Vercel-Functions-plus-Postgres pattern. Consumed by Tasks 14–16.
- Produces: `requireSession(): Promise<never>` and `AuthNotConfiguredError` from `apps/lhr-office/src/lib/auth.ts` — always rejects with `AuthNotConfiguredError`. Consumed by Tasks 14–16, each of which catches it and returns/renders a "not yet available" response rather than letting it surface as an unhandled 500.

- [ ] **Step 1: Check whether `apps/lhr-office` already exists**

```bash
ls apps/lhr-office 2>/dev/null && echo EXISTS || echo MISSING
```

- [ ] **Step 2a: If `MISSING`, scaffold the app**

`apps/lhr-office/package.json`:

```json
{
  "name": "lhr-office",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@astrojs/vercel": "^8.0.0",
    "@lhr/db": "*",
    "@lhr/github": "*",
    "@lhr/schemas": "*",
    "astro": "^5.0.0",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`apps/lhr-office/astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
});
```

`apps/lhr-office/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

`apps/lhr-office/src/pages/index.astro`:

```astro
---
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>LHR Office</title>
  </head>
  <body>
    <h1>LHR Office</h1>
    <ul>
      <li><a href="/affiliate-review/">Affiliate candidate review</a></li>
    </ul>
  </body>
</html>
```

*(This landing page is intentionally minimal — it exists so `/affiliate-review/` is reachable. Whichever plan formally owns the hub's overall design is expected to flesh this out further; don't expand it beyond this single link here.)*

- [ ] **Step 2b: If `EXISTS`, just add this feature's dependencies**

Read the existing `apps/lhr-office/package.json` and add any of `@lhr/db`, `@lhr/github`, `pg`, `@types/pg` that aren't already listed (leave everything else the existing scaffold already has untouched). Confirm `apps/lhr-office/astro.config.mjs` already has `output: 'server'` and a Vercel adapter configured — if it doesn't, this feature's API routes (Tasks 15–16) won't run server-side; stop and flag this rather than silently proceeding.

- [ ] **Step 3: Add the shared DB pool helper**

`apps/lhr-office/src/lib/db.ts`:

```ts
import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL env var is required');
    pool = new Pool({ connectionString });
  }
  return pool;
}
```

- [ ] **Step 3b: Add the vitest config, the fail-closed auth stub, and its test**

`apps/lhr-office/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

`apps/lhr-office/tests/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { requireSession, AuthNotConfiguredError } from '../src/lib/auth';

describe('requireSession', () => {
  it('always rejects with AuthNotConfiguredError until real auth lands', async () => {
    await expect(requireSession()).rejects.toBeInstanceOf(AuthNotConfiguredError);
  });
});
```

Run: `cd apps/lhr-office && npx vitest run tests/auth.test.ts`
Expected: FAIL — `../src/lib/auth` does not exist yet.

`apps/lhr-office/src/lib/auth.ts`:

```ts
export class AuthNotConfiguredError extends Error {
  constructor() {
    super(
      'Admin auth is not wired up yet. apps/lhr-office is gated by a placeholder that denies all ' +
        'access until the trends-watcher spec\'s requireAdminSession() lands — swap this stub for ' +
        'that real import once it exists. See docs/affiliate-sourcing-agent-setup.md.',
    );
    this.name = 'AuthNotConfiguredError';
  }
}

export async function requireSession(): Promise<never> {
  throw new AuthNotConfiguredError();
}
```

Run: `cd apps/lhr-office && npx vitest run tests/auth.test.ts`
Expected: PASS

- [ ] **Step 4: Wire the workspace into the root**

In root `package.json`, add `"apps/lhr-office"` to `workspaces` if it isn't already listed (it may have been added already if the sibling scaffold task ran first):

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/github",
    "packages/db",
    "apps/lhr-office"
  ],
```

In root `vitest.config.ts`, extend the exclude list:

```ts
    exclude: ['**/node_modules/**', 'mcp-server/**', 'apps/**'],
```

Then from the repo root:

```bash
npm install
```

- [ ] **Step 5: Verify the app builds**

Run: `cd apps/lhr-office && npm run build`
Expected: succeeds (an empty/near-empty server-output Astro build). If `DATABASE_URL` isn't set locally, this step should still succeed since nothing queries the database at build time yet (that starts in Task 14).

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office package.json package-lock.json vitest.config.ts
git commit -m "Scaffold shared lhr-office app with a fail-closed auth placeholder"
```

---

### Task 14: Affiliate candidate review page

**Files:**
- Create: `apps/lhr-office/src/pages/affiliate-review/index.astro`

**Interfaces:**
- Consumes: `getPool` (`../../lib/db.js`), `requireSession`, `AuthNotConfiguredError` (`../../lib/auth.js`), `getLatestPendingCycleId`, `getPendingCandidates`, `type Candidate` (`@lhr/db`).
- Produces: the `/affiliate-review/` page, posting to the API routes built in Tasks 15–16.

- [ ] **Step 1: Implement the page**

`apps/lhr-office/src/pages/affiliate-review/index.astro`:

```astro
---
import { getPool } from '../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../lib/auth.js';
import { getLatestPendingCycleId, getPendingCandidates, type Candidate } from '@lhr/db';

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
const cycleId = pool ? await getLatestPendingCycleId(pool) : null;
const candidates: Candidate[] = pool && cycleId ? await getPendingCandidates(pool, cycleId) : [];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function formatSales(n: number | null): string {
  return n === null ? 'No estimate available' : `~${n.toLocaleString()}/mo (est.)`;
}
---
{notConfigured ? (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Affiliate candidate review</title>
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
    <title>Affiliate candidate review</title>
    <style>
      body { font-family: sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
      .card img { width: 100%; max-height: 220px; object-fit: cover; border-radius: 4px; }
      .meta { font-size: 0.9rem; color: #444; margin: 0.5rem 0; }
      .estimate { font-style: italic; }
      .fallback { color: #b45309; }
      .actions button { font-size: 1rem; padding: 0.5rem 1rem; margin-right: 0.5rem; cursor: pointer; }
      .approve { background: #16a34a; color: white; border: none; border-radius: 4px; }
      .deny { background: #dc2626; color: white; border: none; border-radius: 4px; }
      .card.gone { display: none; }
    </style>
  </head>
  <body>
    <h1>Affiliate candidates{cycleId ? ` — cycle ${cycleId}` : ''}</h1>
    {candidates.length === 0 && <p>No pending candidates right now.</p>}
    {candidates.map((c) => (
      <div class="card" id={`candidate-${c.id}`}>
        <img src={c.imageUrl} alt={c.title} />
        <h2>{c.title}</h2>
        <p class="meta">{c.category} &middot; {formatPrice(c.priceCents)}{c.isWildcard && ' · wildcard'}</p>
        <p class="meta estimate">
          Est. commission: {(c.commissionRate * 100).toFixed(1)}%
          {c.commissionRateIsFallback && <span class="fallback"> (fallback rate &mdash; verify)</span>}
        </p>
        <p class="meta estimate">Est. monthly sales: {formatSales(c.estimatedMonthlySales)}</p>
        <div class="actions">
          <button class="approve" data-id={c.id} data-action="approve">Approve</button>
          <button class="deny" data-id={c.id} data-action="deny">Deny</button>
        </div>
      </div>
    ))}
    <script>
      document.querySelectorAll('button[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.getAttribute('data-id');
          const action = button.getAttribute('data-action');
          button.setAttribute('disabled', 'true');
          const res = await fetch(`/api/affiliate-review/candidates/${id}/${action}`, { method: 'POST' });
          if (res.ok) {
            document.getElementById(`candidate-${id}`)?.classList.add('gone');
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

- [ ] **Step 2: Verify what's actually reachable, plus a typecheck of the unreachable branch**

Because Task 13's `requireSession()` unconditionally denies, this page's candidate-rendering branch is not reachable yet in a live/dev-server check — the only state a browser can currently observe is the "not configured" message. Verify that directly:

```bash
cd apps/lhr-office && npm run dev
```

Open `http://localhost:4321/affiliate-review/` and confirm it shows "Admin auth isn't wired up yet on this app — this page isn't available until that lands." (not a 500 error, not the candidate list).

The candidate-rendering branch (unreachable at runtime right now, but still real code that must be correct once the auth swap happens later) needs a different kind of verification: `npm run build` does NOT actually type-check this repo's `.astro` files (it transpiles via esbuild; real type-checking needs `@astrojs/check`, which isn't installed here, and installing it is a bigger toolchain decision than this task warrants — don't add it as part of this step). Instead, verify by hand: diff the file you wrote against this step's code block above to confirm it's verbatim, then cross-check every `Candidate`-typed field the template references (`c.id`, `c.imageUrl`, `c.title`, `c.category`, `c.priceCents`, `c.isWildcard`, `c.commissionRate`, `c.commissionRateIsFallback`, `c.estimatedMonthlySales`) against the real `Candidate` interface in `packages/db/src/candidates.ts` — confirm each one exists with a compatible type. Still run `npm run build` too (it should succeed, confirming the file is at least syntactically valid Astro/JSX and importable), but don't treat a clean build as proof of type correctness for the unreachable branch — the manual field cross-check is what actually establishes that. Re-run the full live manual check (seed a `pending` candidate via `psql`, confirm it renders with image/title/category/price/estimates) once Task 13's auth stub is swapped for the real thing, as a follow-up outside this plan's scope.

- [ ] **Step 3: Commit**

```bash
git add apps/lhr-office/src/pages/affiliate-review/index.astro
git commit -m "Add affiliate candidate review page"
```

---

### Task 15: Approve API route

**Files:**
- Create: `apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/approve.ts`
- Create: `apps/lhr-office/tests/approve.test.ts`

(`apps/lhr-office/vitest.config.ts` already exists from Task 13 — do not recreate it.)

**Interfaces:**
- Consumes: `getPool` (`../../../../../lib/db.js`); `requireSession`, `AuthNotConfiguredError` (`../../../../../lib/auth.js`); `getCandidateById`, `markCandidateStatus`, `insertDecisionHistory`, `buildAffiliateLinkFile` (`@lhr/db`); `createGitHubClient`, `commitFilesToMain` (`@lhr/github`).
- Produces: `POST` handler at `/api/affiliate-review/candidates/:id/approve`. Calls `requireSession()` first and returns 503 (without touching the database) if it rejects — this route is unreachable in practice until Task 13's auth stub is swapped for the real thing, but its underlying approve logic is still fully implemented and tested (with `requireSession` mocked to succeed) so it's ready the moment that swap happens.

- [ ] **Step 1: Write the failing tests**

`apps/lhr-office/tests/approve.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = {
  getCandidateById: vi.fn(),
  markCandidateStatus: vi.fn(),
  insertDecisionHistory: vi.fn(),
  buildAffiliateLinkFile: vi.fn(() => ({ path: 'src/content/affiliate-links/test-item-asin.json', content: '{}' })),
};
vi.mock('@lhr/db', () => dbMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  commitFilesToMain: vi.fn(),
};
vi.mock('@lhr/github', () => githubMock);

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/affiliate-review/candidates/[id]/approve');

const pendingCandidate = {
  id: 1, asin: 'B0EXAMPLE1', title: 'Test Item', category: 'Kitchen', priceCents: 2999,
  imageUrl: 'https://example.com/x.jpg', productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03, commissionRateIsFallback: false, estimatedMonthlySales: 100,
  status: 'pending' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
  process.env.AMAZON_ASSOCIATES_TAG = 'lhr-20';
  process.env.AUTHOR_GITHUB_TOKEN = 'test-token';
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/affiliate-review/candidates/[id]/approve', () => {
  it('returns 503 when the session gate is not configured, without touching the database', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(503);
    expect(dbMock.getCandidateById).not.toHaveBeenCalled();
  });

  it('commits an affiliate-links file, marks approved, and records the decision', async () => {
    dbMock.getCandidateById.mockResolvedValue(pendingCandidate);
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(200);
    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/affiliate-links/test-item-asin.json', content: '{}' }],
      expect.stringContaining('Test Item'),
    );
    expect(dbMock.markCandidateStatus).toHaveBeenCalledWith(mockPool, 1, 'approved');
    expect(dbMock.insertDecisionHistory).toHaveBeenCalledWith(mockPool, {
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999,
      commissionRate: 0.03, estimatedMonthlySales: 100, decision: 'approved',
    });
  });

  it('returns 404 for an unknown candidate', async () => {
    dbMock.getCandidateById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 409 for a candidate that is already decided', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, status: 'denied' });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/lhr-office && npx vitest run tests/approve.test.ts`
Expected: FAIL — route module does not exist yet.

- [ ] **Step 3: Implement**

`apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/approve.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../../lib/auth.js';
import { getCandidateById, markCandidateStatus, insertDecisionHistory, buildAffiliateLinkFile } from '@lhr/db';
import { createGitHubClient, commitFilesToMain } from '@lhr/github';

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
    return new Response(JSON.stringify({ error: 'Invalid candidate id' }), { status: 400 });
  }

  const pool = getPool();
  const candidate = await getCandidateById(pool, id);
  if (!candidate) {
    return new Response(JSON.stringify({ error: 'Candidate not found' }), { status: 404 });
  }
  if (candidate.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Candidate is already ${candidate.status}` }), { status: 409 });
  }

  const associatesTag = process.env.AMAZON_ASSOCIATES_TAG;
  const githubToken = process.env.AUTHOR_GITHUB_TOKEN;
  if (!associatesTag || !githubToken) {
    return new Response(
      JSON.stringify({ error: 'Server misconfigured: missing AMAZON_ASSOCIATES_TAG or AUTHOR_GITHUB_TOKEN' }),
      { status: 500 },
    );
  }

  const client = createGitHubClient(githubToken);
  const file = buildAffiliateLinkFile(candidate, associatesTag);
  await commitFilesToMain(client, [file], `Add affiliate link: ${candidate.title}`);

  await markCandidateStatus(pool, id, 'approved');
  await insertDecisionHistory(pool, {
    asin: candidate.asin,
    category: candidate.category,
    priceCents: candidate.priceCents,
    commissionRate: candidate.commissionRate,
    estimatedMonthlySales: candidate.estimatedMonthlySales,
    decision: 'approved',
  });

  return new Response(JSON.stringify({ ok: true, path: file.path }), { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/lhr-office && npx vitest run tests/approve.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/approve.ts apps/lhr-office/tests/approve.test.ts
git commit -m "Add approve API route for affiliate candidates, gated by the auth placeholder"
```

---

### Task 16: Deny API route

**Files:**
- Create: `apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/deny.ts`
- Create: `apps/lhr-office/tests/deny.test.ts`

**Interfaces:**
- Consumes: `getPool` (`../../../../../lib/db.js`); `requireSession`, `AuthNotConfiguredError` (`../../../../../lib/auth.js`); `getCandidateById`, `markCandidateStatus`, `insertDecisionHistory` (`@lhr/db`).
- Produces: `POST` handler at `/api/affiliate-review/candidates/:id/deny`. Same 503-on-unconfigured-auth gate as Task 15's approve route.

- [ ] **Step 1: Write the failing tests**

`apps/lhr-office/tests/deny.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = {
  getCandidateById: vi.fn(),
  markCandidateStatus: vi.fn(),
  insertDecisionHistory: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/affiliate-review/candidates/[id]/deny');

const pendingCandidate = {
  id: 2, asin: 'B0EXAMPLE2', title: 'Another Item', category: 'Grocery', priceCents: 1099,
  commissionRate: 0.01, commissionRateIsFallback: false, estimatedMonthlySales: null,
  status: 'pending' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/affiliate-review/candidates/[id]/deny', () => {
  it('returns 503 when the session gate is not configured, without touching the database', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('2'));
    expect(res.status).toBe(503);
    expect(dbMock.getCandidateById).not.toHaveBeenCalled();
  });

  it('marks denied and records the decision, with no GitHub write', async () => {
    dbMock.getCandidateById.mockResolvedValue(pendingCandidate);
    const res = await POST(makeContext('2'));
    expect(res.status).toBe(200);
    expect(dbMock.markCandidateStatus).toHaveBeenCalledWith(mockPool, 2, 'denied');
    expect(dbMock.insertDecisionHistory).toHaveBeenCalledWith(mockPool, {
      asin: 'B0EXAMPLE2', category: 'Grocery', priceCents: 1099,
      commissionRate: 0.01, estimatedMonthlySales: null, decision: 'denied',
    });
  });

  it('returns 404 for an unknown candidate', async () => {
    dbMock.getCandidateById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for a candidate that is already decided', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, status: 'approved' });
    const res = await POST(makeContext('2'));
    expect(res.status).toBe(409);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/lhr-office && npx vitest run tests/deny.test.ts`
Expected: FAIL — route module does not exist yet.

- [ ] **Step 3: Implement**

`apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/deny.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../../../lib/db.js';
import { requireSession, AuthNotConfiguredError } from '../../../../../lib/auth.js';
import { getCandidateById, markCandidateStatus, insertDecisionHistory } from '@lhr/db';

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
    return new Response(JSON.stringify({ error: 'Invalid candidate id' }), { status: 400 });
  }

  const pool = getPool();
  const candidate = await getCandidateById(pool, id);
  if (!candidate) {
    return new Response(JSON.stringify({ error: 'Candidate not found' }), { status: 404 });
  }
  if (candidate.status !== 'pending') {
    return new Response(JSON.stringify({ error: `Candidate is already ${candidate.status}` }), { status: 409 });
  }

  await markCandidateStatus(pool, id, 'denied');
  await insertDecisionHistory(pool, {
    asin: candidate.asin,
    category: candidate.category,
    priceCents: candidate.priceCents,
    commissionRate: candidate.commissionRate,
    estimatedMonthlySales: candidate.estimatedMonthlySales,
    decision: 'denied',
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/lhr-office && npx vitest run tests/deny.test.ts`
Expected: PASS

- [ ] **Step 5: Full app test run**

Run: `cd apps/lhr-office && npx vitest run`
Expected: PASS (`auth.test.ts` from Task 13, `approve.test.ts`, and `deny.test.ts` — all three)

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/deny.ts apps/lhr-office/tests/deny.test.ts
git commit -m "Add deny API route for affiliate candidates, gated by the auth placeholder"
```

---

### Task 17: Manual infrastructure setup + operator documentation

Everything up to this point is code. What's left is dashboard configuration this plan cannot perform on the operator's behalf (creating a Vercel project, provisioning a database) — write it down precisely enough that the site author (or whoever has Vercel/GitHub access) can do it in one pass, and give the local cron a documented way to actually run weekly. Note that `/affiliate-review/` itself will not be usable yet even after these steps — see step 2 below — since its access gate is a deliberate placeholder pending a separate, not-yet-committed spec.

**Files:**
- Create: `docs/affiliate-sourcing-agent-setup.md`

- [ ] **Step 1: Write the setup doc**

`docs/affiliate-sourcing-agent-setup.md`:

```markdown
# Affiliate Sourcing Agent — Setup

One-time steps to get the weekly candidate-sourcing cron and the `lhr-office`
review app running. Code changes are already in place (see
`docs/superpowers/plans/2026-08-24-affiliate-sourcing-agent.md`); this is the
remaining manual configuration.

## 1. Provision Postgres (Neon, via Vercel Marketplace)

1. In the Vercel dashboard, open the `lhr-office` project (create it first if
   this is also the first feature landing in that shared app — see the
   project's own setup notes for how it's linked to this repo/subdirectory).
2. Storage tab → Marketplace → add a Neon Postgres integration.
3. Copy the resulting connection string into:
   - `apps/lhr-office`'s Vercel project environment variables, as
     `DATABASE_URL` (Production + Preview).
   - Your local `.env` (for running the cron script and `db:migrate`
     locally) as `DATABASE_URL`.
4. Run the migration once against that database:
   ```bash
   cd packages/db && npm run db:migrate
   ```

## 2. Admin access to `/affiliate-review/` — not yet available

`apps/lhr-office` is gated by a **deliberate placeholder** (`requireSession()`
in `apps/lhr-office/src/lib/auth.ts`) that denies every request. This was a
conscious choice made while implementing this plan: the site author decided
`lhr-office` should use real username/password admin accounts instead of a
single shared Vercel Deployment Protection password, but that system
(`requireAdminSession()`, `office_admins`/`office_sessions` tables) is owned
by a separate, not-yet-committed spec (working title "trends-watcher").

**There is nothing to configure here yet.** Once that spec lands:

1. In `apps/lhr-office/src/lib/auth.ts`, replace the stub's `requireSession`
   export with an import of the real `requireAdminSession()`.
2. In each of `apps/lhr-office/src/pages/affiliate-review/index.astro`,
   `apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/approve.ts`,
   and `.../deny.ts`, the `try { await requireSession(); } catch (err) { if
   (err instanceof AuthNotConfiguredError) {...} }` block can be simplified
   to whatever the real system's error-handling contract calls for.
3. Follow that spec's own setup docs for creating the first admin account.

Until then, the weekly cron (step 4 below) still runs and populates
Postgres normally — only the review UI is inert.

## 3. Environment variables

Set these in the `lhr-office` Vercel project (Production + Preview) and in
your local `.env` for the cron script:

| Var | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | cron script, `lhr-office` | from step 1 |
| `AUTHOR_GITHUB_TOKEN` | cron script, `lhr-office` approve route | a GitHub PAT with `repo` write access — the same one `mcp-server/src/server.ts`'s mobile-upload flow already requires |
| `AMAZON_ASSOCIATES_TAG` | cron script, `lhr-office` approve route | your Amazon Associates tracking ID, e.g. `yoursite-20` |
| `KEEPA_API_KEY` | cron script only | from your Keepa account |

## 4. Run the weekly cron

There's no shared local orchestrator yet (that's a separate, later spec).
Until then, run manually or via your own OS scheduler (cron/launchd):

```bash
cd mcp-server && npm run source:affiliate-candidates
```

## 5. Verify what's available today

1. Run the script once (step 4) and confirm it logs `Wrote N candidate(s)...`.
2. Confirm the rows landed: `SELECT asin, title, status FROM candidates WHERE status = 'pending' LIMIT 5;`
3. Visit `https://<lhr-office-url>/affiliate-review/` and confirm it shows the
   "admin auth isn't wired up yet" message (not a 500 error) — this is the
   expected, fully-functional state of the placeholder gate described in
   step 2 above.

Steps 3-4 as originally planned (approve a candidate via the UI, confirm a
file lands on `main`; deny another, confirm only the decision is recorded)
can't be exercised end-to-end through the UI until the real auth system
lands — do them once step 2's swap is complete.
```

- [ ] **Step 2: Commit**

```bash
git add docs/affiliate-sourcing-agent-setup.md
git commit -m "Document affiliate-sourcing-agent manual setup steps"
```

---

## Self-Review Notes

- **Spec coverage:** §1 (goals/estimate-labeling) → Tasks 14, 7; §2 (architecture split) → Tasks 12 (local) and 13–16 (deployed); §3 (hosting) → superseded per Global Constraints and Task 13; §4 (Keepa sourcing + rate card) → Tasks 10, 7; §5 (learning/scoring) → Task 5; §6 (data model + file-write) → Tasks 2, 6; §7 (error handling: Keepa failure, <20 candidates, no rate-card entry, already-decided, commit-fails-after-approve, app/DB down) → Tasks 12, 8, 7, 11 respectively (app/DB-down is inherently satisfied — `pending` status has no expiry by construction, nothing was added to time it out); §8 (testing approach) → every task's own TDD steps map 1:1 onto the spec's listed test files (`keepa.test.ts`, `amazonCommissionRates.test.ts`, scoring tests, approval-flow integration test, reconciliation-pass test).
- **Placeholder scan:** no `TBD`/"add error handling"/"similar to Task N" left in any step; every code block is complete. The two spots with residual real-world uncertainty (Keepa CSV indices/category IDs in Task 10, commission rates in Task 7) are each paired with a concrete, actionable verification step rather than presented as unexamined fact.
- **Type consistency:** `Candidate`/`NewCandidate` (Task 3), `DecisionHistoryRecord`/`NewDecisionHistoryRecord` (Task 4), `ScoringCandidate`/`ScoredCandidate` (Task 5), `KeepaCandidate` (Task 10), and `AffiliateLinkFileInput` (Task 6) field names were cross-checked across every task that constructs or consumes them (Task 12's `scoringInput` mapping, `newCandidates` mapping; Tasks 15–16's route bodies) — camelCase field names match exactly everywhere the same object shape crosses a task boundary.
