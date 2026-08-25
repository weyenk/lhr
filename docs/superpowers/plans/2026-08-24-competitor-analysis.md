# Weekly Competitor Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly, always-current view of named competitors — other recipe/kitchenware content creators — covering new content, SEO keyword-ranking signals, monetization/product strategy, and design/UX changes, viewable at `/competitors` in the shared `apps/lhr-office` app behind the existing admin login, with periodic discovery of new candidate competitors surfaced for explicit approval.

**Architecture:** Testable orchestration logic in `mcp-server/src/analyzeCompetitors.ts` runs three phases: discovery (a small curated list of SerpApi Google Search queries surfaces new candidate domains), SEO tracking (one SerpApi Google Search call per admin-managed keyword, scanned for every tracked competitor's domain — once per keyword, not per keyword-per-competitor), and per-competitor analysis (content diffing via RSS/HTML, and LLM-synthesized monetization and design snapshots diffed against the prior cycle). One further LLM call per tracked competitor synthesizes all four dimensions into a "what changed this week" summary, written as one `competitor_reports` row per tracked competitor per cycle. Per the 2026-08-25 execution-model amendment (see Global Constraints), this pipeline is exposed as a zero-argument, Job-contract-shaped `analyzeCompetitors(): Promise<JobResult>` entry point — no standalone CLI script — that a separate, not-yet-built orchestrator sub-project will import and invoke from a Vercel Cron-triggered endpoint; this plan's job stops at exposing that function correctly. The deployed side adds three page groups to the already-scaffolded `apps/lhr-office` Astro app — `/competitors` (tracked list + latest reports), `/competitors/candidates` (approve/reject discovered domains), `/competitors/keywords` (manage the SEO keyword list) — all gated by the `requireAdminSession()` helper the trends-watcher sub-project establishes for the whole app. No new auth work in this plan.

**Tech Stack:** TypeScript (strict), `pg` (node-postgres, Neon Postgres via `DATABASE_URL`), native `fetch` (SerpApi + OpenRouter + competitor site fetches — no new HTTP client dependency), no new RSS/HTML parsing dependency (regex-based extraction, consistent with this codebase's preference for zero new dependencies where native tools suffice), Astro with `output: 'server'` + `@astrojs/vercel` adapter, Vitest.

**Spec:** [docs/superpowers/specs/active/2026-08-24-competitor-analysis-design.md](../specs/active/2026-08-24-competitor-analysis-design.md) — every section this plan implements is quoted or paraphrased below so no separate lookup is required to execute this plan. **Read alongside its 2026-08-25 amendment** (added mid-execution of this plan — see Global Constraints) and [2026-08-25-local-orchestrator-design.md](../specs/active/2026-08-25-local-orchestrator-design.md) §2, which defines the `Job`/`JobResult` contract Task 11 conforms to.

## Global Constraints

- **Execution-model amendment (2026-08-25, landed mid-execution of this plan).** The spec's original §2 ("Local weekly cron — `mcp-server/scripts/analyze-competitors.ts`") is superseded on execution model only — everything about discovery, the four analysis dimensions, and SEO tracking is unaffected. Scheduling moves to Vercel Cron Jobs via a separate, not-yet-planned "shared orchestrator" sub-project (spec: `docs/superpowers/specs/active/2026-08-25-local-orchestrator-design.md`). That spec's §2 defines a `Job = () => Promise<JobResult>` contract (`JobResult = {status: 'success'|'partial'|'failure', summary: string, details?: Record<string, unknown>}`) and a registry (in a future `packages/jobs` / `@lhr/jobs`, not built yet) that will import a zero-argument `analyzeCompetitors` function from this sub-project and call it directly, in-process. This plan's Task 11 (originally "cron script wrapper") is replaced with exposing that conforming entry point — no CLI script, no `tsx` script-runner dependency, and no registration with `@lhr/jobs` (which doesn't exist in this worktree yet and is that other sub-project's own job to wire up once it lands). Because `@lhr/jobs` isn't available yet, `JobResult` is defined locally in `mcp-server/src/analyzeCompetitors.ts`, structurally matching the contract — the same reasoning already applied to `CompetitorPost`/`CompetitorPostSummary` elsewhere in this plan — rather than gated on a fourth cross-branch pull.
- **Cross-branch prerequisite (read before Task 1).** This worktree/branch (`claude/recipe-affiliate-agent-system-bd11aa`) currently has none of the shared `apps/lhr-office` / `@lhr/db` infrastructure this spec builds on — that work is being developed on sibling branch `claude/trends-watcher-design-cb1688` (worktree `add-flour-affiliate-link-ecff6b`), per its own plan `docs/superpowers/plans/2026-08-24-trends-watcher.md`. This spec's own header says it plainly: *"Builds on shared infrastructure: ... this feature lands in the already-scaffolded `apps/lhr-office` ... every route it adds goes through the `requireAdminSession()` check established by the trends-watcher spec. No new auth work here."* Task 1 pulls the finished result of that plan in verbatim via `git checkout claude/trends-watcher-design-cb1688 -- <path>` (a local branch in this same repository — no fetch needed), with an explicit check-and-stop if that branch hasn't executed its plan yet, rather than silently reimplementing auth or the shared `@lhr/db` package and diverging into a competing copy.
- **`requireAdminSession()` gates every route** — page or API — this plan adds to `apps/lhr-office`, redirecting to `/login` on any missing/invalid/expired session rather than ever rendering protected content or performing a mutation on a failed check (spec header; trends-watcher spec §3, §8).
- **SEO tracking is one SerpApi call per keyword, not per keyword-per-competitor.** Call volume is proportional to the keyword list size, not the competitor count (spec §4).
- **Budget reality** (not auto-enforced, just a log line): combined with the trends watcher's own usage, this feature's discovery + keyword-tracking calls push total SerpApi usage past the free tier; the account is expected to move to a paid tier once both features are live (spec §4). No code change follows from this — it's noted here only so a future contributor doesn't mistake a rising call count for a bug.
- **Content diffing prefers RSS, falls back to HTML, and never crashes the run.** RSS feeds are structured and preferred when available; a competitor whose content can't be reliably parsed this cycle is flagged rather than the pipeline crashing or guessing (spec §5).
- **Monetization/design snapshots are free-text LLM output, diffed by a second LLM call, not a mechanical text diff** — prose rephrasing without substantive change must not be reported as a "change" (spec §5).
- **All competitor fetches are read-only requests to public pages** — no account creation, no scraping behind auth walls, same posture as the `monetization-scout`/`product-sourcing-scout` agents' research approach (spec §5).
- **Partial reports, never a lost cycle:** a competitor's site being unreachable notes `"unreachable this cycle"` for the affected dimension(s) rather than blocking other competitors' reports or the whole run. A SerpApi failure on a keyword is skipped (logged); other keywords and the rest of the pipeline continue. An LLM synthesis failure still writes the report row, with `summary` set to the literal placeholder `"[Summary generation failed this cycle]"` (spec §6).
- **Discovery re-insertion of an already-`tracked`/`rejected` domain is a safe no-op** via the `UNIQUE (domain)` constraint on `competitors` (spec §6).
- **No tracked competitors yet:** Phase B (per-competitor analysis) and the SEO scan simply produce no reports — not an error state, just an empty cycle (spec §6).
- All new Postgres-touching functions take an explicit `Pool` as their first parameter rather than a module-level singleton — mirrors the existing `@lhr/db` (`candidates.ts`, `officeAdmins.ts`, `trendSeedTopics.ts`) dependency-injection style, which is what makes every module mockable in tests exactly like the rest of this codebase.
- **No new dependencies.** RSS/HTML parsing uses regex-based extraction (matching the codebase's existing native-`fetch`-only, no-new-HTTP-client convention established for `openrouter.ts` and `serpapiTrends.ts`) rather than adding `cheerio`/`rss-parser`/similar.

---

### Task 1: Pull in prerequisite shared infrastructure from the trends-watcher branch

**Files:**
- Create (via `git checkout`, unmodified): `packages/db/**`, `packages/github/**`, `apps/lhr-office/**`
- Modify: `package.json` (root — add `packages/github`, `packages/db`, `apps/lhr-office` to `workspaces` and their builds to `postinstall`)
- Modify: `vitest.config.ts` (root — exclude `apps/**` in addition to the existing `mcp-server/**`)
- Modify: `.env.example` (add `DATABASE_URL`, `SERPAPI_KEY` — `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`/`GITHUB_TOKEN` are already present in this worktree)

**Interfaces:**
- Produces: `@lhr/db` exporting (at minimum) `Competitor`-adjacent building blocks this plan will extend — `candidates.ts`/`decisionHistory.ts`/`scoring.ts`/`affiliateLinkFile.ts`/`officeAdmins.ts`/`officeSessions.ts`/`trendSeedTopics.ts`/`trendsReports.ts`/`migrate.ts`/`schema.ts`/`index.ts` (from the sibling branch, unchanged by this task); `@lhr/github` (unused directly by this plan, pulled only because `apps/lhr-office`'s `package.json` declares it as a dependency); `apps/lhr-office/src/lib/db.ts` exporting `getPool(): Pool`; `apps/lhr-office/src/lib/auth.ts` exporting `requireAdminSession(context: AuthContext): Promise<AuthResult>` where `AuthResult = { admin: OfficeAdmin } | { response: Response }`. Consumed by Tasks 2-15.

- [ ] **Step 1: Verify the prerequisite branch has landed**

```bash
git cat-file -e claude/trends-watcher-design-cb1688:apps/lhr-office/src/lib/auth.ts && echo READY || echo NOT_READY
```

If this prints `NOT_READY`, **stop here** — do not proceed with this plan, and do not reimplement `requireAdminSession()` or `@lhr/db`'s admin/session tables yourself (that would create a competing copy that conflicts with the trends-watcher branch when both merge). Instead, tell the operator: "The competitor-analysis plan depends on `apps/lhr-office`'s admin auth, which the trends-watcher plan (`docs/superpowers/plans/2026-08-24-trends-watcher.md` in worktree `add-flour-affiliate-link-ecff6b`) hasn't finished yet. Run that plan first, then re-run this one." If it prints `READY`, continue to Step 2.

- [ ] **Step 2: Pull the shared packages and app from the sibling branch**

```bash
git checkout claude/trends-watcher-design-cb1688 -- packages/db packages/github apps/lhr-office
```

Expected: `packages/db/`, `packages/github/`, and `apps/lhr-office/` now exist in this worktree, staged, unchanged from that branch — including `apps/lhr-office/src/lib/auth.ts` with a real `requireAdminSession()` (not the fail-closed placeholder), and `packages/db/src/officeAdmins.ts`/`officeSessions.ts`/`trendSeedTopics.ts`/`trendsReports.ts`.

- [ ] **Step 3: Wire the new workspaces into the root**

In root `package.json`, update `workspaces` and `postinstall`:

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/github",
    "packages/db",
    "apps/lhr-office"
  ],
```

```json
    "postinstall": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/github && npm run build --workspace=@lhr/db",
```

- [ ] **Step 4: Exclude `apps/**` from the root vitest run**

In root `vitest.config.ts`, update the `exclude` array:

```ts
    exclude: ['**/node_modules/**', 'mcp-server/**', 'apps/**'],
```

- [ ] **Step 5: Add the new env vars to `.env.example`**

Append to `.env.example`:

```
DATABASE_URL=
SERPAPI_KEY=
```

- [ ] **Step 6: Install and verify the pulled-in packages build and test cleanly**

```bash
npm install
npm run build --workspace=@lhr/db
npm run build --workspace=@lhr/github
cd packages/db && npx vitest run
cd ../../apps/lhr-office && npx vitest run
```

Expected: both package builds succeed; every existing test in `packages/db` and `apps/lhr-office` passes unchanged (they were already passing on the branch they came from).

- [ ] **Step 7: Commit**

```bash
git add packages/db packages/github apps/lhr-office package.json package-lock.json vitest.config.ts .env.example
git commit -m "Pull in shared apps/lhr-office and @lhr/db (with real admin auth) from the trends-watcher branch"
```

---

### Task 2: `competitors` table — schema and CRUD

**Files:**
- Modify: `packages/db/src/schema.ts` (add `COMPETITORS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts` (run it)
- Create: `packages/db/src/competitors.ts`
- Create: `packages/db/tests/competitors.test.ts`
- Modify: `packages/db/src/index.ts` (export the new module)
- Modify: `packages/db/tests/migrate.test.ts` (assert the new table's migration runs)

**Interfaces:**
- Produces (from `@lhr/db`): `type CompetitorStatus = 'candidate' | 'tracked' | 'rejected'`, `Competitor`, `insertCandidateCompetitor(pool, domain, name?): Promise<Competitor | null>` (returns `null` when the domain already exists — the safe no-op from spec §6), `getCompetitorByDomain(pool, domain): Promise<Competitor | null>`, `getCompetitorById(pool, id): Promise<Competitor | null>`, `listCompetitorsByStatus(pool, status): Promise<Competitor[]>`, `setCompetitorStatus(pool, id, status: 'tracked' | 'rejected'): Promise<void>`. Consumed by Tasks 6, 9, 10, 13, 14.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/competitors.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertCandidateCompetitor,
  getCompetitorByDomain,
  getCompetitorById,
  listCompetitorsByStatus,
  setCompetitorStatus,
} from '../src/competitors';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const competitorRow = {
  id: 1,
  domain: 'example-recipes.com',
  name: null,
  status: 'candidate',
  discovered_at: new Date('2026-08-24T00:00:00Z'),
  approved_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCandidateCompetitor', () => {
  it('inserts a new domain as a candidate and returns it', async () => {
    const pool = mockPool([competitorRow]);
    const result = await insertCandidateCompetitor(pool as never, 'example-recipes.com');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (domain) DO NOTHING'),
      ['example-recipes.com', null],
    );
    expect(result).toEqual({
      id: 1,
      domain: 'example-recipes.com',
      name: null,
      status: 'candidate',
      discoveredAt: competitorRow.discovered_at,
      approvedAt: null,
    });
  });

  it('passes through an optional name', async () => {
    const pool = mockPool([{ ...competitorRow, name: 'Example Recipes' }]);
    await insertCandidateCompetitor(pool as never, 'example-recipes.com', 'Example Recipes');
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['example-recipes.com', 'Example Recipes']);
  });

  it('returns null when the domain already exists (safe no-op)', async () => {
    const pool = mockPool([]);
    const result = await insertCandidateCompetitor(pool as never, 'already-tracked.com');
    expect(result).toBeNull();
  });
});

describe('getCompetitorByDomain', () => {
  it('returns null when no competitor matches', async () => {
    const pool = mockPool([]);
    expect(await getCompetitorByDomain(pool as never, 'nobody.com')).toBeNull();
  });

  it('maps a found row to camelCase', async () => {
    const pool = mockPool([competitorRow]);
    const result = await getCompetitorByDomain(pool as never, 'example-recipes.com');
    expect(result?.discoveredAt).toEqual(competitorRow.discovered_at);
  });
});

describe('getCompetitorById', () => {
  it('maps a found row to camelCase', async () => {
    const pool = mockPool([competitorRow]);
    const result = await getCompetitorById(pool as never, 1);
    expect(result?.domain).toBe('example-recipes.com');
  });
});

describe('listCompetitorsByStatus', () => {
  it('queries by status, ordered by domain', async () => {
    const pool = mockPool([{ ...competitorRow, status: 'tracked' }]);
    const result = await listCompetitorsByStatus(pool as never, 'tracked');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY domain ASC'), ['tracked']);
    expect(result[0].status).toBe('tracked');
  });
});

describe('setCompetitorStatus', () => {
  it('sets approved_at when approving to tracked', async () => {
    const pool = mockPool();
    await setCompetitorStatus(pool as never, 1, 'tracked');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'tracked'"), [1]);
    expect(pool.query.mock.calls[0][0]).toContain('approved_at = now()');
  });

  it('does not touch approved_at when rejecting', async () => {
    const pool = mockPool();
    await setCompetitorStatus(pool as never, 1, 'rejected');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'rejected'"), [1]);
    expect(pool.query.mock.calls[0][0]).not.toContain('approved_at');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/competitors.test.ts
```

Expected: FAIL — `../src/competitors` does not exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append (verbatim from spec §3):

```ts
export const COMPETITORS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS competitors (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
`;
```

- [ ] **Step 4: Implement `competitors.ts`**

`packages/db/src/competitors.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export type CompetitorStatus = 'candidate' | 'tracked' | 'rejected';

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discoveredAt: Date;
  approvedAt: Date | null;
}

interface CompetitorRow {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discovered_at: Date;
  approved_at: Date | null;
}

function rowToCompetitor(row: CompetitorRow): Competitor {
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    status: row.status,
    discoveredAt: row.discovered_at,
    approvedAt: row.approved_at,
  };
}

export async function insertCandidateCompetitor(
  pool: Pool,
  domain: string,
  name: string | null = null,
): Promise<Competitor | null> {
  const res = (await pool.query(
    `INSERT INTO competitors (domain, name) VALUES ($1, $2) ON CONFLICT (domain) DO NOTHING RETURNING *`,
    [domain, name],
  )) as QueryResult<CompetitorRow>;
  return res.rows[0] ? rowToCompetitor(res.rows[0]) : null;
}

export async function getCompetitorByDomain(pool: Pool, domain: string): Promise<Competitor | null> {
  const res = (await pool.query(`SELECT * FROM competitors WHERE domain = $1`, [domain])) as QueryResult<CompetitorRow>;
  return res.rows[0] ? rowToCompetitor(res.rows[0]) : null;
}

export async function getCompetitorById(pool: Pool, id: number): Promise<Competitor | null> {
  const res = (await pool.query(`SELECT * FROM competitors WHERE id = $1`, [id])) as QueryResult<CompetitorRow>;
  return res.rows[0] ? rowToCompetitor(res.rows[0]) : null;
}

export async function listCompetitorsByStatus(pool: Pool, status: CompetitorStatus): Promise<Competitor[]> {
  const res = (await pool.query(
    `SELECT * FROM competitors WHERE status = $1 ORDER BY domain ASC`,
    [status],
  )) as QueryResult<CompetitorRow>;
  return res.rows.map(rowToCompetitor);
}

export async function setCompetitorStatus(pool: Pool, id: number, status: 'tracked' | 'rejected'): Promise<void> {
  if (status === 'tracked') {
    await pool.query(`UPDATE competitors SET status = 'tracked', approved_at = now() WHERE id = $1`, [id]);
  } else {
    await pool.query(`UPDATE competitors SET status = 'rejected' WHERE id = $1`, [id]);
  }
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`, import `COMPETITORS_TABLE_SQL` and add a call for it (after the existing tables — `competitor_reports` will depend on it via foreign key in Task 4, so it must run before that one):

```ts
  await pool.query(COMPETITORS_TABLE_SQL);
```

In `packages/db/src/index.ts`, add:

```ts
export * from './competitors.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the competitors table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS competitors'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS (all of `competitors.test.ts`, updated `migrate.test.ts`, and every pre-existing test).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/competitors.ts packages/db/src/index.ts packages/db/tests/competitors.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add competitors table with candidate/tracked/rejected lifecycle"
```

---

### Task 3: `competitor_seo_keywords` table — schema and CRUD

**Files:**
- Modify: `packages/db/src/schema.ts` (add `COMPETITOR_SEO_KEYWORDS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts`
- Create: `packages/db/src/competitorSeoKeywords.ts`
- Create: `packages/db/tests/competitorSeoKeywords.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/tests/migrate.test.ts`

**Interfaces:**
- Produces: `CompetitorSeoKeyword`, `addKeyword(pool, keyword): Promise<CompetitorSeoKeyword>` (idempotent — re-adding an existing keyword returns the existing row rather than erroring), `removeKeyword(pool, id): Promise<void>`, `listKeywords(pool): Promise<CompetitorSeoKeyword[]>`. Consumed by Tasks 9, 10, 15.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/competitorSeoKeywords.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { addKeyword, removeKeyword, listKeywords } from '../src/competitorSeoKeywords';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const keywordRow = { id: 1, keyword: 'gluten free dinner recipes', added_at: new Date('2026-08-24T00:00:00Z') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addKeyword', () => {
  it('inserts a new keyword and returns it', async () => {
    const pool = mockPool([keywordRow]);
    const result = await addKeyword(pool as never, 'gluten free dinner recipes');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (keyword) DO UPDATE'),
      ['gluten free dinner recipes'],
    );
    expect(result).toEqual({ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at });
  });

  it('is idempotent — re-adding an existing keyword still returns a row, not an error', async () => {
    const pool = mockPool([keywordRow]);
    await expect(addKeyword(pool as never, 'gluten free dinner recipes')).resolves.toBeDefined();
  });
});

describe('removeKeyword', () => {
  it('deletes the keyword row', async () => {
    const pool = mockPool();
    await removeKeyword(pool as never, 1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM competitor_seo_keywords'), [1]);
  });
});

describe('listKeywords', () => {
  it('lists keywords ordered alphabetically', async () => {
    const pool = mockPool([keywordRow]);
    const result = await listKeywords(pool as never);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY keyword ASC'));
    expect(result).toEqual([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/competitorSeoKeywords.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append (verbatim from spec §3):

```ts
export const COMPETITOR_SEO_KEYWORDS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS competitor_seo_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
```

- [ ] **Step 4: Implement `competitorSeoKeywords.ts`**

`packages/db/src/competitorSeoKeywords.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export interface CompetitorSeoKeyword {
  id: number;
  keyword: string;
  addedAt: Date;
}

interface CompetitorSeoKeywordRow {
  id: number;
  keyword: string;
  added_at: Date;
}

function rowToKeyword(row: CompetitorSeoKeywordRow): CompetitorSeoKeyword {
  return { id: row.id, keyword: row.keyword, addedAt: row.added_at };
}

export async function addKeyword(pool: Pool, keyword: string): Promise<CompetitorSeoKeyword> {
  const res = (await pool.query(
    `INSERT INTO competitor_seo_keywords (keyword)
     VALUES ($1)
     ON CONFLICT (keyword) DO UPDATE SET keyword = EXCLUDED.keyword
     RETURNING *`,
    [keyword],
  )) as QueryResult<CompetitorSeoKeywordRow>;
  return rowToKeyword(res.rows[0]);
}

export async function removeKeyword(pool: Pool, id: number): Promise<void> {
  await pool.query(`DELETE FROM competitor_seo_keywords WHERE id = $1`, [id]);
}

export async function listKeywords(pool: Pool): Promise<CompetitorSeoKeyword[]> {
  const res = (await pool.query(
    `SELECT * FROM competitor_seo_keywords ORDER BY keyword ASC`,
  )) as QueryResult<CompetitorSeoKeywordRow>;
  return res.rows.map(rowToKeyword);
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`, import and call `COMPETITOR_SEO_KEYWORDS_TABLE_SQL` (no foreign keys, order doesn't matter relative to other tables):

```ts
  await pool.query(COMPETITOR_SEO_KEYWORDS_TABLE_SQL);
```

In `packages/db/src/index.ts`, add:

```ts
export * from './competitorSeoKeywords.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the competitor_seo_keywords table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS competitor_seo_keywords'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/competitorSeoKeywords.ts packages/db/src/index.ts packages/db/tests/competitorSeoKeywords.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add competitor_seo_keywords table with idempotent add/remove"
```

---

### Task 4: `competitor_reports` table — schema and CRUD

**Files:**
- Modify: `packages/db/src/schema.ts` (add `COMPETITOR_REPORTS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts`
- Create: `packages/db/src/competitorReports.ts`
- Create: `packages/db/tests/competitorReports.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/tests/migrate.test.ts`

**Interfaces:**
- Produces: `CompetitorPostSummary` (`{title, url, publishedAt}`), `SeoPositionEntry` (`{keyword, position}`), `NewCompetitorReport`, `CompetitorReport`, `insertCompetitorReport(pool, report): Promise<CompetitorReport>`, `getLatestReport(pool, competitorId): Promise<CompetitorReport | null>`, `listRecentCompetitorReports(pool, competitorId, limit?): Promise<CompetitorReport[]>`. Consumed by Tasks 9, 10, 13.

**Naming note (added during Task 6):** the last function is named `listRecentCompetitorReports`, not the more generic `listRecentReports` a first draft of this task used — `packages/db/src/trendsReports.ts` (pulled in Task 1 from a sibling sub-project) already exports its own `listRecentReports`, and both are barrel re-exported (`export *`) from `packages/db/src/index.ts`, so the generic name collides. Renaming the competitor-analysis side (rather than touching the sibling sub-project's already-reviewed code) was the least invasive fix.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/competitorReports.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertCompetitorReport, getLatestReport, listRecentCompetitorReports, type NewCompetitorReport } from '../src/competitorReports';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewCompetitorReport = {
  competitorId: 1,
  cycleId: '2026-W35',
  newContent: [{ title: 'Sourdough Focaccia', url: 'https://example-recipes.com/sourdough-focaccia', publishedAt: '2026-08-20' }],
  seoPositions: [{ keyword: 'gluten free dinner recipes', position: 4 }],
  monetizationSnapshot: 'Sells a $40 cast-iron pan; runs Amazon affiliate links in most posts.',
  designSnapshot: 'Grid homepage, prominent "Shop the kitchen" CTA above the fold.',
  summary: 'Published one new post this week; no monetization or design changes.',
};

const reportRow = {
  id: 1,
  competitor_id: 1,
  cycle_id: '2026-W35',
  generated_at: new Date('2026-08-24T00:00:00Z'),
  new_content: newReport.newContent,
  seo_positions: newReport.seoPositions,
  monetization_snapshot: newReport.monetizationSnapshot,
  design_snapshot: newReport.designSnapshot,
  summary: newReport.summary,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCompetitorReport', () => {
  it('inserts JSONB-encoded new_content and seo_positions and returns the row', async () => {
    const pool = mockPool([reportRow]);
    const result = await insertCompetitorReport(pool as never, newReport);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO competitor_reports'),
      [
        1,
        '2026-W35',
        JSON.stringify(newReport.newContent),
        JSON.stringify(newReport.seoPositions),
        newReport.monetizationSnapshot,
        newReport.designSnapshot,
        newReport.summary,
      ],
    );
    expect(result.summary).toBe(newReport.summary);
    expect(result.newContent).toEqual(newReport.newContent);
  });
});

describe('getLatestReport', () => {
  it('returns null when there is no prior report', async () => {
    const pool = mockPool([]);
    expect(await getLatestReport(pool as never, 999)).toBeNull();
  });

  it('returns the most recent report for the competitor', async () => {
    const pool = mockPool([reportRow]);
    const result = await getLatestReport(pool as never, 1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC LIMIT 1'), [1]);
    expect(result?.cycleId).toBe('2026-W35');
  });
});

describe('listRecentCompetitorReports', () => {
  it('queries by competitor, most recent first, respecting the limit', async () => {
    const pool = mockPool([reportRow]);
    const result = await listRecentCompetitorReports(pool as never, 1, 5);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC'), [1, 5]);
    expect(result).toHaveLength(1);
  });

  it('defaults the limit to 10', async () => {
    const pool = mockPool([]);
    await listRecentCompetitorReports(pool as never, 1);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [1, 10]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/competitorReports.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append (verbatim from spec §3):

```ts
export const COMPETITOR_REPORTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS competitor_reports (
  id SERIAL PRIMARY KEY,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  cycle_id TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  new_content JSONB NOT NULL,
  seo_positions JSONB NOT NULL,
  monetization_snapshot TEXT NOT NULL,
  design_snapshot TEXT NOT NULL,
  summary TEXT NOT NULL
);
`;
```

- [ ] **Step 4: Implement `competitorReports.ts`**

`packages/db/src/competitorReports.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export interface CompetitorPostSummary {
  title: string;
  url: string;
  publishedAt: string | null;
}

export interface SeoPositionEntry {
  keyword: string;
  position: number | null;
}

export interface NewCompetitorReport {
  competitorId: number;
  cycleId: string;
  newContent: CompetitorPostSummary[];
  seoPositions: SeoPositionEntry[];
  monetizationSnapshot: string;
  designSnapshot: string;
  summary: string;
}

export interface CompetitorReport extends NewCompetitorReport {
  id: number;
  generatedAt: Date;
}

interface CompetitorReportRow {
  id: number;
  competitor_id: number;
  cycle_id: string;
  generated_at: Date;
  new_content: CompetitorPostSummary[];
  seo_positions: SeoPositionEntry[];
  monetization_snapshot: string;
  design_snapshot: string;
  summary: string;
}

function rowToReport(row: CompetitorReportRow): CompetitorReport {
  return {
    id: row.id,
    competitorId: row.competitor_id,
    cycleId: row.cycle_id,
    generatedAt: row.generated_at,
    newContent: row.new_content,
    seoPositions: row.seo_positions,
    monetizationSnapshot: row.monetization_snapshot,
    designSnapshot: row.design_snapshot,
    summary: row.summary,
  };
}

export async function insertCompetitorReport(pool: Pool, report: NewCompetitorReport): Promise<CompetitorReport> {
  const res = (await pool.query(
    `INSERT INTO competitor_reports
      (competitor_id, cycle_id, new_content, seo_positions, monetization_snapshot, design_snapshot, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      report.competitorId,
      report.cycleId,
      JSON.stringify(report.newContent),
      JSON.stringify(report.seoPositions),
      report.monetizationSnapshot,
      report.designSnapshot,
      report.summary,
    ],
  )) as QueryResult<CompetitorReportRow>;
  return rowToReport(res.rows[0]);
}

export async function getLatestReport(pool: Pool, competitorId: number): Promise<CompetitorReport | null> {
  const res = (await pool.query(
    `SELECT * FROM competitor_reports WHERE competitor_id = $1 ORDER BY generated_at DESC LIMIT 1`,
    [competitorId],
  )) as QueryResult<CompetitorReportRow>;
  return res.rows[0] ? rowToReport(res.rows[0]) : null;
}

export async function listRecentCompetitorReports(pool: Pool, competitorId: number, limit = 10): Promise<CompetitorReport[]> {
  const res = (await pool.query(
    `SELECT * FROM competitor_reports WHERE competitor_id = $1 ORDER BY generated_at DESC LIMIT $2`,
    [competitorId, limit],
  )) as QueryResult<CompetitorReportRow>;
  return res.rows.map(rowToReport);
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`, import and call `COMPETITOR_REPORTS_TABLE_SQL` **after** `COMPETITORS_TABLE_SQL` (foreign key dependency):

```ts
  await pool.query(COMPETITOR_REPORTS_TABLE_SQL);
```

In `packages/db/src/index.ts`, add:

```ts
export * from './competitorReports.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the competitor_reports table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS competitor_reports'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/competitorReports.ts packages/db/src/index.ts packages/db/tests/competitorReports.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add competitor_reports table for weekly cycle storage"
```

---

### Task 5: SerpApi Google Search client (`serpapiSearch.ts`)

**Files:**
- Create: `mcp-server/src/serpapiSearch.ts`
- Create: `mcp-server/tests/serpapiSearch.test.ts`

**Interfaces:**
- Consumes: `requireEnv` (`./blob.js`).
- Produces: `SearchResultItem` (`{position, title, link, domain}`), `fetchSearchResults(query, num?): Promise<SearchResultItem[]>`. Consumed by Tasks 6, 9.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/serpapiSearch.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchSearchResults } from '../src/serpapiSearch';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SERPAPI_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('fetchSearchResults', () => {
  it('maps organic_results into SearchResultItem[] with a derived domain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [
          { position: 1, title: 'Sourdough 101', link: 'https://www.example-recipes.com/sourdough-101' },
          { position: 2, title: 'Kitchenware Roundup', link: 'https://gear.example.com/roundup' },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await fetchSearchResults('sourdough recipes');

    expect(result).toEqual([
      { position: 1, title: 'Sourdough 101', link: 'https://www.example-recipes.com/sourdough-101', domain: 'example-recipes.com' },
      { position: 2, title: 'Kitchenware Roundup', link: 'https://gear.example.com/roundup', domain: 'gear.example.com' },
    ]);
  });

  it('strips a leading www. from the derived domain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic_results: [{ position: 1, title: 'T', link: 'https://www.foo.com/x' }] }),
    }) as unknown as typeof fetch;

    const result = await fetchSearchResults('anything');
    expect(result[0].domain).toBe('foo.com');
  });

  it('sends the query, engine, and num as URL params', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return { ok: true, json: async () => ({ organic_results: [] }) };
    }) as unknown as typeof fetch;

    await fetchSearchResults('kitchenware affiliate roundup', 15);
    const params = new URL(capturedUrl).searchParams;
    expect(params.get('engine')).toBe('google');
    expect(params.get('q')).toBe('kitchenware affiliate roundup');
    expect(params.get('num')).toBe('15');
    expect(params.get('api_key')).toBe('test-key');
  });

  it('defaults num to 10', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return { ok: true, json: async () => ({ organic_results: [] }) };
    }) as unknown as typeof fetch;

    await fetchSearchResults('anything');
    expect(new URL(capturedUrl).searchParams.get('num')).toBe('10');
  });

  it('returns an empty array when organic_results is absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    expect(await fetchSearchResults('no results here')).toEqual([]);
  });

  it('throws when SERPAPI_KEY is not set', async () => {
    delete process.env.SERPAPI_KEY;
    await expect(fetchSearchResults('anything')).rejects.toThrow(/SERPAPI_KEY/);
  });

  it('throws with the query name when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(fetchSearchResults('rate limited query')).rejects.toThrow(/rate limited query/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/serpapiSearch.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `serpapiSearch.ts`**

`mcp-server/src/serpapiSearch.ts`:

```ts
import { requireEnv } from './blob.js';

const SERPAPI_URL = 'https://serpapi.com/search.json';

export interface SearchResultItem {
  position: number;
  title: string;
  link: string;
  domain: string;
}

interface SerpApiSearchResponse {
  organic_results?: { position: number; title: string; link: string }[];
}

function extractDomain(link: string): string {
  const hostname = new URL(link).hostname;
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

export async function fetchSearchResults(query: string, num = 10): Promise<SearchResultItem[]> {
  const apiKey = requireEnv('SERPAPI_KEY');

  const url = new URL(SERPAPI_URL);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(num));
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SerpApi search request failed for query "${query}": ${response.status}`);
  }

  const data = (await response.json()) as SerpApiSearchResponse;
  return (data.organic_results ?? []).map((r) => ({
    position: r.position,
    title: r.title,
    link: r.link,
    domain: extractDomain(r.link),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/serpapiSearch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/serpapiSearch.ts mcp-server/tests/serpapiSearch.test.ts
git commit -m "Add SerpApi Google Search client for competitor discovery and SEO tracking"
```

---

### Task 6: Discovery module (`competitorDiscovery.ts`) — Phase A

**Files:**
- Create: `mcp-server/src/competitorDiscovery.ts`
- Create: `mcp-server/tests/competitorDiscovery.test.ts`
- Modify: `mcp-server/package.json` (add `@lhr/db` and `pg` — this is the first task in `mcp-server` that imports from either; every later task in this plan that touches `mcp-server/src/` relies on both being wired here)

**Interfaces:**
- Consumes: `fetchSearchResults` (`./serpapiSearch.js`); `insertCandidateCompetitor` (`@lhr/db`); `type Pool` (`pg`).
- Produces: `DISCOVERY_QUERIES: readonly string[]`, `DiscoveryResult` (`{newCandidateDomains: string[]; failedQueries: string[]}`), `runDiscovery(pool): Promise<DiscoveryResult>`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/competitorDiscovery.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/serpapiSearch', () => ({ fetchSearchResults: vi.fn() }));
vi.mock('@lhr/db', () => ({ insertCandidateCompetitor: vi.fn() }));

const { fetchSearchResults } = await import('../src/serpapiSearch');
const { insertCandidateCompetitor } = await import('@lhr/db');
const { runDiscovery, DISCOVERY_QUERIES } = await import('../src/competitorDiscovery');

const pool = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DISCOVERY_QUERIES', () => {
  it('is a small curated, non-empty list', () => {
    expect(DISCOVERY_QUERIES.length).toBeGreaterThan(0);
    expect(DISCOVERY_QUERIES.length).toBeLessThanOrEqual(10);
  });
});

describe('runDiscovery', () => {
  it('runs one search per curated query and inserts each new domain as a candidate', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 1, title: 'T', link: 'https://a.com/x', domain: 'a.com' },
    ]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue({
      id: 1, domain: 'a.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    } as never);

    const result = await runDiscovery(pool);

    expect(fetchSearchResults).toHaveBeenCalledTimes(DISCOVERY_QUERIES.length);
    expect(insertCandidateCompetitor).toHaveBeenCalledWith(pool, 'a.com');
    expect(result.newCandidateDomains).toContain('a.com');
  });

  it('does not count a domain as newly discovered when it already existed (insert returns null)', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 1, title: 'T', link: 'https://already-tracked.com/x', domain: 'already-tracked.com' },
    ]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue(null);

    const result = await runDiscovery(pool);
    expect(result.newCandidateDomains).toEqual([]);
  });

  it('dedupes a domain seen across multiple queries within the same run', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 1, title: 'T', link: 'https://dupe.com/x', domain: 'dupe.com' },
    ]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue({
      id: 1, domain: 'dupe.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    } as never);

    await runDiscovery(pool);
    expect(insertCandidateCompetitor).toHaveBeenCalledTimes(1);
  });

  it('logs and skips a query whose SerpApi call fails, continuing with the rest', async () => {
    vi.mocked(fetchSearchResults)
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue([{ position: 1, title: 'T', link: 'https://ok.com/x', domain: 'ok.com' }]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue({
      id: 1, domain: 'ok.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    } as never);

    const result = await runDiscovery(pool);
    expect(result.failedQueries).toEqual([DISCOVERY_QUERIES[0]]);
    expect(result.newCandidateDomains).toContain('ok.com');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/competitorDiscovery.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `competitorDiscovery.ts`**

`mcp-server/src/competitorDiscovery.ts`:

```ts
import type { Pool } from 'pg';
import { fetchSearchResults } from './serpapiSearch.js';
import { insertCandidateCompetitor } from '@lhr/db';

// A small, curated, non-auto-expanding list of niche-discovery queries (spec §2 Phase A).
export const DISCOVERY_QUERIES: readonly string[] = [
  'gluten free recipe blog',
  'kitchenware affiliate roundup',
  'comfort food recipe blog',
  'best kitchen gadgets blog',
];

export interface DiscoveryResult {
  newCandidateDomains: string[];
  failedQueries: string[];
}

export async function runDiscovery(pool: Pool): Promise<DiscoveryResult> {
  const newCandidateDomains: string[] = [];
  const failedQueries: string[] = [];
  const seenThisRun = new Set<string>();

  for (const query of DISCOVERY_QUERIES) {
    let results;
    try {
      results = await fetchSearchResults(query);
    } catch (err) {
      console.error(`Discovery query "${query}" failed; skipping.`, err);
      failedQueries.push(query);
      continue;
    }

    for (const result of results) {
      if (seenThisRun.has(result.domain)) continue;
      seenThisRun.add(result.domain);

      const inserted = await insertCandidateCompetitor(pool, result.domain);
      if (inserted) {
        newCandidateDomains.push(result.domain);
      }
    }
  }

  return { newCandidateDomains, failedQueries };
}
```

- [ ] **Step 4: Wire `@lhr/db` and `pg` into `mcp-server`**

In `mcp-server/package.json`, add to `dependencies` (alphabetized among the existing entries):

```json
    "@lhr/db": "*",
    "pg": "^8.13.0",
```

Then:

```bash
npm install
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/competitorDiscovery.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/competitorDiscovery.ts mcp-server/tests/competitorDiscovery.test.ts mcp-server/package.json package-lock.json
git commit -m "Add competitor discovery from curated SerpApi search queries"
```

---

### Task 7: Content diffing module (`competitorContent.ts`)

**Files:**
- Create: `mcp-server/src/competitorContent.ts`
- Create: `mcp-server/tests/competitorContent.test.ts`

**Interfaces:**
- Produces: `CompetitorPost` (`{title, url, publishedAt}`), `ContentFetchSource` (`'rss' | 'html' | 'unparseable'`), `CompetitorContentResult`, `fetchCompetitorPosts(domain): Promise<CompetitorContentResult>`, `diffNewPosts(fetchedPosts, priorPosts): CompetitorPost[]`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/competitorContent.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchCompetitorPosts, diffNewPosts } from '../src/competitorContent';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const HOMEPAGE_WITH_FEED_LINK = `
<html><head>
<link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml" />
</head><body>homepage</body></html>
`;

const RSS_FEED = `<?xml version="1.0"?>
<rss><channel>
<item><title>Sourdough Focaccia</title><link>https://example-recipes.com/sourdough-focaccia</link><pubDate>Thu, 20 Aug 2026 00:00:00 GMT</pubDate></item>
<item><title><![CDATA[Air Fryer Salmon]]></title><link>https://example-recipes.com/air-fryer-salmon</link><pubDate>Thu, 13 Aug 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const HOMEPAGE_NO_FEED_WITH_POST_LINKS = `
<html><body>
<a href="/blog/sourdough-focaccia">Sourdough Focaccia, straight from the oven</a>
<a href="/about">About</a>
</body></html>
`;

describe('fetchCompetitorPosts', () => {
  it('prefers RSS: discovers the feed link on the homepage and parses items from it', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u === 'https://example-recipes.com') return { ok: true, text: async () => HOMEPAGE_WITH_FEED_LINK };
      if (u === 'https://example-recipes.com/feed.xml') return { ok: true, text: async () => RSS_FEED };
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('example-recipes.com');

    expect(result.source).toBe('rss');
    expect(result.posts).toEqual([
      { title: 'Sourdough Focaccia', url: 'https://example-recipes.com/sourdough-focaccia', publishedAt: 'Thu, 20 Aug 2026 00:00:00 GMT' },
      { title: 'Air Fryer Salmon', url: 'https://example-recipes.com/air-fryer-salmon', publishedAt: 'Thu, 13 Aug 2026 00:00:00 GMT' },
    ]);
  });

  it('falls back to HTML listing extraction when no feed link is present', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u === 'https://no-feed.com') return { ok: true, text: async () => HOMEPAGE_NO_FEED_WITH_POST_LINKS };
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('no-feed.com');

    expect(result.source).toBe('html');
    expect(result.posts).toEqual([
      { title: 'Sourdough Focaccia, straight from the oven', url: 'https://no-feed.com/blog/sourdough-focaccia', publishedAt: null },
    ]);
  });

  it('falls back to HTML when the discovered feed URL fails to fetch', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u === 'https://flaky-feed.com') return { ok: true, text: async () => HOMEPAGE_WITH_FEED_LINK.replace('example-recipes.com', 'flaky-feed.com') };
      if (u === 'https://flaky-feed.com/feed.xml') return { ok: false, status: 500 };
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('flaky-feed.com');
    expect(result.source).toBe('unparseable');
    expect(result.posts).toEqual([]);
  });

  it('returns unparseable, not a crash, when the homepage itself is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('down.com');
    expect(result).toEqual({ posts: [], source: 'unparseable' });
  });

  it('returns unparseable when neither RSS nor a parseable HTML listing is found', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html><body>Nothing here.</body></html>' }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('empty.com');
    expect(result).toEqual({ posts: [], source: 'unparseable' });
  });
});

describe('diffNewPosts', () => {
  it('returns only posts whose URL is not in the prior list', () => {
    const fetched = [
      { title: 'A', url: 'https://x.com/a', publishedAt: null },
      { title: 'B', url: 'https://x.com/b', publishedAt: null },
    ];
    const prior = [{ title: 'A', url: 'https://x.com/a', publishedAt: null }];
    expect(diffNewPosts(fetched, prior)).toEqual([{ title: 'B', url: 'https://x.com/b', publishedAt: null }]);
  });

  it('treats every fetched post as new when there is no prior list', () => {
    const fetched = [{ title: 'A', url: 'https://x.com/a', publishedAt: null }];
    expect(diffNewPosts(fetched, [])).toEqual(fetched);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/competitorContent.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `competitorContent.ts`**

`mcp-server/src/competitorContent.ts`:

```ts
export interface CompetitorPost {
  title: string;
  url: string;
  publishedAt: string | null;
}

export type ContentFetchSource = 'rss' | 'html' | 'unparseable';

export interface CompetitorContentResult {
  posts: CompetitorPost[];
  source: ContentFetchSource;
}

const MAX_HTML_CHARS = 200_000;

function stripCdata(text: string): string {
  const match = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : text;
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripCdata(match[1]).trim() : null;
}

function parseRssItems(xml: string): CompetitorPost[] {
  const itemBlocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const posts: CompetitorPost[] = [];
  for (const block of itemBlocks) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) {
      posts.push({ title, url: link, publishedAt: pubDate });
    }
  }
  return posts;
}

function discoverFeedUrl(homepageHtml: string, baseUrl: string): string | null {
  const linkTagMatch = homepageHtml.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
  if (!linkTagMatch) return null;
  const hrefMatch = linkTagMatch[0].match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) return null;
  try {
    return new URL(hrefMatch[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function parseHtmlListingFallback(html: string, baseUrl: string): CompetitorPost[] {
  const anchorMatches = html.match(/<a\s[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const posts: CompetitorPost[] = [];
  const seenUrls = new Set<string>();

  for (const anchor of anchorMatches) {
    const hrefMatch = anchor.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    let url: string;
    try {
      url = new URL(hrefMatch[1], baseUrl).toString();
    } catch {
      continue;
    }
    if (!/\/(20\d\d|blog|posts?|recipes?)\//i.test(url)) continue;

    const text = anchor.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 8) continue;
    if (seenUrls.has(url)) continue;

    seenUrls.add(url);
    posts.push({ title: text, url, publishedAt: null });
  }

  return posts;
}

export async function fetchCompetitorPosts(domain: string): Promise<CompetitorContentResult> {
  const baseUrl = `https://${domain}`;

  let homepageHtml: string;
  try {
    const homepageRes = await fetch(baseUrl);
    if (!homepageRes.ok) throw new Error(`status ${homepageRes.status}`);
    homepageHtml = (await homepageRes.text()).slice(0, MAX_HTML_CHARS);
  } catch {
    return { posts: [], source: 'unparseable' };
  }

  const feedUrl = discoverFeedUrl(homepageHtml, baseUrl);
  if (feedUrl) {
    try {
      const feedRes = await fetch(feedUrl);
      if (feedRes.ok) {
        const xml = await feedRes.text();
        const posts = parseRssItems(xml);
        if (posts.length > 0) {
          return { posts, source: 'rss' };
        }
      }
    } catch {
      // Fall through to the HTML fallback below.
    }
  }

  const htmlPosts = parseHtmlListingFallback(homepageHtml, baseUrl);
  if (htmlPosts.length > 0) {
    return { posts: htmlPosts, source: 'html' };
  }

  return { posts: [], source: 'unparseable' };
}

export function diffNewPosts(fetchedPosts: CompetitorPost[], priorPosts: CompetitorPost[]): CompetitorPost[] {
  const priorUrls = new Set(priorPosts.map((p) => p.url));
  return fetchedPosts.filter((p) => !priorUrls.has(p.url));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/competitorContent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/competitorContent.ts mcp-server/tests/competitorContent.test.ts
git commit -m "Add RSS-preferred, HTML-fallback competitor content diffing"
```

---

### Task 8: Monetization and design snapshot module (`competitorSnapshots.ts`)

**Files:**
- Create: `mcp-server/src/competitorSnapshots.ts`
- Create: `mcp-server/tests/competitorSnapshots.test.ts`

**Interfaces:**
- Consumes: `callOpenRouter` (`./openrouter.js`).
- Produces: `fetchHomepageText(domain): Promise<string>`, `summarizeMonetization(domain, pageText): Promise<string>`, `summarizeDesign(domain, pageText): Promise<string>`, `diffSnapshot(previous, current): Promise<string>`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/competitorSnapshots.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/openrouter', () => ({ callOpenRouter: vi.fn() }));
const { callOpenRouter } = await import('../src/openrouter');
const { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } = await import('../src/competitorSnapshots');

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchHomepageText', () => {
  it('strips tags, scripts, and styles, and collapses whitespace', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><head><style>.x{color:red}</style></head><body><script>track()</script><h1>Shop  the\nKitchen</h1></body></html>',
    }) as unknown as typeof fetch;

    const text = await fetchHomepageText('example.com');
    expect(text).toBe('Shop the Kitchen');
  });

  it('throws with the domain name when the fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    await expect(fetchHomepageText('down.com')).rejects.toThrow(/down\.com/);
  });
});

describe('summarizeMonetization', () => {
  it('calls the LLM with the domain and page text and returns its response', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('Sells a $40 cast-iron pan via Amazon affiliate links.');
    const result = await summarizeMonetization('example.com', 'Shop the Kitchen');
    expect(callOpenRouter).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('example.com') })]),
    );
    expect(result).toBe('Sells a $40 cast-iron pan via Amazon affiliate links.');
  });
});

describe('summarizeDesign', () => {
  it('calls the LLM with the domain and page text and returns its response', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('Grid homepage with a prominent shop CTA.');
    const result = await summarizeDesign('example.com', 'Shop the Kitchen');
    expect(result).toBe('Grid homepage with a prominent shop CTA.');
  });
});

describe('diffSnapshot', () => {
  it('labels the current snapshot as an initial snapshot when there is no prior one, without an LLM call', async () => {
    const result = await diffSnapshot(null, 'Sells a $40 cast-iron pan.');
    expect(result).toBe('Initial snapshot: Sells a $40 cast-iron pan.');
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('calls the LLM to describe the change between two snapshots', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('Added a new $25 spatula set to the shop.');
    const result = await diffSnapshot('Sells a $40 cast-iron pan.', 'Sells a $40 cast-iron pan and a $25 spatula set.');
    expect(callOpenRouter).toHaveBeenCalled();
    expect(result).toBe('Added a new $25 spatula set to the shop.');
  });

  it('can report no substantive change', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('No substantive change.');
    const result = await diffSnapshot('Sells cookware.', 'Sells cookware and kitchen gear.');
    expect(result).toBe('No substantive change.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/competitorSnapshots.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `competitorSnapshots.ts`**

`mcp-server/src/competitorSnapshots.ts`:

```ts
import { callOpenRouter } from './openrouter.js';

const MAX_TEXT_CHARS = 6000;

function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

export async function fetchHomepageText(domain: string): Promise<string> {
  const response = await fetch(`https://${domain}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch homepage for ${domain}: ${response.status}`);
  }
  return htmlToText(await response.text());
}

export async function summarizeMonetization(domain: string, pageText: string): Promise<string> {
  return callOpenRouter([
    {
      role: 'system',
      content:
        "You analyze a competitor recipe/kitchenware site's homepage text and produce a short, factual snapshot of its monetization and product strategy: what it sells or promotes, any visible price ranges, and any visible affiliate/ad programs or sponsorship disclosures. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

export async function summarizeDesign(domain: string, pageText: string): Promise<string> {
  return callOpenRouter([
    {
      role: 'system',
      content:
        "You analyze a competitor site's homepage text (tags stripped, so infer structure from headings, nav labels, and link text) and produce a short, factual description of its apparent layout, prominent calls-to-action, and visual/content style. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

export async function diffSnapshot(previous: string | null, current: string): Promise<string> {
  if (previous === null) {
    return `Initial snapshot: ${current}`;
  }
  return callOpenRouter([
    {
      role: 'system',
      content:
        'Given a previous snapshot and a current snapshot of the same thing, describe what substantively changed in 1-2 sentences. If the current snapshot is just a prose rephrasing of the same facts with no substantive change, respond exactly with "No substantive change."',
    },
    { role: 'user', content: `Previous snapshot:\n${previous}\n\nCurrent snapshot:\n${current}` },
  ]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/competitorSnapshots.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/competitorSnapshots.ts mcp-server/tests/competitorSnapshots.test.ts
git commit -m "Add LLM-driven monetization/design snapshot and diff module"
```

---

### Task 9: SEO signal tracking module (`competitorSeoTracking.ts`) — Phase C

**Files:**
- Create: `mcp-server/src/competitorSeoTracking.ts`
- Create: `mcp-server/tests/competitorSeoTracking.test.ts`

**Interfaces:**
- Consumes: `fetchSearchResults` (`./serpapiSearch.js`); `listCompetitorsByStatus`, `listKeywords`, `type SeoPositionEntry` (`@lhr/db`).
- Produces: `SeoTrackingResult` (`{positionsByCompetitorId: Map<number, SeoPositionEntry[]>; failedKeywords: string[]}`), `trackSeoPositions(pool): Promise<SeoTrackingResult>`. Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/competitorSeoTracking.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/serpapiSearch', () => ({ fetchSearchResults: vi.fn() }));
vi.mock('@lhr/db', () => ({ listCompetitorsByStatus: vi.fn(), listKeywords: vi.fn() }));

const { fetchSearchResults } = await import('../src/serpapiSearch');
const { listCompetitorsByStatus, listKeywords } = await import('@lhr/db');
const { trackSeoPositions } = await import('../src/competitorSeoTracking');

const pool = {} as never;

const competitorA = { id: 1, domain: 'a.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() };
const competitorB = { id: 2, domain: 'b.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCompetitorsByStatus).mockResolvedValue([competitorA, competitorB] as never);
});

describe('trackSeoPositions', () => {
  it('makes exactly one SerpApi call per keyword, regardless of tracked-competitor count', async () => {
    vi.mocked(listKeywords).mockResolvedValue([
      { id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() },
      { id: 2, keyword: 'best kitchenware sets', addedAt: new Date() },
    ] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([]);

    await trackSeoPositions(pool);
    expect(fetchSearchResults).toHaveBeenCalledTimes(2);
  });

  it('records the position when a tracked competitor domain appears in the results', async () => {
    vi.mocked(listKeywords).mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 3, title: 'T', link: 'https://a.com/x', domain: 'a.com' },
    ]);

    const result = await trackSeoPositions(pool);
    expect(result.positionsByCompetitorId.get(1)).toEqual([{ keyword: 'gluten free dinner recipes', position: 3 }]);
  });

  it('records position null when a tracked competitor domain does not appear in the results', async () => {
    vi.mocked(listKeywords).mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([{ position: 1, title: 'T', link: 'https://someone-else.com/x', domain: 'someone-else.com' }]);

    const result = await trackSeoPositions(pool);
    expect(result.positionsByCompetitorId.get(1)).toEqual([{ keyword: 'gluten free dinner recipes', position: null }]);
    expect(result.positionsByCompetitorId.get(2)).toEqual([{ keyword: 'gluten free dinner recipes', position: null }]);
  });

  it('skips a keyword whose SerpApi call fails and continues with the rest', async () => {
    vi.mocked(listKeywords).mockResolvedValue([
      { id: 1, keyword: 'fails', addedAt: new Date() },
      { id: 2, keyword: 'ok keyword', addedAt: new Date() },
    ] as never);
    vi.mocked(fetchSearchResults)
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce([{ position: 1, title: 'T', link: 'https://a.com/x', domain: 'a.com' }]);

    const result = await trackSeoPositions(pool);
    expect(result.failedKeywords).toEqual(['fails']);
    expect(result.positionsByCompetitorId.get(1)).toEqual([{ keyword: 'ok keyword', position: 1 }]);
  });

  it('returns an empty map when there are no tracked competitors', async () => {
    vi.mocked(listCompetitorsByStatus).mockResolvedValue([]);
    vi.mocked(listKeywords).mockResolvedValue([{ id: 1, keyword: 'anything', addedAt: new Date() }] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([]);

    const result = await trackSeoPositions(pool);
    expect(result.positionsByCompetitorId.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/competitorSeoTracking.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `competitorSeoTracking.ts`**

`mcp-server/src/competitorSeoTracking.ts`:

```ts
import type { Pool } from 'pg';
import { fetchSearchResults } from './serpapiSearch.js';
import { listCompetitorsByStatus, listKeywords, type SeoPositionEntry } from '@lhr/db';

export interface SeoTrackingResult {
  positionsByCompetitorId: Map<number, SeoPositionEntry[]>;
  failedKeywords: string[];
}

export async function trackSeoPositions(pool: Pool): Promise<SeoTrackingResult> {
  const tracked = await listCompetitorsByStatus(pool, 'tracked');
  const keywords = await listKeywords(pool);

  const positionsByCompetitorId = new Map<number, SeoPositionEntry[]>();
  for (const competitor of tracked) {
    positionsByCompetitorId.set(competitor.id, []);
  }

  const failedKeywords: string[] = [];

  for (const { keyword } of keywords) {
    let results;
    try {
      results = await fetchSearchResults(keyword);
    } catch (err) {
      console.error(`SEO keyword "${keyword}" SerpApi call failed; skipping.`, err);
      failedKeywords.push(keyword);
      continue;
    }

    for (const competitor of tracked) {
      const match = results.find((r) => r.domain === competitor.domain);
      const entry: SeoPositionEntry = { keyword, position: match ? match.position : null };
      positionsByCompetitorId.get(competitor.id)!.push(entry);
    }
  }

  return { positionsByCompetitorId, failedKeywords };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/competitorSeoTracking.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/competitorSeoTracking.ts mcp-server/tests/competitorSeoTracking.test.ts
git commit -m "Add SEO signal tracking: one SerpApi call per keyword, scanned for every tracked domain"
```

---

### Task 10: Weekly orchestration module (`analyzeCompetitors.ts`)

**Files:**
- Create: `mcp-server/src/analyzeCompetitors.ts`
- Create: `mcp-server/tests/analyzeCompetitors.test.ts`

**Interfaces:**
- Consumes: `runDiscovery` (`./competitorDiscovery.js`); `trackSeoPositions` (`./competitorSeoTracking.js`); `fetchCompetitorPosts`, `diffNewPosts`, `type CompetitorPost` (`./competitorContent.js`); `fetchHomepageText`, `summarizeMonetization`, `summarizeDesign`, `diffSnapshot` (`./competitorSnapshots.js`); `callOpenRouter` (`./openrouter.js`); `computeCycleId` (`./computeCycleId.js` — already exists in this worktree); `listCompetitorsByStatus`, `getLatestReport`, `insertCompetitorReport`, `type NewCompetitorReport`, `type SeoPositionEntry` (`@lhr/db`).
- Produces: `WeeklyCompetitorRunSummary`, `runWeeklyCompetitorAnalysis(pool): Promise<WeeklyCompetitorRunSummary>`. Consumed by Tasks 11, 12.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/analyzeCompetitors.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/competitorDiscovery', () => ({ runDiscovery: vi.fn() }));
vi.mock('../src/competitorSeoTracking', () => ({ trackSeoPositions: vi.fn() }));
vi.mock('../src/competitorContent', () => ({ fetchCompetitorPosts: vi.fn(), diffNewPosts: vi.fn() }));
vi.mock('../src/competitorSnapshots', () => ({
  fetchHomepageText: vi.fn(),
  summarizeMonetization: vi.fn(),
  summarizeDesign: vi.fn(),
  diffSnapshot: vi.fn(),
}));
vi.mock('../src/openrouter', () => ({ callOpenRouter: vi.fn() }));
vi.mock('@lhr/db', () => ({
  listCompetitorsByStatus: vi.fn(),
  getLatestReport: vi.fn(),
  insertCompetitorReport: vi.fn(),
}));

const { runDiscovery } = await import('../src/competitorDiscovery');
const { trackSeoPositions } = await import('../src/competitorSeoTracking');
const { fetchCompetitorPosts, diffNewPosts } = await import('../src/competitorContent');
const { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } = await import('../src/competitorSnapshots');
const { callOpenRouter } = await import('../src/openrouter');
const { listCompetitorsByStatus, getLatestReport, insertCompetitorReport } = await import('@lhr/db');
const { runWeeklyCompetitorAnalysis } = await import('../src/analyzeCompetitors');

const pool = {} as never;
const competitor = { id: 1, domain: 'a.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() };

function setHappyPathDefaults() {
  vi.mocked(runDiscovery).mockResolvedValue({ newCandidateDomains: [], failedQueries: [] });
  vi.mocked(trackSeoPositions).mockResolvedValue({ positionsByCompetitorId: new Map([[1, []]]), failedKeywords: [] });
  vi.mocked(listCompetitorsByStatus).mockResolvedValue([competitor] as never);
  vi.mocked(getLatestReport).mockResolvedValue(null);
  vi.mocked(fetchCompetitorPosts).mockResolvedValue({ posts: [], source: 'rss' });
  vi.mocked(diffNewPosts).mockReturnValue([]);
  vi.mocked(fetchHomepageText).mockResolvedValue('page text');
  vi.mocked(summarizeMonetization).mockResolvedValue('monetization snapshot');
  vi.mocked(summarizeDesign).mockResolvedValue('design snapshot');
  vi.mocked(diffSnapshot).mockResolvedValue('Initial snapshot: x');
  vi.mocked(callOpenRouter).mockResolvedValue('This week: nothing notable.');
  vi.mocked(insertCompetitorReport).mockImplementation(async (_pool, report) => ({ ...report, id: 1, generatedAt: new Date() }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyPathDefaults();
});

describe('runWeeklyCompetitorAnalysis', () => {
  it('runs discovery and SEO tracking exactly once for the whole cycle, not per competitor', async () => {
    await runWeeklyCompetitorAnalysis(pool);
    expect(runDiscovery).toHaveBeenCalledTimes(1);
    expect(trackSeoPositions).toHaveBeenCalledTimes(1);
  });

  it('writes one competitor_reports row per tracked competitor', async () => {
    const summary = await runWeeklyCompetitorAnalysis(pool);
    expect(insertCompetitorReport).toHaveBeenCalledTimes(1);
    expect(summary.reportsWritten).toBe(1);
  });

  it('produces an empty cycle (no reports, no error) when there are no tracked competitors', async () => {
    vi.mocked(listCompetitorsByStatus).mockResolvedValue([]);
    const summary = await runWeeklyCompetitorAnalysis(pool);
    expect(summary.reportsWritten).toBe(0);
    expect(insertCompetitorReport).not.toHaveBeenCalled();
  });

  it('still writes a report when content fetching throws, noting the content dimension as unreachable', async () => {
    vi.mocked(fetchCompetitorPosts).mockRejectedValue(new Error('network error'));

    await runWeeklyCompetitorAnalysis(pool);

    expect(insertCompetitorReport).toHaveBeenCalledTimes(1);
    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.newContent).toEqual([]);
    const synthesisCall = vi.mocked(callOpenRouter).mock.calls[0][0];
    expect(synthesisCall.some((m) => m.content.includes('unreachable this cycle'))).toBe(true);
  });

  it('still writes a report when the homepage fetch for snapshots throws, noting monetization/design as unreachable', async () => {
    vi.mocked(fetchHomepageText).mockRejectedValue(new Error('network error'));

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.monetizationSnapshot).toBe('unreachable this cycle');
    expect(report.designSnapshot).toBe('unreachable this cycle');
  });

  it('still writes a report with a placeholder summary when the synthesis LLM call fails', async () => {
    vi.mocked(callOpenRouter).mockRejectedValue(new Error('LLM down'));

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.summary).toBe('[Summary generation failed this cycle]');
  });

  it('carries this cycle\'s SEO positions from the shared Phase-C scan into the report', async () => {
    vi.mocked(trackSeoPositions).mockResolvedValue({
      positionsByCompetitorId: new Map([[1, [{ keyword: 'gluten free dinner recipes', position: 4 }]]]),
      failedKeywords: [],
    });

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.seoPositions).toEqual([{ keyword: 'gluten free dinner recipes', position: 4 }]);
  });

  it('reports discovery and SEO failures on the run summary', async () => {
    vi.mocked(runDiscovery).mockResolvedValue({ newCandidateDomains: ['x.com'], failedQueries: ['q1'] });
    vi.mocked(trackSeoPositions).mockResolvedValue({ positionsByCompetitorId: new Map([[1, []]]), failedKeywords: ['k1'] });

    const summary = await runWeeklyCompetitorAnalysis(pool);

    expect(summary.discoveredCandidates).toBe(1);
    expect(summary.failedDiscoveryQueries).toEqual(['q1']);
    expect(summary.failedSeoKeywords).toEqual(['k1']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/analyzeCompetitors.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `analyzeCompetitors.ts`**

`mcp-server/src/analyzeCompetitors.ts`:

```ts
import type { Pool } from 'pg';
import { runDiscovery } from './competitorDiscovery.js';
import { trackSeoPositions } from './competitorSeoTracking.js';
import { fetchCompetitorPosts, diffNewPosts, type CompetitorPost } from './competitorContent.js';
import { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } from './competitorSnapshots.js';
import { callOpenRouter } from './openrouter.js';
import { computeCycleId } from './computeCycleId.js';
import {
  listCompetitorsByStatus,
  getLatestReport,
  insertCompetitorReport,
  type Competitor,
  type NewCompetitorReport,
  type SeoPositionEntry,
} from '@lhr/db';

const SYNTHESIS_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';
const UNREACHABLE_NOTE = 'unreachable this cycle';

export interface WeeklyCompetitorRunSummary {
  cycleId: string;
  discoveredCandidates: number;
  failedDiscoveryQueries: string[];
  failedSeoKeywords: string[];
  reportsWritten: number;
}

async function buildCompetitorReport(
  pool: Pool,
  competitor: Pick<Competitor, 'id' | 'domain'>,
  cycleId: string,
  seoPositions: SeoPositionEntry[],
): Promise<NewCompetitorReport> {
  const priorReport = await getLatestReport(pool, competitor.id);

  let newContent: CompetitorPost[] = [];
  let contentDescriptor: string;
  try {
    const { posts, source } = await fetchCompetitorPosts(competitor.domain);
    if (source === 'unparseable') {
      contentDescriptor = UNREACHABLE_NOTE;
    } else {
      newContent = diffNewPosts(posts, priorReport?.newContent ?? []);
      contentDescriptor = newContent.length > 0 ? JSON.stringify(newContent) : 'no new content this cycle';
    }
  } catch {
    contentDescriptor = UNREACHABLE_NOTE;
  }

  let monetizationSnapshot: string;
  let designSnapshot: string;
  try {
    const pageText = await fetchHomepageText(competitor.domain);
    const [monetization, design] = await Promise.all([
      summarizeMonetization(competitor.domain, pageText),
      summarizeDesign(competitor.domain, pageText),
    ]);
    monetizationSnapshot = await diffSnapshot(priorReport?.monetizationSnapshot ?? null, monetization);
    designSnapshot = await diffSnapshot(priorReport?.designSnapshot ?? null, design);
  } catch {
    monetizationSnapshot = UNREACHABLE_NOTE;
    designSnapshot = UNREACHABLE_NOTE;
  }

  let summary: string;
  try {
    summary = await callOpenRouter([
      {
        role: 'system',
        content:
          'Synthesize this week\'s changes for a tracked competitor into a short "what changed this week" summary (2-4 sentences), covering new content, SEO positions, monetization, and design where notable. Skip dimensions with no notable change.',
      },
      {
        role: 'user',
        content: [
          `Competitor: ${competitor.domain}`,
          `New content: ${contentDescriptor}`,
          `SEO positions: ${JSON.stringify(seoPositions)}`,
          `Monetization change: ${monetizationSnapshot}`,
          `Design change: ${designSnapshot}`,
        ].join('\n'),
      },
    ]);
  } catch {
    summary = SYNTHESIS_FAILURE_PLACEHOLDER;
  }

  return {
    competitorId: competitor.id,
    cycleId,
    newContent,
    seoPositions,
    monetizationSnapshot,
    designSnapshot,
    summary,
  };
}

export async function runWeeklyCompetitorAnalysis(pool: Pool): Promise<WeeklyCompetitorRunSummary> {
  const discovery = await runDiscovery(pool);
  const seoTracking = await trackSeoPositions(pool);
  const tracked = await listCompetitorsByStatus(pool, 'tracked');
  const cycleId = computeCycleId(new Date());

  let reportsWritten = 0;
  for (const competitor of tracked) {
    const seoPositions = seoTracking.positionsByCompetitorId.get(competitor.id) ?? [];
    const report = await buildCompetitorReport(pool, competitor, cycleId, seoPositions);
    await insertCompetitorReport(pool, report);
    reportsWritten += 1;
  }

  return {
    cycleId,
    discoveredCandidates: discovery.newCandidateDomains.length,
    failedDiscoveryQueries: discovery.failedQueries,
    failedSeoKeywords: seoTracking.failedKeywords,
    reportsWritten,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/analyzeCompetitors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/analyzeCompetitors.ts mcp-server/tests/analyzeCompetitors.test.ts
git commit -m "Add weekly competitor analysis orchestration with per-dimension partial-failure handling"
```

---

### Task 11: Job-contract entry point (`analyzeCompetitors()`)

**Amendment context:** per the 2026-08-25 execution-model amendment (Global Constraints), scheduling is no longer a local CLI script. This task instead adds a zero-argument, `Job`-contract-shaped entry point to the *same* file Task 10 created, so a future orchestrator sub-project can import and call it directly, in-process. `JobResult` mirrors `packages/jobs/src/types.ts`'s contract from `2026-08-25-local-orchestrator-design.md` §2 exactly (`{status: 'success'|'partial'|'failure', summary: string, details?: Record<string, unknown>}`), defined locally here rather than imported, since `@lhr/jobs` isn't built yet in this worktree — the same reasoning already applied to `CompetitorPost`/`CompetitorPostSummary` in Task 10.

**Files:**
- Modify: `mcp-server/src/analyzeCompetitors.ts` (add `JobResult`, `summaryToJobResult`, `analyzeCompetitors`)
- Create: `mcp-server/tests/analyzeCompetitorsJob.test.ts`

**Interfaces:**
- Consumes: `runWeeklyCompetitorAnalysis`, `type WeeklyCompetitorRunSummary` (same file, from Task 10).
- Produces: `JobResult`, `summaryToJobResult(summary): JobResult`, `analyzeCompetitors(): Promise<JobResult>`. `analyzeCompetitors` is the function name a future orchestrator's registry will import — do not rename it.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/analyzeCompetitorsJob.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summaryToJobResult } from '../src/analyzeCompetitors';
import type { WeeklyCompetitorRunSummary } from '../src/analyzeCompetitors';

const baseSummary: WeeklyCompetitorRunSummary = {
  cycleId: '2026-W35',
  discoveredCandidates: 2,
  failedDiscoveryQueries: [],
  failedSeoKeywords: [],
  reportsWritten: 3,
};

describe('summaryToJobResult', () => {
  it('reports success when nothing failed', () => {
    const result = summaryToJobResult(baseSummary);
    expect(result.status).toBe('success');
    expect(result.summary).toContain('2026-W35');
    expect(result.summary).toContain('3');
  });

  it('reports partial when a discovery query failed', () => {
    const result = summaryToJobResult({ ...baseSummary, failedDiscoveryQueries: ['gluten free recipe blog'] });
    expect(result.status).toBe('partial');
  });

  it('reports partial when an SEO keyword lookup failed', () => {
    const result = summaryToJobResult({ ...baseSummary, failedSeoKeywords: ['gluten free dinner recipes'] });
    expect(result.status).toBe('partial');
  });

  it('includes the run counts in details', () => {
    const result = summaryToJobResult(baseSummary);
    expect(result.details).toEqual({
      discoveredCandidates: 2,
      failedDiscoveryQueries: [],
      failedSeoKeywords: [],
      reportsWritten: 3,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/analyzeCompetitorsJob.test.ts
```

Expected: FAIL — `summaryToJobResult` doesn't exist yet.

- [ ] **Step 3: Add the Job-contract entry point to `analyzeCompetitors.ts`**

At the top of `mcp-server/src/analyzeCompetitors.ts`, change the `pg` import to also bring in the `Pool` value (not just the type):

```ts
import { Pool } from 'pg';
```

(This replaces the existing `import type { Pool } from 'pg';` line from Task 10 — the type-only import becomes a value + type import since this task calls `new Pool(...)`.)

At the end of the file, append:

```ts
// Mirrors packages/jobs/src/types.ts's JobResult contract (spec
// 2026-08-25-local-orchestrator-design.md §2). Defined locally — not
// imported from @lhr/jobs — because that package doesn't exist in this
// worktree yet; the shape matches exactly, so it satisfies the real `Job`
// type structurally once the orchestrator sub-project wires this in.
export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
}

export function summaryToJobResult(summary: WeeklyCompetitorRunSummary): JobResult {
  const degraded = summary.failedDiscoveryQueries.length > 0 || summary.failedSeoKeywords.length > 0;
  return {
    status: degraded ? 'partial' : 'success',
    summary: `Cycle ${summary.cycleId}: wrote ${summary.reportsWritten} report(s), ${summary.discoveredCandidates} new candidate(s) discovered.`,
    details: {
      discoveredCandidates: summary.discoveredCandidates,
      failedDiscoveryQueries: summary.failedDiscoveryQueries,
      failedSeoKeywords: summary.failedSeoKeywords,
      reportsWritten: summary.reportsWritten,
    },
  };
}

export async function analyzeCompetitors(): Promise<JobResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL env var is required.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const summary = await runWeeklyCompetitorAnalysis(pool);
    return summaryToJobResult(summary);
  } finally {
    await pool.end();
  }
}
```

Per the orchestrator spec §5, an uncaught exception here (e.g. missing `DATABASE_URL`, or a `runWeeklyCompetitorAnalysis` failure not already caught internally) is expected to propagate — the future orchestrator catches it at the call site and records `status='failure'` itself. Do not wrap this in a try/catch that swallows the error into a `JobResult` of your own; the `finally` block only ensures the pool is closed either way.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/analyzeCompetitorsJob.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the full `mcp-server` suite once**

```bash
cd mcp-server && npx vitest run
```

Expected: PASS — confirms the `Pool` import change didn't break Task 10's existing tests (they mock `@lhr/db` and the collaborator modules, not `pg`, so this should be a no-op for them).

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/analyzeCompetitors.ts mcp-server/tests/analyzeCompetitorsJob.test.ts
git commit -m "Add analyzeCompetitors() Job-contract entry point for the future orchestrator"
```

---

### Task 12: Integration test for the full weekly run

**Files:**
- Create: `mcp-server/tests/integration/analyzeCompetitors.test.ts`

**Interfaces:**
- Consumes: `runWeeklyCompetitorAnalysis`, `analyzeCompetitors` (`../../src/analyzeCompetitors.js`, real, unmocked) together with every real collaborator module they call (`competitorDiscovery.ts`, `competitorSeoTracking.ts`, `competitorContent.ts`, `competitorSnapshots.ts`). Only the true I/O boundaries are mocked: `global.fetch` (SerpApi + competitor site fetches), `../../src/openrouter.js` (`callOpenRouter`), `pg` (`Pool`, for the `analyzeCompetitors` cases only), and `@lhr/db`.

This test complements Task 10's unit test (which mocks every collaborator module) by exercising the real discovery/content/snapshot/SEO-tracking logic together, mirroring the existing `tests/integration/generateWeeklyVariantRecipe.test.ts` pattern in this codebase. It also covers Task 11's `analyzeCompetitors()` Job-contract wrapper end-to-end, since that wrapper's own unit test (Task 11) only covers the pure `summaryToJobResult` mapping and can't exercise the real pipeline without duplicating this file's mocks.

- [ ] **Step 1: Write the failing test**

`mcp-server/tests/integration/analyzeCompetitors.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

process.env.SERPAPI_KEY = 'test-key';
process.env.OPENROUTER_API_KEY = 'test-key';

vi.mock('../../src/openrouter', () => ({ callOpenRouter: vi.fn().mockResolvedValue('Nothing notable this week.') }));

interface FakeDbState {
  competitors: { id: number; domain: string; name: string | null; status: string; discoveredAt: Date; approvedAt: Date | null }[];
  reports: { id: number; competitorId: number; cycleId: string; newContent: unknown; seoPositions: unknown; monetizationSnapshot: string; designSnapshot: string; summary: string }[];
  keywords: { id: number; keyword: string; addedAt: Date }[];
  nextCompetitorId: number;
  nextReportId: number;
}

let state: FakeDbState;

vi.mock('@lhr/db', () => ({
  insertCandidateCompetitor: vi.fn(async (_pool: unknown, domain: string) => {
    if (state.competitors.some((c) => c.domain === domain)) return null;
    const row = { id: state.nextCompetitorId++, domain, name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null };
    state.competitors.push(row);
    return row;
  }),
  listCompetitorsByStatus: vi.fn(async (_pool: unknown, status: string) => state.competitors.filter((c) => c.status === status)),
  listKeywords: vi.fn(async () => state.keywords),
  getLatestReport: vi.fn(async (_pool: unknown, competitorId: number) => {
    const forCompetitor = state.reports.filter((r) => r.competitorId === competitorId);
    return forCompetitor.length > 0 ? forCompetitor[forCompetitor.length - 1] : null;
  }),
  insertCompetitorReport: vi.fn(async (_pool: unknown, report: Record<string, unknown>) => {
    const row = { ...report, id: state.nextReportId++ } as FakeDbState['reports'][number];
    state.reports.push(row);
    return { ...row, generatedAt: new Date() };
  }),
}));

const fakePool = { end: async () => {} };
vi.mock('pg', () => ({ Pool: vi.fn().mockImplementation(() => fakePool) }));

const { runWeeklyCompetitorAnalysis, analyzeCompetitors } = await import('../../src/analyzeCompetitors');

const originalFetch = global.fetch;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  state = {
    competitors: [
      { id: 1, domain: 'reliable-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
      { id: 2, domain: 'flaky-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ],
    reports: [],
    keywords: [{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }],
    nextCompetitorId: 3,
    nextReportId: 1,
  };
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('analyzeCompetitors (Job-contract entry point, integration)', () => {
  it('constructs its own pool from DATABASE_URL, delegates to the real pipeline, and closes the pool', async () => {
    process.env.DATABASE_URL = 'postgres://test/db';
    state.competitors = [];
    state.keywords = [];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organic_results: [] }) }) as unknown as typeof fetch;

    const result = await analyzeCompetitors();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('wrote 0 report(s)');
  });

  it('throws when DATABASE_URL is missing, rather than swallowing the error into a failure JobResult', async () => {
    delete process.env.DATABASE_URL;
    await expect(analyzeCompetitors()).rejects.toThrow(/DATABASE_URL/);
  });
});

describe('runWeeklyCompetitorAnalysis (integration)', () => {
  it('writes a full report for a reachable competitor and a partial report for an unreachable one, without crashing the run', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();

      if (u.includes('serpapi.com')) {
        return { ok: true, json: async () => ({ organic_results: [{ position: 2, title: 'T', link: 'https://reliable-recipes.com/x' }] }) };
      }
      if (u === 'https://reliable-recipes.com') {
        return { ok: true, text: async () => '<html><body><h1>Shop the Kitchen</h1></body></html>' };
      }
      if (u === 'https://flaky-recipes.com') {
        throw new Error('connection refused');
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const summary = await runWeeklyCompetitorAnalysis({} as never);

    expect(summary.reportsWritten).toBe(2);
    expect(state.reports).toHaveLength(2);

    const reliableReport = state.reports.find((r) => r.competitorId === 1)!;
    expect(reliableReport.monetizationSnapshot).not.toBe('unreachable this cycle');

    const flakyReport = state.reports.find((r) => r.competitorId === 2)!;
    expect(flakyReport.monetizationSnapshot).toBe('unreachable this cycle');
    expect(flakyReport.designSnapshot).toBe('unreachable this cycle');
    expect(flakyReport.summary).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd mcp-server && npx vitest run tests/integration/analyzeCompetitors.test.ts
```

Expected: FAIL initially if any of Tasks 5-11's modules aren't wired correctly — otherwise this test should already pass once those tasks are done, since it exercises only real, already-implemented modules against a fresh mocked I/O boundary. Treat any failure here as a signal to re-check the implementations from Tasks 5-11, not as license to change this test's expectations to match a bug.

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd mcp-server && npx vitest run tests/integration/analyzeCompetitors.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/tests/integration/analyzeCompetitors.test.ts
git commit -m "Add integration test for the full weekly competitor-analysis run"
```

---

### Task 13: `/competitors` page — tracked list and latest reports

**Files:**
- Create: `apps/lhr-office/src/pages/competitors/index.astro`
- Create: `apps/lhr-office/tests/competitorsPage.test.ts`
- Modify: `apps/lhr-office/src/pages/index.astro` (add a nav link to `/competitors/`)

**Interfaces:**
- Consumes: `requireAdminSession` (`../../lib/auth.js`); `getPool` (`../../lib/db.js`); `listCompetitorsByStatus`, `getLatestReport`, `type Competitor`, `type CompetitorReport` (`@lhr/db`).

- [ ] **Step 1: Write the failing test**

`apps/lhr-office/tests/competitorsPage.test.ts`:

```ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { listCompetitorsByStatus: vi.fn(), getLatestReport: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { default: CompetitorsPage } = await import('../src/pages/competitors/index.astro');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('/competitors', () => {
  it('renders each tracked competitor with its latest report summary', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      { id: 1, domain: 'reliable-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ]);
    dbMock.getLatestReport.mockResolvedValue({
      id: 1, competitorId: 1, cycleId: '2026-W35', generatedAt: new Date('2026-08-24T00:00:00Z'),
      newContent: [], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y',
      summary: 'Published one new post this week.',
    });

    const container = await AstroContainer.create();
    const html = await container.renderToString(CompetitorsPage);

    expect(html).toContain('reliable-recipes.com');
    expect(html).toContain('Published one new post this week.');
  });

  it('shows a placeholder when a tracked competitor has no report yet', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      { id: 2, domain: 'brand-new.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ]);
    dbMock.getLatestReport.mockResolvedValue(null);

    const container = await AstroContainer.create();
    const html = await container.renderToString(CompetitorsPage);

    expect(html).toContain('brand-new.com');
    expect(html).toContain('No report yet');
  });

  it('is gated by requireAdminSession', async () => {
    const container = await AstroContainer.create();
    dbMock.listCompetitorsByStatus.mockResolvedValue([]);
    await container.renderToString(CompetitorsPage);
    expect(authMock.requireAdminSession).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/lhr-office && npx vitest run tests/competitorsPage.test.ts
```

Expected: FAIL — the page doesn't exist yet.

- [ ] **Step 3: Implement `/competitors/index.astro`**

`apps/lhr-office/src/pages/competitors/index.astro`:

```astro
---
import { requireAdminSession } from '../../lib/auth.js';
import { getPool } from '../../lib/db.js';
import { listCompetitorsByStatus, getLatestReport, type CompetitorReport } from '@lhr/db';

const authResult = await requireAdminSession(Astro);
if ('response' in authResult) {
  return authResult.response;
}

const pool = getPool();
const tracked = await listCompetitorsByStatus(pool, 'tracked');
const reports = new Map<number, CompetitorReport | null>();
for (const competitor of tracked) {
  reports.set(competitor.id, await getLatestReport(pool, competitor.id));
}
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Competitors — LHR Office</title>
    <style>
      body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
      .cycle { font-size: 0.85rem; color: #666; }
      .empty { color: #888; font-style: italic; }
      nav a { margin-right: 1rem; }
    </style>
  </head>
  <body>
    <nav>
      <a href="/">Home</a>
      <a href="/competitors/candidates/">Candidates</a>
      <a href="/competitors/keywords/">SEO keywords</a>
    </nav>
    <h1>Tracked competitors</h1>
    {tracked.length === 0 && <p class="empty">No tracked competitors yet — approve a candidate first.</p>}
    {tracked.map((competitor) => {
      const report = reports.get(competitor.id);
      return (
        <div class="card">
          <h2>{competitor.name ?? competitor.domain}</h2>
          <p class="cycle">{competitor.domain}{report ? ` — cycle ${report.cycleId}` : ''}</p>
          {report ? <p>{report.summary}</p> : <p class="empty">No report yet — the next weekly cycle will generate one.</p>}
        </div>
      );
    })}
  </body>
</html>
```

- [ ] **Step 4: Add a nav link from the root page**

In `apps/lhr-office/src/pages/index.astro`, add a link alongside the existing ones:

```astro
      <li><a href="/competitors/">Competitor analysis</a></li>
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/lhr-office && npx vitest run tests/competitorsPage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/src/pages/competitors/index.astro apps/lhr-office/src/pages/index.astro apps/lhr-office/tests/competitorsPage.test.ts
git commit -m "Add /competitors page listing tracked competitors and their latest reports"
```

---

### Task 14: `/competitors/candidates` page and approve/reject API routes

**Files:**
- Create: `apps/lhr-office/src/pages/competitors/candidates/index.astro`
- Create: `apps/lhr-office/src/pages/api/competitors/[id]/[action].ts`
- Create: `apps/lhr-office/tests/competitorsCandidatesPage.test.ts`
- Create: `apps/lhr-office/tests/competitorsCandidatesApi.test.ts`

**Interfaces:**
- Consumes: `requireAdminSession` (`../../lib/auth.js` / `../../../../lib/auth.js`); `getPool` (`../../lib/db.js` / `../../../../lib/db.js`); `listCompetitorsByStatus`, `setCompetitorStatus` (`@lhr/db`).
- Produces: `POST /api/competitors/{id}/approve`, `POST /api/competitors/{id}/reject`.

- [ ] **Step 1: Write the failing API test**

`apps/lhr-office/tests/competitorsCandidatesApi.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { setCompetitorStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/competitors/[id]/[action]');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(id: string, action: string) {
  return { params: { id, action }, cookies: {}, redirect: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/competitors/[id]/[action]', () => {
  it('approves (tracks) a candidate on action=approve', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('5', 'approve'));
    expect(dbMock.setCompetitorStatus).toHaveBeenCalledWith(mockPool, 5, 'tracked');
    expect(res.status).toBe(200);
  });

  it('rejects a candidate on action=reject', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('5', 'reject'));
    expect(dbMock.setCompetitorStatus).toHaveBeenCalledWith(mockPool, 5, 'rejected');
    expect(res.status).toBe(200);
  });

  it('returns 400 on an unknown action without touching the database', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('5', 'delete'));
    expect(res.status).toBe(400);
    expect(dbMock.setCompetitorStatus).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-numeric id', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('abc', 'approve'));
    expect(res.status).toBe(400);
  });

  it('returns 401 and does not mutate when there is no valid admin session', async () => {
    authMock.requireAdminSession.mockResolvedValue({ response: new Response(null, { status: 302 }) });
    const res = await POST(makeContext('5', 'approve'));
    expect(res.status).toBe(401);
    expect(dbMock.setCompetitorStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing page test**

`apps/lhr-office/tests/competitorsCandidatesPage.test.ts`:

```ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { listCompetitorsByStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { default: CandidatesPage } = await import('../src/pages/competitors/candidates/index.astro');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('/competitors/candidates', () => {
  it('renders each pending candidate with approve/reject controls', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      { id: 3, domain: 'new-candidate.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null },
    ]);

    const container = await AstroContainer.create();
    const html = await container.renderToString(CandidatesPage);

    expect(html).toContain('new-candidate.com');
    expect(html).toContain('data-action="approve"');
    expect(html).toContain('data-action="reject"');
  });

  it('shows an empty state when there are no pending candidates', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([]);
    const container = await AstroContainer.create();
    const html = await container.renderToString(CandidatesPage);
    expect(html).toContain('No pending candidates');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/competitorsCandidatesPage.test.ts tests/competitorsCandidatesApi.test.ts
```

Expected: FAIL — neither the page nor the API route exists yet.

- [ ] **Step 4: Implement the API route**

`apps/lhr-office/src/pages/api/competitors/[id]/[action].ts`:

```ts
import type { APIContext } from 'astro';
import { requireAdminSession } from '../../../../lib/auth.js';
import { getPool } from '../../../../lib/db.js';
import { setCompetitorStatus } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context as never);
  if ('response' in authResult) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid competitor id' }), { status: 400 });
  }

  const action = context.params.action;
  if (action !== 'approve' && action !== 'reject') {
    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
  }

  await setCompetitorStatus(getPool(), id, action === 'approve' ? 'tracked' : 'rejected');
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 5: Implement the page**

`apps/lhr-office/src/pages/competitors/candidates/index.astro`:

```astro
---
import { requireAdminSession } from '../../../lib/auth.js';
import { getPool } from '../../../lib/db.js';
import { listCompetitorsByStatus } from '@lhr/db';

const authResult = await requireAdminSession(Astro);
if ('response' in authResult) {
  return authResult.response;
}

const candidates = await listCompetitorsByStatus(getPool(), 'candidate');
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Competitor candidates — LHR Office</title>
    <style>
      body { font-family: sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; }
      .actions button { font-size: 1rem; padding: 0.5rem 1rem; margin-left: 0.5rem; cursor: pointer; }
      .approve { background: #16a34a; color: white; border: none; border-radius: 4px; }
      .reject { background: #dc2626; color: white; border: none; border-radius: 4px; }
      .card.gone { display: none; }
      nav a { margin-right: 1rem; }
    </style>
  </head>
  <body>
    <nav>
      <a href="/competitors/">Tracked</a>
      <a href="/competitors/keywords/">SEO keywords</a>
    </nav>
    <h1>Discovered candidates</h1>
    {candidates.length === 0 && <p>No pending candidates right now.</p>}
    {candidates.map((c) => (
      <div class="card" id={`candidate-${c.id}`}>
        <span>{c.domain}</span>
        <div class="actions">
          <button class="approve" data-id={c.id} data-action="approve">Track</button>
          <button class="reject" data-id={c.id} data-action="reject">Reject</button>
        </div>
      </div>
    ))}
    <script>
      document.querySelectorAll('button[data-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.getAttribute('data-id');
          const action = button.getAttribute('data-action');
          button.setAttribute('disabled', 'true');
          const res = await fetch(`/api/competitors/${id}/${action}`, { method: 'POST' });
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
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/competitorsCandidatesPage.test.ts tests/competitorsCandidatesApi.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/lhr-office/src/pages/competitors/candidates/index.astro apps/lhr-office/src/pages/api/competitors apps/lhr-office/tests/competitorsCandidatesPage.test.ts apps/lhr-office/tests/competitorsCandidatesApi.test.ts
git commit -m "Add /competitors/candidates approval page and approve/reject API route"
```

---

### Task 15: `/competitors/keywords` page and add/remove API routes

**Files:**
- Create: `apps/lhr-office/src/pages/competitors/keywords/index.astro`
- Create: `apps/lhr-office/src/pages/api/competitors/keywords/add.ts`
- Create: `apps/lhr-office/src/pages/api/competitors/keywords/[id]/remove.ts`
- Create: `apps/lhr-office/tests/competitorsKeywordsPage.test.ts`
- Create: `apps/lhr-office/tests/competitorsKeywordsApi.test.ts`

**Interfaces:**
- Consumes: `requireAdminSession` (`../../lib/auth.js` / `../../../../lib/auth.js` / `../../../../../lib/auth.js`); `getPool` (equivalent depths); `listKeywords`, `addKeyword`, `removeKeyword` (`@lhr/db`).
- Produces: `POST /api/competitors/keywords/add`, `POST /api/competitors/keywords/{id}/remove`.

- [ ] **Step 1: Write the failing API test**

`apps/lhr-office/tests/competitorsKeywordsApi.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { addKeyword: vi.fn(), removeKeyword: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST: addPOST } = await import('../src/pages/api/competitors/keywords/add');
const { POST: removePOST } = await import('../src/pages/api/competitors/keywords/[id]/remove');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeAddContext(keyword: string) {
  const form = new FormData();
  form.set('keyword', keyword);
  return { request: new Request('http://localhost/api/competitors/keywords/add', { method: 'POST', body: form }), cookies: {} } as never;
}

function makeRemoveContext(id: string) {
  return { params: { id }, cookies: {} } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('POST /api/competitors/keywords/add', () => {
  it('adds a non-empty keyword', async () => {
    dbMock.addKeyword.mockResolvedValue({ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() });
    const res = await addPOST(makeAddContext('gluten free dinner recipes'));
    expect(dbMock.addKeyword).toHaveBeenCalledWith(mockPool, 'gluten free dinner recipes');
    expect(res.status).toBe(200);
  });

  it('returns 400 for an empty keyword without calling the database', async () => {
    const res = await addPOST(makeAddContext('   '));
    expect(res.status).toBe(400);
    expect(dbMock.addKeyword).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no valid admin session', async () => {
    authMock.requireAdminSession.mockResolvedValue({ response: new Response(null, { status: 302 }) });
    const res = await addPOST(makeAddContext('anything'));
    expect(res.status).toBe(401);
    expect(dbMock.addKeyword).not.toHaveBeenCalled();
  });
});

describe('POST /api/competitors/keywords/[id]/remove', () => {
  it('removes a keyword by id', async () => {
    const res = await removePOST(makeRemoveContext('7'));
    expect(dbMock.removeKeyword).toHaveBeenCalledWith(mockPool, 7);
    expect(res.status).toBe(200);
  });

  it('returns 400 on a non-numeric id', async () => {
    const res = await removePOST(makeRemoveContext('abc'));
    expect(res.status).toBe(400);
    expect(dbMock.removeKeyword).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing page test**

`apps/lhr-office/tests/competitorsKeywordsPage.test.ts`:

```ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { listKeywords: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { default: KeywordsPage } = await import('../src/pages/competitors/keywords/index.astro');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('/competitors/keywords', () => {
  it('renders the keyword list with remove controls and an add form', async () => {
    dbMock.listKeywords.mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }]);

    const container = await AstroContainer.create();
    const html = await container.renderToString(KeywordsPage);

    expect(html).toContain('gluten free dinner recipes');
    expect(html).toContain('data-action="remove"');
    expect(html).toContain('<form');
  });

  it('shows an empty state when there are no keywords yet', async () => {
    dbMock.listKeywords.mockResolvedValue([]);
    const container = await AstroContainer.create();
    const html = await container.renderToString(KeywordsPage);
    expect(html).toContain('No SEO keywords yet');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/competitorsKeywordsPage.test.ts tests/competitorsKeywordsApi.test.ts
```

Expected: FAIL — nothing exists yet.

- [ ] **Step 4: Implement the API routes**

`apps/lhr-office/src/pages/api/competitors/keywords/add.ts`:

```ts
import type { APIContext } from 'astro';
import { requireAdminSession } from '../../../../lib/auth.js';
import { getPool } from '../../../../lib/db.js';
import { addKeyword } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context as never);
  if ('response' in authResult) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const form = await context.request.formData();
  const keyword = String(form.get('keyword') ?? '').trim();
  if (!keyword) {
    return new Response(JSON.stringify({ error: 'Keyword must not be empty' }), { status: 400 });
  }

  const created = await addKeyword(getPool(), keyword);
  return new Response(JSON.stringify(created), { status: 200 });
}
```

`apps/lhr-office/src/pages/api/competitors/keywords/[id]/remove.ts`:

```ts
import type { APIContext } from 'astro';
import { requireAdminSession } from '../../../../../lib/auth.js';
import { getPool } from '../../../../../lib/db.js';
import { removeKeyword } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context as never);
  if ('response' in authResult) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return new Response(JSON.stringify({ error: 'Invalid keyword id' }), { status: 400 });
  }

  await removeKeyword(getPool(), id);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

- [ ] **Step 5: Implement the page**

`apps/lhr-office/src/pages/competitors/keywords/index.astro`:

```astro
---
import { requireAdminSession } from '../../../lib/auth.js';
import { getPool } from '../../../lib/db.js';
import { listKeywords } from '@lhr/db';

const authResult = await requireAdminSession(Astro);
if ('response' in authResult) {
  return authResult.response;
}

const keywords = await listKeywords(getPool());
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SEO keywords — LHR Office</title>
    <style>
      body { font-family: sans-serif; max-width: 560px; margin: 2rem auto; padding: 0 1rem; }
      .row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee; }
      .row.gone { display: none; }
      button { cursor: pointer; }
      .remove { background: #dc2626; color: white; border: none; border-radius: 4px; padding: 0.3rem 0.6rem; }
      form.add-form { margin-top: 1.5rem; display: flex; gap: 0.5rem; }
      form.add-form input { flex: 1; padding: 0.5rem; }
      nav a { margin-right: 1rem; }
    </style>
  </head>
  <body>
    <nav>
      <a href="/competitors/">Tracked</a>
      <a href="/competitors/candidates/">Candidates</a>
    </nav>
    <h1>SEO keywords</h1>
    <div id="keyword-list">
      {keywords.length === 0 && <p id="empty-state">No SEO keywords yet — add one below.</p>}
      {keywords.map((k) => (
        <div class="row" id={`keyword-${k.id}`}>
          <span>{k.keyword}</span>
          <button class="remove" data-id={k.id} data-action="remove">Remove</button>
        </div>
      ))}
    </div>
    <form class="add-form" id="add-keyword-form">
      <input type="text" name="keyword" placeholder="e.g. gluten free dinner recipes" required />
      <button type="submit">Add</button>
    </form>
    <script>
      document.querySelectorAll('button[data-action="remove"]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.getAttribute('data-id');
          button.setAttribute('disabled', 'true');
          const res = await fetch(`/api/competitors/keywords/${id}/remove`, { method: 'POST' });
          if (res.ok) {
            document.getElementById(`keyword-${id}`)?.classList.add('gone');
          } else {
            button.removeAttribute('disabled');
          }
        });
      });

      document.getElementById('add-keyword-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target as HTMLFormElement;
        const res = await fetch('/api/competitors/keywords/add', { method: 'POST', body: new FormData(form) });
        if (res.ok) {
          window.location.reload();
        } else {
          const body = await res.json().catch(() => ({}));
          alert(`Failed: ${body.error ?? res.statusText}`);
        }
      });
    </script>
  </body>
</html>
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/competitorsKeywordsPage.test.ts tests/competitorsKeywordsApi.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the full `apps/lhr-office` suite and build**

```bash
cd apps/lhr-office && npx vitest run && npm run build
```

Expected: every test in the app passes; the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/lhr-office/src/pages/competitors/keywords apps/lhr-office/src/pages/api/competitors/keywords apps/lhr-office/tests/competitorsKeywordsPage.test.ts apps/lhr-office/tests/competitorsKeywordsApi.test.ts
git commit -m "Add /competitors/keywords management page and add/remove API routes"
```

---

## Final Verification

- [ ] Run the full test suite from the repo root and confirm everything passes:

```bash
npm run build --workspace=@lhr/db
cd packages/db && npx vitest run && cd ../..
cd mcp-server && npx vitest run && cd ..
cd apps/lhr-office && npx vitest run && npm run build && cd ../..
```

- [ ] Manually verify with a real dev database (needs a real `DATABASE_URL`, `SERPAPI_KEY`, and `OPENROUTER_API_KEY`):

```bash
cd packages/db && npm run db:migrate
cd ../../apps/lhr-office && npm run dev
```

Log in (using an admin created via the trends-watcher plan's `create-office-admin` script), visit `/competitors/keywords/` and add a keyword, visit `/competitors/candidates/` (empty until a discovery run has happened), then invoke the pipeline by hand once — since Task 11 replaced the CLI script with a Job-contract entry point, there is no `npm run` command for this until the orchestrator sub-project wires up its Vercel Cron endpoint; call it directly with `tsx -e`:

```bash
cd mcp-server && DATABASE_URL="$DATABASE_URL" SERPAPI_KEY="$SERPAPI_KEY" OPENROUTER_API_KEY="$OPENROUTER_API_KEY" npx tsx -e "import('./src/analyzeCompetitors.js').then(m => m.analyzeCompetitors()).then(r => console.log(JSON.stringify(r, null, 2)))"
```

Confirm candidates appear on `/competitors/candidates/`, approve one, re-run the command above, and confirm a report appears on `/competitors/`.
