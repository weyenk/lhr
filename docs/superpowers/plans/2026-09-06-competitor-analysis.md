# Weekly Competitor Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly competitor-analysis job — discovery of candidate competitor domains, per-tracked-competitor content/SEO/monetization/design analysis, and a "what changed this week" summary — registered with the already-shipped shared orchestrator, with its review UI living on the existing `/status` dashboard.

**Architecture:** One new file, `apps/lhr-office/src/competitorAnalysis.ts`, exports `analyzeCompetitors(): Promise<JobResult>` and does everything: runs a small curated set of SerpApi discovery queries once per cycle, tracks SEO keyword positions once per cycle (one SerpApi call per keyword, not per keyword-per-competitor), and for each `tracked` competitor diffs new content (via a sibling `competitorContent.ts` module), refreshes LLM-written monetization/design snapshots (via `@lhr/llm`), and synthesizes a per-competitor summary — mirroring `trendsWatcher.ts`'s shape exactly (a single job file with its logic inline, backed by one focused SerpApi-client sibling file and one comprehensive test file exercising the whole job through its public entry point, nothing more). Storage is three new tables in the already-shared `@lhr/db` (`competitors`, `competitor_seo_keywords`, `competitor_reports`), each with a plain `Queryable`-based CRUD module following `trendSeedTopics.ts`'s exact pattern. Review UI is three new sections on the existing single `/status` page (`statusPage.ts`) with new POST action routes on `server.ts`, following the exact pattern already used for affiliate candidates and trend seed topics — no new page tree, no new auth mechanism. The orchestrator itself (due-check scheduling, overlap guard, run history, the "Run now" button that gives the author a real one-command way to validate this before merge per Constitution rule 7) already exists and needs zero new code — registering the job in `apps/lhr-office/src/registry.ts` is the entire integration surface.

**Tech Stack:** TypeScript (strict), `Queryable` (a minimal `{query()}` interface from `@lhr/db`, backed by `pg.Pool` via `getPool()`), native `fetch` with `AbortSignal.timeout` (SerpApi + competitor site fetches — no new HTTP client dependency), `@lhr/llm`'s `callLLM` (already has its own timeout/retry/multi-model-fallback — no local LLM-call wrapper needed), regex-based RSS/HTML extraction (no new parsing dependency), Express (`apps/lhr-office/src/server.ts`), Vitest + `supertest`.

**Spec:** [docs/superpowers/specs/active/2026-09-06-competitor-analysis-design.md](../specs/active/2026-09-06-competitor-analysis-design.md) — a 2026-09-06 redesign superseding the original 2026-08-24 draft, which was built against infrastructure (a separate Astro app, per-admin accounts, `packages/jobs`' registry living inside that package) that never actually shipped. This redesign targets the shared orchestrator, `@lhr/db`, `@lhr/llm`, and `apps/lhr-office` exactly as they exist on `main` today (verified directly against the merged code, not against any design doc, since three sibling sub-projects each ended up somewhat different from their own specs by the time they shipped). Every section below is quoted or paraphrased from that spec so no separate lookup is required to execute this plan.

## Global Constraints

- **This targets current `main`, not any stale branch.** If executing this plan from a worktree whose branch predates PRs #58-68, fast-forward it to `origin/main` first (`git merge origin/main --ff-only` from a clean tree) — those PRs are what actually built `@lhr/jobs`, `@lhr/db`'s current shape, `@lhr/llm`, and `apps/lhr-office` as an Express app. Nothing in this plan pulls infrastructure from a sibling branch; it all already exists on `main`.
- **No dedicated admin page tree.** Every review action (approve/reject a discovered competitor, add/remove an SEO keyword, view the latest reports) lives as a new section on the single existing `/status` page, gated by the same `requireStatusAuth` Basic Auth middleware every other section already uses. Do not create `.astro` pages, a new Astro app, or a new auth mechanism — `apps/lhr-office` is a plain Express server now.
- **`@lhr/db` functions take an explicit `Queryable` as their first parameter** (not a raw `pg.Pool`, and never a module-level singleton) — mirrors every existing module (`trendSeedTopics.ts`, `candidates.ts`, `trendsReports.ts`), which is what keeps every module mockable in tests. Only the top-level `analyzeCompetitors()` job function calls `getPool()` itself, exactly like `sourceWeeklyTrends()` does.
- **Naming collision to avoid from the start:** `packages/db/src/index.ts` re-exports every module with `export *`, and `trendsReports.ts` already exports a function named `listRecentReports`. This plan's equivalent function is named `listRecentCompetitorReports` from the very first task — do not name it `listRecentReports` and discover the collision later (a prior attempt at this exact feature did, and had to rename it mid-implementation).
- **Storage vs. diff correctness (the single most important behavioral rule in this plan, learned the hard way on a prior attempt at this feature).** A per-cycle *change description* must never be persisted into a column the next cycle reads back as its baseline:
  - `competitor_reports.new_content` stores genuinely-new posts, diffed against the union of previously-seen post URLs across the last several cycles' `new_content` (via `listRecentCompetitorReports`, not just the single most recent row) — a single prior row's own `new_content` is only that cycle's delta, not everything known so far, so diffing against it alone re-flags old posts as new after any quiet week.
  - `competitor_reports.monetization_snapshot` / `design_snapshot` store the actual CURRENT snapshot (this cycle's LLM-written description of the site as it is now) — never the LLM-written *change description* between cycles. The change description is computed too (a separate LLM call, diffing this cycle's snapshot against the prior cycle's stored snapshot) but is used only locally, to feed that cycle's final synthesis summary — it is never written back into the snapshot columns.
- **Partial reports, never a lost cycle:** a competitor's site being unreachable notes `"unreachable this cycle"` for the affected dimension(s) rather than blocking other competitors' reports or the whole run. A SerpApi failure on a discovery query or an SEO keyword is logged and skipped, not fatal to the cycle. An LLM synthesis failure for one competitor still writes that competitor's report row, with `summary` set to the literal placeholder `"[Summary generation failed this cycle]"`.
- **`analyzeCompetitors()` fails fast on missing configuration** (`SERPAPI_KEY`, `OPENROUTER_API_KEY` — the latter required transitively by `@lhr/llm`) rather than letting every discovery query and keyword lookup individually fail and report a confusing `'partial'` status forever — mirrors `sourceWeeklyTrends()`'s own fail-fast checks exactly.
- **Every outbound fetch carries a request timeout** (`AbortSignal.timeout(10_000)`) — SerpApi calls, competitor homepage fetches, competitor RSS feed fetches — so one slow or hanging competitor site can't stall the whole orchestrator invocation past its function budget. `callLLM` already bounds its own requests; nothing extra is needed there.
- **No new environment variables.** `SERPAPI_KEY` and `OPENROUTER_API_KEY` are already in `.env.example` and already required by the trends watcher; this feature reuses both. No `.env.example` or `docs/DEPLOYMENT.md` changes are needed.
- **Cycle IDs are a plain date string**, matching `sourceWeeklyTrends()`'s own convention exactly: `new Date().toISOString().slice(0, 10)` (e.g. `'2026-09-06'`) — not an ISO week identifier, and not a dedicated helper module. Simpler, and consistent with the one sibling job that already ships this pattern.
- **Discovery re-insertion of an already-`tracked`/`rejected` domain is a safe no-op** via the `UNIQUE (domain)` constraint on `competitors`, exactly like `trend_seed_topics`'s `ON CONFLICT` pattern.
- **No tracked competitors yet:** the per-competitor analysis loop and the SEO scan simply produce no reports — not an error state, just an empty cycle, exactly like `sourceWeeklyTrends()` behaves with zero curated topics.

---

### Task 1: `competitors` table — schema and CRUD

**Files:**
- Modify: `packages/db/src/schema.sql` (append `competitors` table)
- Create: `packages/db/src/competitors.ts`
- Create: `packages/db/tests/competitors.test.ts`
- Modify: `packages/db/src/index.ts` (export the new module)

**Interfaces:**
- Produces: `type CompetitorStatus = 'candidate' | 'tracked' | 'rejected'`, `Competitor`, `insertCandidateCompetitor(db, domain, name?): Promise<Competitor | null>` (returns `null` when the domain already exists — the safe no-op), `listCompetitorsByStatus(db, status): Promise<Competitor[]>`, `setCompetitorStatus(db, id, status: 'tracked' | 'rejected'): Promise<void>`. Consumed by Task 6 (discovery, SEO tracking, the analysis loop) and Task 9 (the `/status` approve/reject routes).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/competitors.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  insertCandidateCompetitor,
  listCompetitorsByStatus,
  setCompetitorStatus,
} from '../src/competitors';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const competitorRow = {
  id: 1,
  domain: 'example-recipes.com',
  name: null,
  status: 'candidate',
  discovered_at: new Date('2026-09-06T00:00:00Z'),
  approved_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCandidateCompetitor', () => {
  it('inserts a new domain as a candidate and returns it', async () => {
    const db = mockDb([competitorRow]);
    const result = await insertCandidateCompetitor(db as never, 'example-recipes.com');
    expect(db.query).toHaveBeenCalledWith(
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
    const db = mockDb([{ ...competitorRow, name: 'Example Recipes' }]);
    await insertCandidateCompetitor(db as never, 'example-recipes.com', 'Example Recipes');
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['example-recipes.com', 'Example Recipes']);
  });

  it('returns null when the domain already exists (safe no-op)', async () => {
    const db = mockDb([]);
    expect(await insertCandidateCompetitor(db as never, 'already-tracked.com')).toBeNull();
  });
});

describe('listCompetitorsByStatus', () => {
  it('queries by status, ordered by domain', async () => {
    const db = mockDb([{ ...competitorRow, status: 'tracked' }]);
    const result = await listCompetitorsByStatus(db as never, 'tracked');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY domain ASC'), ['tracked']);
    expect(result[0].status).toBe('tracked');
  });
});

describe('setCompetitorStatus', () => {
  it('sets approved_at when approving to tracked', async () => {
    const db = mockDb();
    await setCompetitorStatus(db as never, 1, 'tracked');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'tracked'"), [1]);
    expect(db.query.mock.calls[0][0]).toContain('approved_at = now()');
  });

  it('does not touch approved_at when rejecting', async () => {
    const db = mockDb();
    await setCompetitorStatus(db as never, 1, 'rejected');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("status = 'rejected'"), [1]);
    expect(db.query.mock.calls[0][0]).not.toContain('approved_at');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/competitors.test.ts
```

Expected: FAIL — `../src/competitors` does not exist yet.

- [ ] **Step 3: Append the schema**

In `packages/db/src/schema.sql`, append:

```sql

CREATE TABLE IF NOT EXISTS competitors (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',  -- 'candidate' | 'tracked' | 'rejected'
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
```

- [ ] **Step 4: Implement `competitors.ts`**

`packages/db/src/competitors.ts`:

```ts
import type { Queryable } from './client.js';

export type CompetitorStatus = 'candidate' | 'tracked' | 'rejected';

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discoveredAt: Date;
  approvedAt: Date | null;
}

type CompetitorRow = {
  id: number;
  domain: string;
  name: string | null;
  status: CompetitorStatus;
  discovered_at: Date;
  approved_at: Date | null;
};

function mapRow(row: CompetitorRow): Competitor {
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
  db: Queryable,
  domain: string,
  name: string | null = null,
): Promise<Competitor | null> {
  const result = await db.query<CompetitorRow>(
    `INSERT INTO competitors (domain, name) VALUES ($1, $2) ON CONFLICT (domain) DO NOTHING RETURNING *`,
    [domain, name],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listCompetitorsByStatus(db: Queryable, status: CompetitorStatus): Promise<Competitor[]> {
  const result = await db.query<CompetitorRow>(
    `SELECT * FROM competitors WHERE status = $1 ORDER BY domain ASC`,
    [status],
  );
  return result.rows.map(mapRow);
}

export async function setCompetitorStatus(db: Queryable, id: number, status: 'tracked' | 'rejected'): Promise<void> {
  if (status === 'tracked') {
    await db.query(`UPDATE competitors SET status = 'tracked', approved_at = now() WHERE id = $1`, [id]);
  } else {
    await db.query(`UPDATE competitors SET status = 'rejected' WHERE id = $1`, [id]);
  }
}
```

- [ ] **Step 5: Export it**

In `packages/db/src/index.ts`, add:

```ts
export * from './competitors.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS (all of `competitors.test.ts` and every pre-existing test).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/competitors.ts packages/db/src/index.ts packages/db/tests/competitors.test.ts
git commit -m "Add competitors table with candidate/tracked/rejected lifecycle"
```

---

### Task 2: `competitor_seo_keywords` table — schema and CRUD

**Files:**
- Modify: `packages/db/src/schema.sql` (append `competitor_seo_keywords` table)
- Create: `packages/db/src/competitorSeoKeywords.ts`
- Create: `packages/db/tests/competitorSeoKeywords.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `CompetitorSeoKeyword`, `addKeyword(db, keyword): Promise<CompetitorSeoKeyword>` (idempotent — re-adding an existing keyword returns the existing row rather than erroring), `removeKeyword(db, id): Promise<void>`, `listKeywords(db): Promise<CompetitorSeoKeyword[]>`. Consumed by Task 6 (SEO tracking) and Task 9 (the `/status` add/remove routes).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/competitorSeoKeywords.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { addKeyword, removeKeyword, listKeywords } from '../src/competitorSeoKeywords';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const keywordRow = { id: 1, keyword: 'gluten free dinner recipes', added_at: new Date('2026-09-06T00:00:00Z') };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addKeyword', () => {
  it('inserts a new keyword and returns it', async () => {
    const db = mockDb([keywordRow]);
    const result = await addKeyword(db as never, 'gluten free dinner recipes');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (keyword) DO UPDATE'),
      ['gluten free dinner recipes'],
    );
    expect(result).toEqual({ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at });
  });

  it('is idempotent — re-adding an existing keyword still returns a row, not an error', async () => {
    const db = mockDb([keywordRow]);
    await expect(addKeyword(db as never, 'gluten free dinner recipes')).resolves.toBeDefined();
  });
});

describe('removeKeyword', () => {
  it('deletes the keyword row', async () => {
    const db = mockDb();
    await removeKeyword(db as never, 1);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM competitor_seo_keywords'), [1]);
  });
});

describe('listKeywords', () => {
  it('lists keywords ordered alphabetically', async () => {
    const db = mockDb([keywordRow]);
    const result = await listKeywords(db as never);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY keyword ASC'));
    expect(result).toEqual([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: keywordRow.added_at }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/competitorSeoKeywords.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Append the schema**

In `packages/db/src/schema.sql`, append:

```sql

CREATE TABLE IF NOT EXISTS competitor_seo_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Implement `competitorSeoKeywords.ts`**

`packages/db/src/competitorSeoKeywords.ts`:

```ts
import type { Queryable } from './client.js';

export interface CompetitorSeoKeyword {
  id: number;
  keyword: string;
  addedAt: Date;
}

type CompetitorSeoKeywordRow = {
  id: number;
  keyword: string;
  added_at: Date;
};

function mapRow(row: CompetitorSeoKeywordRow): CompetitorSeoKeyword {
  return { id: row.id, keyword: row.keyword, addedAt: row.added_at };
}

export async function addKeyword(db: Queryable, keyword: string): Promise<CompetitorSeoKeyword> {
  const result = await db.query<CompetitorSeoKeywordRow>(
    `INSERT INTO competitor_seo_keywords (keyword)
     VALUES ($1)
     ON CONFLICT (keyword) DO UPDATE SET keyword = EXCLUDED.keyword
     RETURNING *`,
    [keyword],
  );
  return mapRow(result.rows[0]);
}

export async function removeKeyword(db: Queryable, id: number): Promise<void> {
  await db.query(`DELETE FROM competitor_seo_keywords WHERE id = $1`, [id]);
}

export async function listKeywords(db: Queryable): Promise<CompetitorSeoKeyword[]> {
  const result = await db.query<CompetitorSeoKeywordRow>(`SELECT * FROM competitor_seo_keywords ORDER BY keyword ASC`);
  return result.rows.map(mapRow);
}
```

- [ ] **Step 5: Export it**

In `packages/db/src/index.ts`, add:

```ts
export * from './competitorSeoKeywords.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/competitorSeoKeywords.ts packages/db/src/index.ts packages/db/tests/competitorSeoKeywords.test.ts
git commit -m "Add competitor_seo_keywords table with idempotent add/remove"
```

---

### Task 3: `competitor_reports` table — schema and CRUD

**Files:**
- Modify: `packages/db/src/schema.sql` (append `competitor_reports` table)
- Create: `packages/db/src/competitorReports.ts`
- Create: `packages/db/tests/competitorReports.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `CompetitorPostSummary` (`{title, url, publishedAt}`), `SeoPositionEntry` (`{keyword, position}`), `NewCompetitorReport`, `CompetitorReport`, `insertCompetitorReport(db, report): Promise<CompetitorReport>`, `listRecentCompetitorReports(db, competitorId, limit?): Promise<CompetitorReport[]>` (most-recent-first; see the Global Constraints naming note — deliberately not `listRecentReports`, which `trendsReports.ts` already exports). Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/competitorReports.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertCompetitorReport, listRecentCompetitorReports, type NewCompetitorReport } from '../src/competitorReports';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewCompetitorReport = {
  competitorId: 1,
  cycleId: '2026-09-06',
  newContent: [{ title: 'Sourdough Focaccia', url: 'https://example-recipes.com/sourdough-focaccia', publishedAt: '2026-09-01' }],
  seoPositions: [{ keyword: 'gluten free dinner recipes', position: 4 }],
  monetizationSnapshot: 'Sells a $40 cast-iron pan; runs Amazon affiliate links in most posts.',
  designSnapshot: 'Grid homepage, prominent "Shop the kitchen" CTA above the fold.',
  summary: 'Published one new post this week; no monetization or design changes.',
};

const reportRow = {
  id: 1,
  competitor_id: 1,
  cycle_id: '2026-09-06',
  generated_at: new Date('2026-09-06T00:00:00Z'),
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
    const db = mockDb([reportRow]);
    const result = await insertCompetitorReport(db as never, newReport);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO competitor_reports'),
      [
        1,
        '2026-09-06',
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

describe('listRecentCompetitorReports', () => {
  it('queries by competitor, most recent first, respecting the limit', async () => {
    const db = mockDb([reportRow]);
    const result = await listRecentCompetitorReports(db as never, 1, 5);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC'), [1, 5]);
    expect(result).toHaveLength(1);
  });

  it('defaults the limit to 10', async () => {
    const db = mockDb([]);
    await listRecentCompetitorReports(db as never, 1);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [1, 10]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/competitorReports.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Append the schema**

In `packages/db/src/schema.sql`, append:

```sql

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
```

- [ ] **Step 4: Implement `competitorReports.ts`**

`packages/db/src/competitorReports.ts`:

```ts
import type { Queryable } from './client.js';

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

type CompetitorReportRow = {
  id: number;
  competitor_id: number;
  cycle_id: string;
  generated_at: Date;
  new_content: CompetitorPostSummary[];
  seo_positions: SeoPositionEntry[];
  monetization_snapshot: string;
  design_snapshot: string;
  summary: string;
};

function mapRow(row: CompetitorReportRow): CompetitorReport {
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

export async function insertCompetitorReport(db: Queryable, report: NewCompetitorReport): Promise<CompetitorReport> {
  const result = await db.query<CompetitorReportRow>(
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
  );
  return mapRow(result.rows[0]);
}

export async function listRecentCompetitorReports(db: Queryable, competitorId: number, limit = 10): Promise<CompetitorReport[]> {
  const result = await db.query<CompetitorReportRow>(
    `SELECT * FROM competitor_reports WHERE competitor_id = $1 ORDER BY generated_at DESC LIMIT $2`,
    [competitorId, limit],
  );
  return result.rows.map(mapRow);
}
```

- [ ] **Step 5: Export it**

In `packages/db/src/index.ts`, add:

```ts
export * from './competitorReports.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS (every test in `packages/db`, confirming no collision with `trendsReports.ts`'s `listRecentReports`).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/competitorReports.ts packages/db/src/index.ts packages/db/tests/competitorReports.test.ts
git commit -m "Add competitor_reports table for weekly cycle storage"
```

---

### Task 4: SerpApi Google Search client (`serpapiSearch.ts`)

**Files:**
- Create: `apps/lhr-office/src/serpapiSearch.ts`
- Create: `apps/lhr-office/tests/serpapiSearch.test.ts`

**Interfaces:**
- Produces: `SearchResultItem` (`{position, title, link, domain}`), `fetchSearchResults(query, num?): Promise<SearchResultItem[]>`. Consumed by Task 6. This wraps SerpApi's regular `google` engine — distinct from `serpapiTrends.ts`'s `google_trends`/trending-now engines, which are unrelated to this feature.

- [ ] **Step 1: Write the failing tests**

`apps/lhr-office/tests/serpapiSearch.test.ts`:

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

  it('sends the query, engine, and num as URL params, and a request timeout', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedInit = init;
      return { ok: true, json: async () => ({ organic_results: [] }) };
    }) as unknown as typeof fetch;

    await fetchSearchResults('kitchenware affiliate roundup', 15);
    const params = new URL(capturedUrl).searchParams;
    expect(params.get('engine')).toBe('google');
    expect(params.get('q')).toBe('kitchenware affiliate roundup');
    expect(params.get('num')).toBe('15');
    expect(params.get('api_key')).toBe('test-key');
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
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
cd apps/lhr-office && npx vitest run tests/serpapiSearch.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `serpapiSearch.ts`**

`apps/lhr-office/src/serpapiSearch.ts`:

```ts
const SERPAPI_URL = 'https://serpapi.com/search.json';
const REQUEST_TIMEOUT_MS = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

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

  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
cd apps/lhr-office && npx vitest run tests/serpapiSearch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/serpapiSearch.ts apps/lhr-office/tests/serpapiSearch.test.ts
git commit -m "Add SerpApi Google Search client for competitor discovery and SEO tracking"
```

---

### Task 5: Content diffing module (`competitorContent.ts`)

**Files:**
- Create: `apps/lhr-office/src/competitorContent.ts`
- Create: `apps/lhr-office/tests/competitorContent.test.ts`

**Interfaces:**
- Produces: `CompetitorPost` (`{title, url, publishedAt}`), `ContentFetchSource` (`'rss' | 'html' | 'unparseable'`), `CompetitorContentResult`, `fetchCompetitorPosts(domain): Promise<CompetitorContentResult>`, `diffNewPosts(fetchedPosts, priorPosts): CompetitorPost[]`. Consumed by Task 6. This module has no `Queryable`/`@lhr/db` dependency — it's a pure fetch+regex module, matching `serpapiTrends.ts`'s own standalone shape.

- [ ] **Step 1: Write the failing tests**

`apps/lhr-office/tests/competitorContent.test.ts`:

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

  it('sends a request timeout on both the homepage and feed fetches', async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      seenSignals.push(init?.signal ?? undefined);
      const u = url.toString();
      if (u === 'https://timed.com') return { ok: true, text: async () => HOMEPAGE_WITH_FEED_LINK.replace('example-recipes.com', 'timed.com') };
      return { ok: true, text: async () => RSS_FEED };
    }) as unknown as typeof fetch;

    await fetchCompetitorPosts('timed.com');
    expect(seenSignals).toHaveLength(2);
    for (const signal of seenSignals) expect(signal).toBeInstanceOf(AbortSignal);
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
cd apps/lhr-office && npx vitest run tests/competitorContent.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `competitorContent.ts`**

`apps/lhr-office/src/competitorContent.ts`:

```ts
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HTML_CHARS = 200_000;

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
    const homepageRes = await fetch(baseUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!homepageRes.ok) throw new Error(`status ${homepageRes.status}`);
    homepageHtml = (await homepageRes.text()).slice(0, MAX_HTML_CHARS);
  } catch {
    return { posts: [], source: 'unparseable' };
  }

  const feedUrl = discoverFeedUrl(homepageHtml, baseUrl);
  if (feedUrl) {
    try {
      const feedRes = await fetch(feedUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
cd apps/lhr-office && npx vitest run tests/competitorContent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/competitorContent.ts apps/lhr-office/tests/competitorContent.test.ts
git commit -m "Add RSS-preferred, HTML-fallback competitor content diffing"
```

---

### Task 6: The job itself — `competitorAnalysis.ts`

**Files:**
- Create: `apps/lhr-office/src/competitorAnalysis.ts`
- Create: `apps/lhr-office/tests/competitorAnalysis.test.ts`

**Interfaces:**
- Consumes: `fetchSearchResults` (`./serpapiSearch.js`, Task 4); `fetchCompetitorPosts`, `diffNewPosts`, `type CompetitorPost` (`./competitorContent.js`, Task 5); `getPool`, `insertCandidateCompetitor`, `listCompetitorsByStatus`, `listKeywords`, `listRecentCompetitorReports`, `insertCompetitorReport`, `type Competitor`, `type SeoPositionEntry` (`@lhr/db`, Tasks 1-3); `callLLM` (`@lhr/llm`); `type JobResult` (`@lhr/jobs`).
- Produces: `analyzeCompetitors(): Promise<JobResult>`. Consumed by Task 7 (registry).

This is the one file that does everything else: discovery, SEO tracking, per-competitor content/snapshot/synthesis, and the top-level `analyzeCompetitors()` assembly — mirroring `trendsWatcher.ts`'s shape exactly (one job file, its logic inline as unexported helper functions, one exported entry point, one comprehensive test file exercising only that entry point). Because the internal helpers aren't exported (same as `trendsWatcher.ts`'s `suggestAdjacentTopics`/`synthesizeSummary`), this task is not split into smaller TDD increments the way Tasks 1-5 were — write the whole test file first, watch it fail, then write the whole implementation.

- [ ] **Step 1: Write the failing tests**

`apps/lhr-office/tests/competitorAnalysis.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const dbMock = {
  getPool: vi.fn(() => ({})),
  insertCandidateCompetitor: vi.fn(),
  listCompetitorsByStatus: vi.fn(),
  listKeywords: vi.fn(),
  listRecentCompetitorReports: vi.fn(),
  insertCompetitorReport: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = { fetchSearchResults: vi.fn() };
vi.mock('../src/serpapiSearch', () => serpapiMock);

const contentMock = { fetchCompetitorPosts: vi.fn(), diffNewPosts: vi.fn() };
vi.mock('../src/competitorContent', () => contentMock);

const llmMock = { callLLM: vi.fn() };
vi.mock('@lhr/llm', () => llmMock);

const { analyzeCompetitors } = await import('../src/competitorAnalysis');

const originalEnv = { ...process.env };

const trackedCompetitor = {
  id: 1,
  domain: 'reliable-recipes.com',
  name: null,
  status: 'tracked' as const,
  discoveredAt: new Date(),
  approvedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SERPAPI_KEY = 'test-serpapi-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  serpapiMock.fetchSearchResults.mockResolvedValue([]);
  dbMock.insertCandidateCompetitor.mockResolvedValue(null);
  dbMock.listCompetitorsByStatus.mockResolvedValue([]);
  dbMock.listKeywords.mockResolvedValue([]);
  dbMock.listRecentCompetitorReports.mockResolvedValue([]);
  dbMock.insertCompetitorReport.mockImplementation(async (_db, report) => ({ id: 1, ...report, generatedAt: new Date() }));
  contentMock.fetchCompetitorPosts.mockResolvedValue({ posts: [], source: 'rss' });
  contentMock.diffNewPosts.mockReturnValue([]);
  llmMock.callLLM.mockResolvedValue('LLM output');
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('analyzeCompetitors', () => {
  it('reports success and writes no reports when there are no tracked competitors', async () => {
    const result = await analyzeCompetitors();
    expect(result.status).toBe('success');
    expect(dbMock.insertCompetitorReport).not.toHaveBeenCalled();
  });

  it('runs discovery against every curated query exactly once, inserting a new domain as a candidate', async () => {
    serpapiMock.fetchSearchResults.mockResolvedValue([
      { position: 1, title: 'T', link: 'https://new-blog.com/x', domain: 'new-blog.com' },
    ]);
    dbMock.insertCandidateCompetitor.mockResolvedValue({
      id: 5, domain: 'new-blog.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    });

    await analyzeCompetitors();

    expect(dbMock.insertCandidateCompetitor).toHaveBeenCalledWith(expect.anything(), 'new-blog.com');
    // Discovery runs once total, not once per tracked competitor.
    const discoveryCallCount = serpapiMock.fetchSearchResults.mock.calls.length;
    expect(discoveryCallCount).toBeGreaterThan(0);
  });

  it('dedupes a domain seen across multiple discovery queries within the same run', async () => {
    serpapiMock.fetchSearchResults.mockResolvedValue([
      { position: 1, title: 'T', link: 'https://dupe.com/x', domain: 'dupe.com' },
    ]);
    dbMock.insertCandidateCompetitor.mockResolvedValue({
      id: 5, domain: 'dupe.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    });

    await analyzeCompetitors();

    expect(dbMock.insertCandidateCompetitor).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one SerpApi call per SEO keyword, regardless of tracked-competitor count', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      trackedCompetitor,
      { ...trackedCompetitor, id: 2, domain: 'another.com' },
    ]);
    dbMock.listKeywords.mockResolvedValue([
      { id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() },
      { id: 2, keyword: 'best kitchenware sets', addedAt: new Date() },
    ]);

    await analyzeCompetitors();

    const keywordCalls = serpapiMock.fetchSearchResults.mock.calls.filter(
      (c) => c[0] === 'gluten free dinner recipes' || c[0] === 'best kitchenware sets',
    );
    expect(keywordCalls).toHaveLength(2);
  });

  it('records an SEO position for a tracked competitor whose domain appears in a keyword\'s results', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    dbMock.listKeywords.mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }]);
    serpapiMock.fetchSearchResults.mockImplementation(async (query: string) => {
      if (query === 'gluten free dinner recipes') {
        return [{ position: 3, title: 'T', link: 'https://reliable-recipes.com/x', domain: 'reliable-recipes.com' }];
      }
      return [];
    });

    await analyzeCompetitors();

    const reportCall = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(reportCall.seoPositions).toEqual([{ keyword: 'gluten free dinner recipes', position: 3 }]);
  });

  it('writes one report per tracked competitor and reports success on a clean cycle', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);

    const result = await analyzeCompetitors();

    expect(dbMock.insertCompetitorReport).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
  });

  it('marks content unreachable and still writes a report when fetchCompetitorPosts throws', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    contentMock.fetchCompetitorPosts.mockRejectedValue(new Error('network error'));

    const result = await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.newContent).toEqual([]);
    const synthesisCall = llmMock.callLLM.mock.calls.find((c) =>
      c[0].some((m: { content: string }) => m.content.includes('New content')),
    );
    expect(synthesisCall![0].some((m: { content: string }) => m.content.includes('unreachable this cycle'))).toBe(true);
    expect(result.status).toBe('partial');
  });

  it('marks monetization/design unreachable and still writes a report when the homepage fetch throws', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const result = await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.monetizationSnapshot).toBe('unreachable this cycle');
    expect(report.designSnapshot).toBe('unreachable this cycle');
    expect(result.status).toBe('partial');

    global.fetch = originalFetch;
  });

  it('stores the raw current snapshot, not the LLM diff text, in monetizationSnapshot/designSnapshot', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html><body>Shop the Kitchen</body></html>' }) as unknown as typeof fetch;
    llmMock.callLLM.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const userContent = messages[messages.length - 1].content;
      if (messages[0].content.includes('monetization and product strategy')) return 'Sells a $40 cast-iron pan.';
      if (messages[0].content.includes('layout, prominent calls-to-action')) return 'Grid homepage with a shop CTA.';
      if (messages[0].content.includes('describe what substantively changed')) return 'Added a new spatula set.';
      if (userContent.includes('New content')) return 'Weekly summary text.';
      return 'unused';
    });

    await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.monetizationSnapshot).toBe('Sells a $40 cast-iron pan.');
    expect(report.designSnapshot).toBe('Grid homepage with a shop CTA.');
  });

  it('diffs content against the union of new_content across recent reports, not just the latest row alone', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    dbMock.listRecentCompetitorReports.mockResolvedValue([
      { id: 2, competitorId: 1, cycleId: '2026-08-30', generatedAt: new Date(), newContent: [], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y', summary: 's' },
      { id: 1, competitorId: 1, cycleId: '2026-08-23', generatedAt: new Date(), newContent: [{ title: 'Old Post', url: 'https://reliable-recipes.com/old-post', publishedAt: null }], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y', summary: 's' },
    ]);
    contentMock.fetchCompetitorPosts.mockResolvedValue({
      posts: [{ title: 'Old Post', url: 'https://reliable-recipes.com/old-post', publishedAt: null }],
      source: 'rss',
    });
    contentMock.diffNewPosts.mockImplementation((posts, prior) => {
      const priorUrls = new Set(prior.map((p: { url: string }) => p.url));
      return posts.filter((p: { url: string }) => !priorUrls.has(p.url));
    });

    await analyzeCompetitors();

    // diffNewPosts must have been called with the flattened union of BOTH recent reports'
    // newContent (even though the most recent one is empty) — not just the latest report alone.
    expect(contentMock.diffNewPosts).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ url: 'https://reliable-recipes.com/old-post' })]),
    );
    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.newContent).toEqual([]);
  });

  it('writes the placeholder summary when the synthesis LLM call fails, but keeps the report', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSynthesis = messages.some((m) => m.content.includes('New content'));
      if (isSynthesis) throw new Error('OpenRouter down');
      return 'snapshot text';
    });

    const result = await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.summary).toBe('[Summary generation failed this cycle]');
    expect(result.status).toBe('partial');
  });

  it('reports partial when a discovery query fails, and continues with the rest', async () => {
    serpapiMock.fetchSearchResults.mockRejectedValueOnce(new Error('rate limited'));

    const result = await analyzeCompetitors();
    expect(result.status).toBe('partial');
  });

  it('throws before doing anything when SERPAPI_KEY is missing (fail-fast)', async () => {
    delete process.env.SERPAPI_KEY;
    await expect(analyzeCompetitors()).rejects.toThrow(/SERPAPI_KEY/);
    expect(dbMock.insertCompetitorReport).not.toHaveBeenCalled();
  });

  it('throws before doing anything when OPENROUTER_API_KEY is missing (fail-fast)', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(analyzeCompetitors()).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(dbMock.insertCompetitorReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/competitorAnalysis.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `competitorAnalysis.ts`**

`apps/lhr-office/src/competitorAnalysis.ts`:

```ts
import type { JobResult } from '@lhr/jobs';
import type { Queryable } from '@lhr/db';
import {
  getPool,
  insertCandidateCompetitor,
  listCompetitorsByStatus,
  listKeywords,
  listRecentCompetitorReports,
  insertCompetitorReport,
  type Competitor,
  type SeoPositionEntry,
  type NewCompetitorReport,
} from '@lhr/db';
import { fetchSearchResults } from './serpapiSearch.js';
import { fetchCompetitorPosts, diffNewPosts, type CompetitorPost } from './competitorContent.js';
import { callLLM } from '@lhr/llm';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const REQUEST_TIMEOUT_MS = 10_000;
const UNREACHABLE_NOTE = 'unreachable this cycle';
const SUMMARY_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';
const CONTENT_BASELINE_CYCLES = 10;
const MAX_TEXT_CHARS = 6000;

// A small, curated, non-auto-expanding list of niche-discovery queries.
const DISCOVERY_QUERIES: readonly string[] = [
  'gluten free recipe blog',
  'kitchenware affiliate roundup',
  'comfort food recipe blog',
  'best kitchen gadgets blog',
];

async function discoverCandidates(db: Queryable): Promise<{ discovered: number; failedQueries: string[] }> {
  const seenThisRun = new Set<string>();
  let discovered = 0;
  const failedQueries: string[] = [];

  for (const query of DISCOVERY_QUERIES) {
    let results;
    try {
      results = await fetchSearchResults(query);
    } catch (err) {
      console.warn(`[competitors] discovery query "${query}" failed; skipping.`, err);
      failedQueries.push(query);
      continue;
    }

    for (const result of results) {
      if (seenThisRun.has(result.domain)) continue;
      seenThisRun.add(result.domain);
      const inserted = await insertCandidateCompetitor(db, result.domain);
      if (inserted) discovered += 1;
    }
  }

  return { discovered, failedQueries };
}

async function trackSeoPositions(
  db: Queryable,
  tracked: Pick<Competitor, 'id' | 'domain'>[],
): Promise<{ positionsByCompetitorId: Map<number, SeoPositionEntry[]>; failedKeywords: string[] }> {
  const keywords = await listKeywords(db);
  const positionsByCompetitorId = new Map<number, SeoPositionEntry[]>();
  for (const competitor of tracked) positionsByCompetitorId.set(competitor.id, []);

  const failedKeywords: string[] = [];

  for (const { keyword } of keywords) {
    let results;
    try {
      results = await fetchSearchResults(keyword);
    } catch (err) {
      console.warn(`[competitors] SEO keyword "${keyword}" SerpApi call failed; skipping.`, err);
      failedKeywords.push(keyword);
      continue;
    }

    for (const competitor of tracked) {
      const match = results.find((r) => r.domain === competitor.domain);
      positionsByCompetitorId.get(competitor.id)!.push({ keyword, position: match ? match.position : null });
    }
  }

  return { positionsByCompetitorId, failedKeywords };
}

function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

async function fetchHomepageText(domain: string): Promise<string> {
  const response = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to fetch homepage for ${domain}: ${response.status}`);
  return htmlToText(await response.text());
}

async function summarizeMonetization(domain: string, pageText: string): Promise<string> {
  return callLLM([
    {
      role: 'system',
      content:
        "You analyze a competitor recipe/kitchenware site's homepage text and produce a short, factual snapshot of its monetization and product strategy: what it sells or promotes, any visible price ranges, and any visible affiliate/ad programs or sponsorship disclosures. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

async function summarizeDesign(domain: string, pageText: string): Promise<string> {
  return callLLM([
    {
      role: 'system',
      content:
        "You analyze a competitor site's homepage text (tags stripped, so infer structure from headings, nav labels, and link text) and produce a short, factual description of its apparent layout, prominent calls-to-action, and visual/content style. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

async function diffSnapshot(previous: string | null, current: string): Promise<string> {
  if (previous === null) return `Initial snapshot: ${current}`;
  return callLLM([
    {
      role: 'system',
      content:
        'Given a previous snapshot and a current snapshot of the same thing, describe what substantively changed in 1-2 sentences. If the current snapshot is just a prose rephrasing of the same facts with no substantive change, respond exactly with "No substantive change."',
    },
    { role: 'user', content: `Previous snapshot:\n${previous}\n\nCurrent snapshot:\n${current}` },
  ]);
}

async function buildCompetitorReport(
  db: Queryable,
  competitor: Pick<Competitor, 'id' | 'domain'>,
  cycleId: string,
  seoPositions: SeoPositionEntry[],
): Promise<{ report: NewCompetitorReport; hadIssue: boolean }> {
  const recentReports = await listRecentCompetitorReports(db, competitor.id, CONTENT_BASELINE_CYCLES);
  const priorReport = recentReports[0] ?? null;

  let hadIssue = false;
  let newContent: CompetitorPost[] = [];
  let contentDescriptor: string;
  try {
    const { posts, source } = await fetchCompetitorPosts(competitor.domain);
    if (source === 'unparseable') {
      contentDescriptor = UNREACHABLE_NOTE;
      hadIssue = true;
    } else {
      // The baseline is the union of new_content across several recent cycles, not just the
      // single most-recent row — see Global Constraints for why diffing against only the latest
      // row's own delta silently re-flags old posts as new after a quiet week.
      const knownPosts = recentReports.flatMap((r) => r.newContent);
      newContent = diffNewPosts(posts, knownPosts);
      contentDescriptor = newContent.length > 0 ? JSON.stringify(newContent) : 'no new content this cycle';
    }
  } catch (err) {
    console.warn(`[competitors] content fetch failed for ${competitor.domain}; marking unreachable this cycle.`, err);
    contentDescriptor = UNREACHABLE_NOTE;
    hadIssue = true;
  }

  // monetizationSnapshot/designSnapshot store the CURRENT full snapshot so next cycle's diff has
  // a real baseline — the LLM-produced change description is used only for this cycle's
  // synthesis prompt below, never persisted as the "snapshot".
  let monetizationSnapshot: string;
  let designSnapshot: string;
  let monetizationChange: string;
  let designChange: string;
  try {
    const pageText = await fetchHomepageText(competitor.domain);
    const [monetization, design] = await Promise.all([
      summarizeMonetization(competitor.domain, pageText),
      summarizeDesign(competitor.domain, pageText),
    ]);
    monetizationSnapshot = monetization;
    designSnapshot = design;
    [monetizationChange, designChange] = await Promise.all([
      diffSnapshot(priorReport?.monetizationSnapshot ?? null, monetization),
      diffSnapshot(priorReport?.designSnapshot ?? null, design),
    ]);
  } catch (err) {
    console.warn(`[competitors] homepage snapshot failed for ${competitor.domain}; marking unreachable this cycle.`, err);
    monetizationSnapshot = UNREACHABLE_NOTE;
    designSnapshot = UNREACHABLE_NOTE;
    monetizationChange = UNREACHABLE_NOTE;
    designChange = UNREACHABLE_NOTE;
    hadIssue = true;
  }

  let summary: string;
  try {
    summary = await callLLM([
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
          `Monetization change: ${monetizationChange}`,
          `Design change: ${designChange}`,
        ].join('\n'),
      },
    ]);
  } catch (err) {
    console.warn(`[competitors] synthesis LLM call failed for ${competitor.domain}.`, err);
    summary = SUMMARY_FAILURE_PLACEHOLDER;
    hadIssue = true;
  }

  return {
    report: { competitorId: competitor.id, cycleId, newContent, seoPositions, monetizationSnapshot, designSnapshot, summary },
    hadIssue,
  };
}

export async function analyzeCompetitors(): Promise<JobResult> {
  requireEnv('SERPAPI_KEY');
  requireEnv('OPENROUTER_API_KEY');
  const db = getPool();

  const cycleId = new Date().toISOString().slice(0, 10);

  const { discovered, failedQueries } = await discoverCandidates(db);
  const tracked = await listCompetitorsByStatus(db, 'tracked');
  const { positionsByCompetitorId, failedKeywords } = await trackSeoPositions(db, tracked);

  let reportsWritten = 0;
  let competitorsWithIssues = 0;
  for (const competitor of tracked) {
    const seoPositions = positionsByCompetitorId.get(competitor.id) ?? [];
    const { report, hadIssue } = await buildCompetitorReport(db, competitor, cycleId, seoPositions);
    await insertCompetitorReport(db, report);
    reportsWritten += 1;
    if (hadIssue) competitorsWithIssues += 1;
  }

  console.log(`[competitors] cycle ${cycleId}: ${discovered} new candidate(s), ${reportsWritten} report(s) written`);

  const degraded = failedQueries.length > 0 || failedKeywords.length > 0 || competitorsWithIssues > 0;
  if (degraded) {
    return {
      status: 'partial',
      summary: `Wrote ${reportsWritten} competitor report(s); ${competitorsWithIssues} competitor(s) had an issue this cycle, or discovery/SEO tracking had a failure.`,
    };
  }
  return { status: 'success', summary: `Wrote a competitor report for ${reportsWritten} tracked competitor(s).` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/competitorAnalysis.test.ts
```

Expected: PASS (all cases, including the two-cycles-worth-of-history regression test).

- [ ] **Step 5: Run the full `apps/lhr-office` suite once**

```bash
cd apps/lhr-office && npx vitest run
```

Expected: PASS — no regressions in the other job files' tests.

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/src/competitorAnalysis.ts apps/lhr-office/tests/competitorAnalysis.test.ts
git commit -m "Add weekly competitor analysis job with per-dimension partial-failure handling"
```

---

### Task 7: Register the job

**Files:**
- Modify: `apps/lhr-office/src/registry.ts`
- Modify: `apps/lhr-office/tests/registry.test.ts`

**Interfaces:**
- Consumes: `analyzeCompetitors` (`./competitorAnalysis.js`, Task 6).

- [ ] **Step 1: Write the failing test**

In `apps/lhr-office/tests/registry.test.ts`, add (alongside the existing `it(...)` blocks, inside the same `describe('jobs registry', ...)` block):

```ts
  it('registers the competitor-analysis job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'competitor-analysis');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/lhr-office && npx vitest run tests/registry.test.ts
```

Expected: FAIL — no job named `competitor-analysis` is registered yet.

- [ ] **Step 3: Register the job**

In `apps/lhr-office/src/registry.ts`, add the import and the registry entry:

```ts
import { analyzeCompetitors } from './competitorAnalysis.js';
```

```ts
export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants },
  { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates },
  { name: 'trends-watcher', cadenceDays: 7, run: sourceWeeklyTrends },
  { name: 'competitor-analysis', cadenceDays: 7, run: analyzeCompetitors },
];
```

(Leave every existing line exactly as it is — this only adds one import and one array entry.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/registry.test.ts
```

Expected: PASS, including the pre-existing `'is always shape-valid'` test (confirms `validateJobRegistrations` accepts the new entry).

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/registry.ts apps/lhr-office/tests/registry.test.ts
git commit -m "Register competitor-analysis job in the orchestrator"
```

---

### Task 8: `/status` page sections

**Files:**
- Modify: `apps/lhr-office/src/statusPage.ts`
- Modify: `apps/lhr-office/tests/statusPage.test.ts`

**Interfaces:**
- Consumes: `type Competitor`, `type CompetitorReport`, `type CompetitorSeoKeyword` (`@lhr/db`).
- Produces: `renderCompetitorsSection(tracked, latestReportByCompetitorId): string`, `renderCompetitorCandidatesSection(candidates): string`, `renderCompetitorKeywordsSection(keywords): string`; extends `renderStatusPage`'s signature with three new parameters. Consumed by Task 9 (`server.ts`'s `/status` GET handler).

- [ ] **Step 1: Write the failing tests**

In `apps/lhr-office/tests/statusPage.test.ts`, add (following the existing file's structure — import the new functions alongside the existing ones at the top, and add these `describe` blocks):

```ts
describe('renderCompetitorsSection', () => {
  it('renders nothing when there are no tracked competitors', () => {
    expect(renderCompetitorsSection([], new Map())).toBe('');
  });

  it('renders a tracked competitor with its latest report summary', () => {
    const competitor = { id: 1, domain: 'reliable-recipes.com', name: null, status: 'tracked' as const, discoveredAt: new Date(), approvedAt: new Date() };
    const report = {
      id: 1, competitorId: 1, cycleId: '2026-09-06', generatedAt: new Date('2026-09-06T00:00:00Z'),
      newContent: [], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y',
      summary: 'Published one new post this week.',
    };
    const html = renderCompetitorsSection([competitor], new Map([[1, report]]));
    expect(html).toContain('reliable-recipes.com');
    expect(html).toContain('Published one new post this week.');
  });

  it('shows a placeholder when a tracked competitor has no report yet', () => {
    const competitor = { id: 2, domain: 'brand-new.com', name: null, status: 'tracked' as const, discoveredAt: new Date(), approvedAt: new Date() };
    const html = renderCompetitorsSection([competitor], new Map());
    expect(html).toContain('brand-new.com');
    expect(html).toContain('No report yet');
  });
});

describe('renderCompetitorCandidatesSection', () => {
  it('renders nothing when there are no pending candidates', () => {
    expect(renderCompetitorCandidatesSection([])).toBe('');
  });

  it('renders a pending candidate with approve/reject actions', () => {
    const candidate = { id: 3, domain: 'new-candidate.com', name: null, status: 'candidate' as const, discoveredAt: new Date(), approvedAt: null };
    const html = renderCompetitorCandidatesSection([candidate]);
    expect(html).toContain('new-candidate.com');
    expect(html).toContain('/status/competitors/3/approve');
    expect(html).toContain('/status/competitors/3/reject');
  });
});

describe('renderCompetitorKeywordsSection', () => {
  it('renders the keyword list and an add form', () => {
    const keyword = { id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() };
    const html = renderCompetitorKeywordsSection([keyword]);
    expect(html).toContain('gluten free dinner recipes');
    expect(html).toContain('/status/competitors/keywords/1/remove');
    expect(html).toContain('/status/competitors/keywords/add');
  });

  it('renders an empty list with just the add form when there are no keywords yet', () => {
    const html = renderCompetitorKeywordsSection([]);
    expect(html).toContain('/status/competitors/keywords/add');
  });
});
```

At the top of the same file, extend the import line that currently reads (approximately) `import type { Candidate, OrchestratorRun } from '@lhr/db';` to also bring in the new types, and add an import for the three new functions this task creates — since they're defined in this same file, no new import is needed for them, but the test file (a separate file) needs:

```ts
import { renderCompetitorsSection, renderCompetitorCandidatesSection, renderCompetitorKeywordsSection } from '../src/statusPage';
```

alongside its existing imports.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/statusPage.test.ts
```

Expected: FAIL — the three new functions don't exist yet.

- [ ] **Step 3: Implement the three new sections**

In `apps/lhr-office/src/statusPage.ts`, add `Competitor`, `CompetitorReport`, `CompetitorSeoKeyword` to the existing `@lhr/db` type import at the top of the file, then add (near the other `renderXSection` functions, e.g. after `renderTrendSeedTopicsSection`):

```ts
function renderCompetitorRow(competitor: Competitor, report: CompetitorReport | undefined): string {
  return `
      <li>
        <p><strong>${escapeHtml(competitor.name ?? competitor.domain)}</strong> (${escapeHtml(competitor.domain)})${report ? ` — cycle ${escapeHtml(report.cycleId)}` : ''}</p>
        <p>${report ? escapeHtml(report.summary) : 'No report yet — the next weekly cycle will generate one.'}</p>
      </li>`;
}

// Mirrors the trend-topics/affiliate-candidates sections above — every human-in-the-loop
// decision this orchestrator needs lives on this one Basic-Auth-gated page.
export function renderCompetitorsSection(tracked: Competitor[], latestReportByCompetitorId: Map<number, CompetitorReport>): string {
  if (tracked.length === 0) return '';
  return `
    <section>
      <h2>Competitors</h2>
      <ul>${tracked.map((c) => renderCompetitorRow(c, latestReportByCompetitorId.get(c.id))).join('')}</ul>
    </section>`;
}

function renderCompetitorCandidate(candidate: Competitor): string {
  return `
      <li>
        <span>${escapeHtml(candidate.domain)}</span>
        <form method="post" action="/status/competitors/${candidate.id}/approve" style="display:inline">
          <button type="submit">Track</button>
        </form>
        <form method="post" action="/status/competitors/${candidate.id}/reject" style="display:inline">
          <button type="submit">Reject</button>
        </form>
      </li>`;
}

export function renderCompetitorCandidatesSection(candidates: Competitor[]): string {
  if (candidates.length === 0) return '';
  return `
    <section>
      <h2>Competitor candidates</h2>
      <ul>${candidates.map(renderCompetitorCandidate).join('')}</ul>
    </section>`;
}

function renderCompetitorSeoKeyword(keyword: CompetitorSeoKeyword): string {
  return `
      <li>
        <span>${escapeHtml(keyword.keyword)}</span>
        <form method="post" action="/status/competitors/keywords/${keyword.id}/remove" style="display:inline">
          <button type="submit">Remove</button>
        </form>
      </li>`;
}

export function renderCompetitorKeywordsSection(keywords: CompetitorSeoKeyword[]): string {
  return `
    <section>
      <h2>Competitor SEO keywords</h2>
      <ul>${keywords.map(renderCompetitorSeoKeyword).join('')}</ul>
      <form method="post" action="/status/competitors/keywords/add">
        <input type="text" name="keyword" placeholder="New SEO keyword to track" required />
        <button type="submit">Add keyword</button>
      </form>
    </section>`;
}
```

Then update `renderStatusPage`'s signature and body to accept and render the three new pieces of data. Change the signature from:

```ts
export function renderStatusPage(
  rows: JobStatusRow[],
  candidate: CandidateSummary | null = null,
  affiliateCandidates: Candidate[] = [],
  trendsReports: TrendsReport[] = [],
  trendSeedTopics: TrendSeedTopic[] = [],
): string {
```

to:

```ts
export function renderStatusPage(
  rows: JobStatusRow[],
  candidate: CandidateSummary | null = null,
  affiliateCandidates: Candidate[] = [],
  trendsReports: TrendsReport[] = [],
  trendSeedTopics: TrendSeedTopic[] = [],
  trackedCompetitors: Competitor[] = [],
  latestCompetitorReportById: Map<number, CompetitorReport> = new Map(),
  competitorCandidates: Competitor[] = [],
  competitorSeoKeywords: CompetitorSeoKeyword[] = [],
): string {
```

and add the three new sections to the returned HTML, right after `${renderTrendSeedTopicsSection(trendSeedTopics)}`:

```ts
    ${renderTrendSeedTopicsSection(trendSeedTopics)}
    ${renderCompetitorsSection(trackedCompetitors, latestCompetitorReportById)}
    ${renderCompetitorCandidatesSection(competitorCandidates)}
    ${renderCompetitorKeywordsSection(competitorSeoKeywords)}
    ${sections || '<p>No jobs registered yet.</p>'}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/statusPage.test.ts
```

Expected: PASS, including every pre-existing test in that file (the new `renderStatusPage` parameters all default to empty, so the pre-existing calls that don't pass them are unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/statusPage.ts apps/lhr-office/tests/statusPage.test.ts
git commit -m "Add competitor/candidate/keyword sections to the /status page"
```

---

### Task 9: `/status` action routes

**Files:**
- Modify: `apps/lhr-office/src/server.ts`
- Modify: `apps/lhr-office/tests/server.test.ts`

**Interfaces:**
- Consumes: `setCompetitorStatus`, `listCompetitorsByStatus`, `listRecentCompetitorReports`, `addKeyword`, `removeKeyword`, `listKeywords` (`@lhr/db`); `renderCompetitorsSection`, `renderCompetitorCandidatesSection`, `renderCompetitorKeywordsSection` (`./statusPage.js`, Task 8).
- Produces: `POST /status/competitors/:id/approve`, `POST /status/competitors/:id/reject`, `POST /status/competitors/keywords/add`, `POST /status/competitors/keywords/:id/remove`; extends the `GET /status` handler to fetch and pass through the three new sections' data.

- [ ] **Step 1: Write the failing tests**

In `apps/lhr-office/tests/server.test.ts`, extend the existing `@lhr/db` mock object (the one built with `vi.mock('@lhr/db', () => ({ ... }))`) to add these entries alongside the existing ones:

```ts
const listCompetitorsByStatusMock = vi.fn();
const setCompetitorStatusMock = vi.fn();
const listRecentCompetitorReportsMock = vi.fn();
const listKeywordsMock = vi.fn();
const addKeywordMock = vi.fn();
const removeKeywordMock = vi.fn();
```

and add them to the mocked `@lhr/db` module's returned object:

```ts
  listCompetitorsByStatus: (...args: unknown[]) => listCompetitorsByStatusMock(...args),
  setCompetitorStatus: (...args: unknown[]) => setCompetitorStatusMock(...args),
  listRecentCompetitorReports: (...args: unknown[]) => listRecentCompetitorReportsMock(...args),
  listKeywords: (...args: unknown[]) => listKeywordsMock(...args),
  addKeyword: (...args: unknown[]) => addKeywordMock(...args),
  removeKeyword: (...args: unknown[]) => removeKeywordMock(...args),
```

In the file's `beforeEach`, add default resolved values alongside the existing ones:

```ts
  listCompetitorsByStatusMock.mockResolvedValue([]);
  listRecentCompetitorReportsMock.mockResolvedValue([]);
  listKeywordsMock.mockResolvedValue([]);
```

Then add these new `describe` blocks (following the file's existing style — `createApp(fakeDb, [], noCandidates, noAffiliateCandidates)`):

```ts
describe('POST /status/competitors/:id/approve', () => {
  it('tracks the competitor and redirects to /status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/competitors/5/approve')
      .auth('test-user', 'test-password');
    expect(setCompetitorStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'tracked');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
  });

  it('rejects without valid Basic Auth and does not mutate anything', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/competitors/5/approve');
    expect(res.status).toBe(401);
    expect(setCompetitorStatusMock).not.toHaveBeenCalled();
  });
});

describe('POST /status/competitors/:id/reject', () => {
  it('rejects the competitor and redirects to /status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/competitors/5/reject')
      .auth('test-user', 'test-password');
    expect(setCompetitorStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'rejected');
    expect(res.status).toBe(303);
  });
});

describe('POST /status/competitors/keywords/add', () => {
  it('adds a keyword and redirects to /status', async () => {
    addKeywordMock.mockResolvedValue({ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() });
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/competitors/keywords/add')
      .auth('test-user', 'test-password')
      .send({ keyword: 'gluten free dinner recipes' });
    expect(addKeywordMock).toHaveBeenCalledWith(fakeDb, 'gluten free dinner recipes');
    expect(res.status).toBe(303);
  });
});

describe('POST /status/competitors/keywords/:id/remove', () => {
  it('removes a keyword and redirects to /status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/competitors/keywords/1/remove')
      .auth('test-user', 'test-password');
    expect(removeKeywordMock).toHaveBeenCalledWith(fakeDb, 1);
    expect(res.status).toBe(303);
  });
});

describe('GET /status with competitor data', () => {
  it('renders the tracked competitors, candidates, and keywords sections', async () => {
    listCompetitorsByStatusMock.mockImplementation(async (_db: unknown, status: string) =>
      status === 'tracked'
        ? [{ id: 1, domain: 'reliable-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() }]
        : [{ id: 2, domain: 'new-candidate.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null }],
    );
    listKeywordsMock.mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }]);

    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/status').auth('test-user', 'test-password');

    expect(res.status).toBe(200);
    expect(res.text).toContain('reliable-recipes.com');
    expect(res.text).toContain('new-candidate.com');
    expect(res.text).toContain('gluten free dinner recipes');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/server.test.ts
```

Expected: FAIL — the four new routes don't exist yet, and `GET /status` doesn't fetch or render competitor data yet.

- [ ] **Step 3: Add the imports**

In `apps/lhr-office/src/server.ts`, extend the existing `@lhr/db` import to also bring in:

```ts
  listCompetitorsByStatus,
  setCompetitorStatus,
  listRecentCompetitorReports,
  listKeywords,
  addKeyword,
  removeKeyword,
  type CompetitorReport,
```

and extend the existing `./statusPage.js` import to also bring in:

```ts
  renderCompetitorsSection,
  renderCompetitorCandidatesSection,
  renderCompetitorKeywordsSection,
```

(`renderCompetitorsSection`/etc. are called directly by `renderStatusPage` internally per Task 8 — `server.ts` only needs to pass the raw data through, so importing the three functions here is only needed if `server.ts` calls them directly; since Task 8's `renderStatusPage` already composes them internally, `server.ts` does NOT need to import these three functions itself — only the `@lhr/db` functions above. Skip the `statusPage.js` import addition.)

- [ ] **Step 4: Fetch and pass through the new data in the `/status` GET handler**

In `apps/lhr-office/src/server.ts`'s `app.get('/status', requireStatusAuth, async (_req, res) => { ... })` handler, add alongside the existing `Promise.all`/data-fetching lines (before the `res.type('html').send(renderStatusPage(...))` call):

```ts
      const trackedCompetitors = await listCompetitorsByStatus(db, 'tracked');
      const competitorCandidates = await listCompetitorsByStatus(db, 'candidate');
      const latestCompetitorReportEntries = await Promise.all(
        trackedCompetitors.map(async (c): Promise<readonly [number, CompetitorReport] | null> => {
          const [latest] = await listRecentCompetitorReports(db, c.id, 1);
          return latest ? ([c.id, latest] as const) : null;
        }),
      );
      const latestCompetitorReportById = new Map(
        latestCompetitorReportEntries.filter((entry): entry is readonly [number, CompetitorReport] => entry !== null),
      );
      const competitorSeoKeywords = await listKeywords(db);
```

and change the render call from:

```ts
      res.type('html').send(renderStatusPage(rows, candidate, pendingAffiliateCandidates, trendsReports, trendSeedTopics));
```

to:

```ts
      res.type('html').send(
        renderStatusPage(
          rows,
          candidate,
          pendingAffiliateCandidates,
          trendsReports,
          trendSeedTopics,
          trackedCompetitors,
          latestCompetitorReportById,
          competitorCandidates,
          competitorSeoKeywords,
        ),
      );
```

(`listRecentCompetitorReports(db, c.id, 1)` returns an empty array for a tracked competitor with no report yet — the `null`-then-`filter` step above keeps `latestCompetitorReportById` a strictly-typed `Map<number, CompetitorReport>` with no risky cast, rather than a map that silently holds `undefined` values under a type that claims otherwise. `renderCompetitorsSection`'s second parameter is exactly this strict `Map<number, CompetitorReport>` type from Task 8; `renderCompetitorRow`'s `report: CompetitorReport | undefined` parameter still handles the "no report" case correctly via `Map.get`'s always-optional return, independent of what the map's value type declares.)

- [ ] **Step 5: Add the four new routes**

In `apps/lhr-office/src/server.ts`, add after the existing `/status/trends/topics/add` route (before the function's closing `return app;`):

```ts
  app.post('/status/competitors/:id/approve', requireStatusAuth, async (req, res) => {
    try {
      await setCompetitorStatus(db, Number(req.params.id), 'tracked');
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to approve competitor: ${escapeHtml(message)}`);
    }
  });

  app.post('/status/competitors/:id/reject', requireStatusAuth, async (req, res) => {
    try {
      await setCompetitorStatus(db, Number(req.params.id), 'rejected');
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to reject competitor: ${escapeHtml(message)}`);
    }
  });

  app.post(
    '/status/competitors/keywords/add',
    requireStatusAuth,
    express.urlencoded({ extended: false }),
    express.json(),
    async (req, res) => {
      try {
        await addKeyword(db, req.body.keyword);
        res.redirect(303, '/status');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).send(`Failed to add keyword: ${escapeHtml(message)}`);
      }
    },
  );

  app.post('/status/competitors/keywords/:id/remove', requireStatusAuth, async (req, res) => {
    try {
      await removeKeyword(db, Number(req.params.id));
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to remove keyword: ${escapeHtml(message)}`);
    }
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/server.test.ts
```

Expected: PASS, including every pre-existing test in that file.

- [ ] **Step 7: Run the full `apps/lhr-office` suite and build**

```bash
cd apps/lhr-office && npx vitest run && npm run build
```

Expected: every test passes; the build succeeds (this also `tsc --noEmit`s the whole app, catching any type mismatch in the `renderStatusPage` call site from Task 8/9).

- [ ] **Step 8: Commit**

```bash
git add apps/lhr-office/src/server.ts apps/lhr-office/tests/server.test.ts
git commit -m "Add /status routes for competitor approve/reject and SEO keyword add/remove"
```

---

### Task 10: Final Verification

**Files:** none — this task runs commands and performs a manual check, per Constitution rule 7 ("any code-based feature must give the author a way to run and validate it on her own machine before it merges").

- [ ] **Step 1: Run the full automated suite**

```bash
cd packages/db && npx vitest run && cd ../..
cd apps/lhr-office && npx vitest run && npm run build && cd ..
npm run build --workspace=@lhr/db
```

Expected: everything green, the `apps/lhr-office` build (which includes a full `tsc --noEmit`) succeeds.

- [ ] **Step 2: Apply the schema to a real database**

This needs a real `DATABASE_URL` (any Postgres works — Neon/Supabase/local):

```bash
psql "$DATABASE_URL" -f packages/db/src/schema.sql
```

Expected: the three new `CREATE TABLE IF NOT EXISTS` statements (from Tasks 1-3) apply cleanly alongside the existing tables.

- [ ] **Step 3: Run the job for real, using the orchestrator's own "Run now" button — no new tooling needed**

This is the single command Constitution rule 7 requires, and it already exists generically for every registered job — nothing new was built for it in this plan:

```bash
cd apps/lhr-office && DATABASE_URL="$DATABASE_URL" SERPAPI_KEY="$SERPAPI_KEY" OPENROUTER_API_KEY="$OPENROUTER_API_KEY" STATUS_AUTH_USER=dev STATUS_AUTH_PASSWORD=dev npm run dev
```

Then, in a browser, visit `http://localhost:3000/status` (log in with `dev`/`dev`), and:
1. Confirm a "competitor-analysis" section appears in the per-job list (cadence: every 7 days, "never run"), alongside its own "Run now" button.
2. Confirm the "Competitor SEO keywords" section renders with an add form; add one real keyword (e.g. "gluten free dinner recipes").
3. Click "Run now" next to competitor-analysis. Confirm the page reloads to `/status` without a 500, and the job's history now shows a real outcome (`success` or `partial`, with a real summary string).
4. Confirm the "Competitor candidates" section now lists any domains the discovery queries found, with "Track"/"Reject" buttons. Click "Track" on one.
5. Click "Run now" again. Confirm the "Competitors" section now shows the newly-tracked competitor with a real `cycleId` and summary — proving the whole pipeline (discovery → approval → analysis → report) works end-to-end against real APIs and a real database, not just mocks.

Expected: every step above works exactly as described, using nothing beyond the one `npm run dev` command and the already-existing `/status` UI — no bespoke script, no manual `tsx -e` invocation, satisfying Constitution rule 7 with zero extra code.
