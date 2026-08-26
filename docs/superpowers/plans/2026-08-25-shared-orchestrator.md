# Shared Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic engine that schedules and runs weekly automation jobs — a Vercel
Cron-triggered endpoint in a new `apps/lhr-office` app that checks which registered jobs are due,
runs (at most) one per invocation, records the outcome in Postgres, and exposes a `/status` page —
with an **empty** job registry, ready for the five agent pipelines to be registered later.

**Architecture:** Two new shared workspace packages (`@lhr/jobs` for the job contract/registry/
due-check logic, `@lhr/db` for the `orchestrator_runs` table and its CRUD accessors) plus a new
`apps/lhr-office` Express app, deployed to Vercel the same way `mcp-server` already is (esbuild
bundle → single serverless function, all paths rewritten to it). The orchestration business logic
(due-check → overlap-guard → execute → record) lives in one small, dependency-injected module
(`apps/lhr-office/src/orchestrate.ts`) that takes its Postgres client and job registry as
parameters, so it's fully unit-testable without a real database or HTTP layer.

**Tech Stack:** TypeScript (strict), Express (matching `mcp-server`), `pg` (node-postgres),
esbuild, Vercel Cron, Vitest + Supertest.

**Spec:** `docs/superpowers/specs/active/2026-08-25-shared-orchestrator-design.md` — see its
"Implementation Note" section for why this plan diverges from the spec's assumption that
`apps/lhr-office` and the five agent pipelines already exist.

## Global Constraints

- Vercel Cron triggers the orchestrator endpoint once daily; the endpoint must also work when hit
  manually (curl) for testing. **Deviation from the spec:** Vercel Cron Jobs always issue a `GET`
  request, not `POST` — the endpoint accepts both `GET` and `POST` at `/api/cron/orchestrator` so
  the real Vercel-triggered invocation actually reaches it, while `POST` stays available for manual
  testing.
- `CRON_SECRET` env var protects `/api/cron/orchestrator`: request rejected with 401 (no DB write)
  unless `Authorization: Bearer <CRON_SECRET>` matches exactly.
- Due-check: a job is due if it has no prior `status='success'` row, or its latest one's
  `finished_at` is `>= cadenceDays` days old.
- Exactly one due job runs per invocation — the most overdue one.
- Overlap guard: skip a job if it has a `status='running'` row started within the last 10 minutes;
  older `running` rows are treated as stale and don't block a new attempt.
- A job's own `JobResult.status === 'partial'` still counts as a completed, due-clearing run (not
  the same as `'failure'`, not retried same day).
- An uncaught exception from a job's `run()` must never crash the endpoint or produce a non-200
  response — it's caught, recorded as a `failure` row, and the endpoint still returns 200.
- No alerting/notifications, no parallel multi-job execution per invocation, no automatic same-day
  retry — all explicitly out of scope.
- `packages/jobs/src/registry.ts` ships with **zero** entries in this plan (see spec's
  Implementation Note). Do not invent placeholder pipeline functions.

---

## File Structure

```
package.json                                  # MODIFY: add 3 new workspaces
docs/DEPLOYMENT.md                            # MODIFY: new operational-setup section

packages/jobs/                                # NEW workspace: @lhr/jobs
  package.json
  tsconfig.json
  src/
    types.ts                                  # JobResult, Job, JobRegistration
    validateRegistry.ts                       # validateJobRegistrations()
    registry.ts                               # jobs: JobRegistration[] = []
    dueCheck.ts                               # isDue(), selectMostOverdue()
    index.ts                                  # re-exports all of the above
  tests/
    validateRegistry.test.ts
    registry.test.ts
    dueCheck.test.ts

packages/db/                                  # NEW workspace: @lhr/db
  package.json
  tsconfig.json
  src/
    schema.sql                                # orchestrator_runs DDL
    types.ts                                  # RunStatus, OrchestratorRun
    client.ts                                 # Queryable, getPool()
    orchestratorRuns.ts                       # insertRunningRow, finishRun, failRun, getLatestSuccess, getRecentRunning, getRunHistory
    index.ts                                  # re-exports all of the above
  tests/
    orchestratorRuns.test.ts

apps/lhr-office/                              # NEW workspace: lhr-office
  package.json
  tsconfig.json
  vitest.config.ts
  vercel.json
  scripts/
    bundle.mjs
  src/
    orchestrate.ts                            # runDueJob(), runJobNow()
    statusPage.ts                             # renderStatusPage()
    server.ts                                 # createApp(): Express app
  api/
    index.ts                                  # Vercel serverless entrypoint
  tests/
    orchestrate.test.ts
    statusPage.test.ts
    server.test.ts
```

Each of the five future agent pipelines registers itself later by adding one entry to
`packages/jobs/src/registry.ts` — no file in this list changes to support that.

---

### Task 1: `@lhr/jobs` — job contract, registry, and shape validation

**Files:**
- Create: `packages/jobs/package.json`
- Create: `packages/jobs/tsconfig.json`
- Create: `packages/jobs/src/types.ts`
- Create: `packages/jobs/src/validateRegistry.ts`
- Create: `packages/jobs/src/registry.ts`
- Create: `packages/jobs/src/index.ts`
- Create: `packages/jobs/tests/validateRegistry.test.ts`
- Create: `packages/jobs/tests/registry.test.ts`
- Modify: `package.json` (root `workspaces` array and `postinstall` script)

**Interfaces:**
- Produces: `JobResult { status: 'success'|'partial'|'failure'; summary: string; details?: Record<string, unknown> }`, `Job = () => Promise<JobResult>`, `JobRegistration { name: string; cadenceDays: number; run: Job }`, `validateJobRegistrations(registry: JobRegistration[]): void` (throws on an invalid entry), `jobs: JobRegistration[]` (the live registry, starts empty). All consumed by Tasks 2–6.

- [ ] **Step 1: Add the workspace to the root `package.json`**

Edit `package.json` so the `workspaces` array and `postinstall` script read:

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/jobs"
  ],
```

```json
    "postinstall": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/jobs",
```

(the existing `postinstall` only builds `@lhr/schemas`; this extends the same pattern so a fresh
`npm install` produces `packages/jobs/dist/` too — anything that later imports `@lhr/jobs`, like
`apps/lhr-office`, needs that `dist/` to already exist.)

- [ ] **Step 2: Create the package scaffold**

`packages/jobs/package.json`:

```json
{
  "name": "@lhr/jobs",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/jobs/tsconfig.json`:

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

Run: `npm install`
Expected: installs cleanly, `node_modules/@lhr/jobs` symlinked to `packages/jobs`.

- [ ] **Step 3: Write the failing test for registration shape validation**

`packages/jobs/tests/validateRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateJobRegistrations } from '../src/validateRegistry';
import type { JobRegistration } from '../src/types';

const validJob = (name: string): JobRegistration => ({
  name,
  cadenceDays: 7,
  run: async () => ({ status: 'success', summary: 'ok' }),
});

describe('validateJobRegistrations', () => {
  it('accepts an empty registry', () => {
    expect(() => validateJobRegistrations([])).not.toThrow();
  });

  it('accepts a well-formed registry', () => {
    expect(() => validateJobRegistrations([validJob('a'), validJob('b')])).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => validateJobRegistrations([{ ...validJob('a'), name: '' }])).toThrow(/name/);
  });

  it('rejects a duplicate name', () => {
    expect(() => validateJobRegistrations([validJob('a'), validJob('a')])).toThrow(/duplicate/);
  });

  it('rejects a non-positive cadenceDays', () => {
    expect(() => validateJobRegistrations([{ ...validJob('a'), cadenceDays: 0 }])).toThrow(/cadenceDays/);
  });

  it('rejects a non-integer cadenceDays', () => {
    expect(() => validateJobRegistrations([{ ...validJob('a'), cadenceDays: 1.5 }])).toThrow(/cadenceDays/);
  });

  it('rejects a non-function run', () => {
    expect(() =>
      validateJobRegistrations([{ ...validJob('a'), run: 'nope' as unknown as JobRegistration['run'] }]),
    ).toThrow(/run/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test --workspace=@lhr/jobs`
Expected: FAIL — `Cannot find module '../src/validateRegistry'` (and `../src/types`).

- [ ] **Step 5: Write `types.ts` and `validateRegistry.ts`**

`packages/jobs/src/types.ts`:

```ts
export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
}

export type Job = () => Promise<JobResult>;

export interface JobRegistration {
  name: string;
  cadenceDays: number;
  run: Job;
}
```

`packages/jobs/src/validateRegistry.ts`:

```ts
import type { JobRegistration } from './types.js';

export function validateJobRegistrations(registry: JobRegistration[]): void {
  const seen = new Set<string>();
  for (const entry of registry) {
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Error(`Invalid job registration: name must be a non-empty string (got ${JSON.stringify(entry.name)})`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`Invalid job registration: duplicate job name "${entry.name}"`);
    }
    seen.add(entry.name);
    if (!Number.isInteger(entry.cadenceDays) || entry.cadenceDays <= 0) {
      throw new Error(
        `Invalid job registration "${entry.name}": cadenceDays must be a positive integer (got ${entry.cadenceDays})`,
      );
    }
    if (typeof entry.run !== 'function') {
      throw new Error(`Invalid job registration "${entry.name}": run must be a function`);
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test --workspace=@lhr/jobs`
Expected: PASS (7 tests).

- [ ] **Step 7: Write the failing test for the registry itself**

`packages/jobs/tests/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { jobs } from '../src/registry';
import { validateJobRegistrations } from '../src/validateRegistry';

describe('jobs registry', () => {
  it('starts empty, pending each agent pipeline getting its own implementation plan', () => {
    expect(jobs).toEqual([]);
  });

  it('is always shape-valid', () => {
    expect(() => validateJobRegistrations(jobs)).not.toThrow();
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npm test --workspace=@lhr/jobs`
Expected: FAIL — `Cannot find module '../src/registry'`.

- [ ] **Step 9: Write `registry.ts` and `index.ts`**

`packages/jobs/src/registry.ts`:

```ts
import type { JobRegistration } from './types.js';
import { validateJobRegistrations } from './validateRegistry.js';

export const jobs: JobRegistration[] = [];

validateJobRegistrations(jobs);
```

`packages/jobs/src/index.ts`:

```ts
export * from './types.js';
export * from './validateRegistry.js';
export * from './registry.js';
export * from './dueCheck.js';
```

(`dueCheck.ts` doesn't exist yet — that's Task 2. `index.ts` won't compile until then, which is
fine; `npm test --workspace=@lhr/jobs` runs Vitest directly against `tests/*.test.ts`, which only
import from `../src/registry` and `../src/validateRegistry` so far, not from `index.ts`.)

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test --workspace=@lhr/jobs`
Expected: PASS (9 tests total).

- [ ] **Step 11: Commit**

```bash
git add package.json packages/jobs
git commit -m "feat: add @lhr/jobs package with job contract and empty registry"
```

---

### Task 2: `@lhr/jobs` — due-check and most-overdue selection

**Files:**
- Create: `packages/jobs/src/dueCheck.ts`
- Create: `packages/jobs/tests/dueCheck.test.ts`
- Modify: `packages/jobs/src/index.ts` (already exports `dueCheck.js` from Task 1's Step 9 — no change needed, just confirm it now compiles)

**Interfaces:**
- Consumes: `JobRegistration` from `./types.js` (Task 1).
- Produces: `isDue(cadenceDays: number, lastSuccessAt: Date | null, now: Date): boolean`,
  `selectMostOverdue(candidates: JobRegistration[], lastSuccessAt: ReadonlyMap<string, Date | null>, now: Date): JobRegistration | null`.
  Both consumed by `apps/lhr-office/src/orchestrate.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

`packages/jobs/tests/dueCheck.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isDue, selectMostOverdue } from '../src/dueCheck';
import type { JobRegistration } from '../src/types';

describe('isDue', () => {
  it('is due when there is no prior success', () => {
    expect(isDue(7, null, new Date('2026-08-25T00:00:00Z'))).toBe(true);
  });

  it('is not due when the last success is within the cadence window', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const lastSuccess = new Date('2026-08-20T00:00:00Z'); // 5 days ago
    expect(isDue(7, lastSuccess, now)).toBe(false);
  });

  it('is due when the last success is older than the cadence window', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const lastSuccess = new Date('2026-08-17T00:00:00Z'); // 8 days ago
    expect(isDue(7, lastSuccess, now)).toBe(true);
  });

  it('is due exactly at the cadence boundary', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const lastSuccess = new Date('2026-08-18T00:00:00Z'); // exactly 7 days ago
    expect(isDue(7, lastSuccess, now)).toBe(true);
  });
});

describe('selectMostOverdue', () => {
  const makeJob = (name: string): JobRegistration => ({
    name,
    cadenceDays: 7,
    run: async () => ({ status: 'success', summary: '' }),
  });

  it('returns null when there are no candidates', () => {
    expect(selectMostOverdue([], new Map(), new Date())).toBeNull();
  });

  it('picks the job whose last success is oldest', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const a = makeJob('a');
    const b = makeJob('b');
    const lastSuccessAt = new Map<string, Date | null>([
      ['a', new Date('2026-08-10T00:00:00Z')],
      ['b', new Date('2026-08-01T00:00:00Z')],
    ]);
    expect(selectMostOverdue([a, b], lastSuccessAt, now)).toBe(b);
  });

  it('treats a job with no prior success as more overdue than one with a recorded success', () => {
    const now = new Date('2026-08-25T00:00:00Z');
    const a = makeJob('a');
    const b = makeJob('b');
    const lastSuccessAt = new Map<string, Date | null>([['a', new Date('2020-01-01T00:00:00Z')]]); // b has no entry at all
    expect(selectMostOverdue([a, b], lastSuccessAt, now)).toBe(b);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=@lhr/jobs`
Expected: FAIL — `Cannot find module '../src/dueCheck'`.

- [ ] **Step 3: Write `dueCheck.ts`**

`packages/jobs/src/dueCheck.ts`:

```ts
import type { JobRegistration } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isDue(cadenceDays: number, lastSuccessAt: Date | null, now: Date): boolean {
  if (lastSuccessAt === null) return true;
  return now.getTime() - lastSuccessAt.getTime() >= cadenceDays * MS_PER_DAY;
}

export function selectMostOverdue(
  candidates: JobRegistration[],
  lastSuccessAt: ReadonlyMap<string, Date | null>,
  now: Date,
): JobRegistration | null {
  let best: JobRegistration | null = null;
  let bestOverdueMs = -Infinity;

  for (const candidate of candidates) {
    const lastAt = lastSuccessAt.get(candidate.name) ?? null;
    const overdueMs = now.getTime() - (lastAt ? lastAt.getTime() : 0);
    if (overdueMs > bestOverdueMs) {
      bestOverdueMs = overdueMs;
      best = candidate;
    }
  }

  return best;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=@lhr/jobs`
Expected: PASS (16 tests total).

- [ ] **Step 5: Build the package to confirm `index.ts` now compiles end-to-end**

Run: `npm run build --workspace=@lhr/jobs`
Expected: succeeds, produces `packages/jobs/dist/index.js` and `.d.ts` files.

- [ ] **Step 6: Commit**

```bash
git add packages/jobs
git commit -m "feat: add due-check and most-overdue selection to @lhr/jobs"
```

---

### Task 3: `@lhr/db` — `orchestrator_runs` schema and CRUD accessors

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/src/schema.sql`
- Create: `packages/db/src/types.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/orchestratorRuns.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/tests/orchestratorRuns.test.ts`
- Modify: `package.json` (root `workspaces` array and `postinstall` script)

**Interfaces:**
- Produces: `Queryable` (`{ query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> }`),
  `getPool(): Pool` (a `pg.Pool`, structurally a `Queryable`), `RunStatus`, `OrchestratorRun`,
  `insertRunningRow(db: Queryable, jobName: string): Promise<number>`,
  `finishRun(db: Queryable, id: number, status: 'success'|'partial'|'failure', summary: string | null): Promise<void>`,
  `failRun(db: Queryable, id: number, errorMessage: string): Promise<void>`,
  `getLatestSuccess(db: Queryable, jobName: string): Promise<OrchestratorRun | null>`,
  `getRecentRunning(db: Queryable, jobName: string, sinceMs: number): Promise<OrchestratorRun | null>`,
  `getRunHistory(db: Queryable, jobName: string, limit: number): Promise<OrchestratorRun[]>`.
  All consumed by `apps/lhr-office/src/orchestrate.ts` and `server.ts` (Tasks 4–6).

- [ ] **Step 1: Add the workspace to the root `package.json`**

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/jobs",
    "packages/db"
  ],
```

```json
    "postinstall": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/jobs && npm run build --workspace=@lhr/db",
```

- [ ] **Step 2: Create the package scaffold**

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
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/db/tsconfig.json` (identical shape to `packages/jobs/tsconfig.json`):

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

`packages/db/src/schema.sql` (run manually against the provisioned Postgres — see Task 7):

```sql
CREATE TABLE orchestrator_runs (
  id SERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'running' | 'success' | 'partial' | 'failure'
  summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX orchestrator_runs_job_name_status_idx
  ON orchestrator_runs (job_name, status, started_at DESC);
```

`packages/db/src/types.ts`:

```ts
export type RunStatus = 'running' | 'success' | 'partial' | 'failure';

export interface OrchestratorRun {
  id: number;
  jobName: string;
  status: RunStatus;
  summary: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}
```

`packages/db/src/client.ts`:

```ts
import { Pool } from 'pg';

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireEnv('DATABASE_URL') });
  }
  return pool;
}
```

Run: `npm install`
Expected: installs `pg` and `@types/pg`, links `node_modules/@lhr/db`.

- [ ] **Step 3: Write the failing tests for the CRUD accessors**

`packages/db/tests/orchestratorRuns.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  insertRunningRow,
  finishRun,
  failRun,
  getLatestSuccess,
  getRecentRunning,
  getRunHistory,
} from '../src/orchestratorRuns';
import type { Queryable } from '../src/client';

function fakeDb(rows: Record<string, unknown>[]): Queryable & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe('insertRunningRow', () => {
  it('inserts a running row and returns its id', async () => {
    const db = fakeDb([{ id: 42 }]);
    const id = await insertRunningRow(db, 'recipe-variant-generator');
    expect(id).toBe(42);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO orchestrator_runs'),
      ['recipe-variant-generator'],
    );
  });
});

describe('finishRun', () => {
  it('updates the row with the final status and summary', async () => {
    const db = fakeDb([]);
    await finishRun(db, 42, 'success', 'did the thing');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orchestrator_runs'),
      [42, 'success', 'did the thing'],
    );
  });
});

describe('failRun', () => {
  it('updates the row with a failure status and error message', async () => {
    const db = fakeDb([]);
    await failRun(db, 42, 'boom');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE orchestrator_runs'),
      [42, 'boom'],
    );
  });
});

const rawRow = {
  id: 1,
  job_name: 'recipe-variant-generator',
  status: 'success' as const,
  summary: 'generated 1 variant',
  error_message: null,
  started_at: new Date('2026-08-20T00:00:00Z'),
  finished_at: new Date('2026-08-20T00:05:00Z'),
};

const mappedRow = {
  id: 1,
  jobName: 'recipe-variant-generator',
  status: 'success' as const,
  summary: 'generated 1 variant',
  errorMessage: null,
  startedAt: new Date('2026-08-20T00:00:00Z'),
  finishedAt: new Date('2026-08-20T00:05:00Z'),
};

describe('getLatestSuccess', () => {
  it('maps the most recent successful row', async () => {
    const db = fakeDb([rawRow]);
    expect(await getLatestSuccess(db, 'recipe-variant-generator')).toEqual(mappedRow);
  });

  it('returns null when there is no successful row', async () => {
    const db = fakeDb([]);
    expect(await getLatestSuccess(db, 'recipe-variant-generator')).toBeNull();
  });
});

describe('getRecentRunning', () => {
  it('maps a recent running row', async () => {
    const runningRow = { ...rawRow, status: 'running' as const, finished_at: null };
    const db = fakeDb([runningRow]);
    const result = await getRecentRunning(db, 'recipe-variant-generator', 10 * 60 * 1000);
    expect(result?.status).toBe('running');
    expect(result?.finishedAt).toBeNull();
  });

  it('returns null when there is no recent running row', async () => {
    const db = fakeDb([]);
    expect(await getRecentRunning(db, 'recipe-variant-generator', 10 * 60 * 1000)).toBeNull();
  });
});

describe('getRunHistory', () => {
  it('maps every row in the history', async () => {
    const db = fakeDb([rawRow, rawRow]);
    const result = await getRunHistory(db, 'recipe-variant-generator', 5);
    expect(result).toEqual([mappedRow, mappedRow]);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['recipe-variant-generator', 5]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace=@lhr/db`
Expected: FAIL — `Cannot find module '../src/orchestratorRuns'`.

- [ ] **Step 5: Write `orchestratorRuns.ts`**

`packages/db/src/orchestratorRuns.ts`:

```ts
import type { Queryable } from './client.js';
import type { OrchestratorRun, RunStatus } from './types.js';

interface RawRun {
  id: number;
  job_name: string;
  status: RunStatus;
  summary: string | null;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
}

function mapRow(row: RawRun): OrchestratorRun {
  return {
    id: row.id,
    jobName: row.job_name,
    status: row.status,
    summary: row.summary,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function insertRunningRow(db: Queryable, jobName: string): Promise<number> {
  const result = await db.query<{ id: number }>(
    `INSERT INTO orchestrator_runs (job_name, status) VALUES ($1, 'running') RETURNING id`,
    [jobName],
  );
  return result.rows[0].id;
}

export async function finishRun(
  db: Queryable,
  id: number,
  status: Extract<RunStatus, 'success' | 'partial' | 'failure'>,
  summary: string | null,
): Promise<void> {
  await db.query(
    `UPDATE orchestrator_runs SET status = $2, summary = $3, finished_at = now() WHERE id = $1`,
    [id, status, summary],
  );
}

export async function failRun(db: Queryable, id: number, errorMessage: string): Promise<void> {
  await db.query(
    `UPDATE orchestrator_runs SET status = 'failure', error_message = $2, finished_at = now() WHERE id = $1`,
    [id, errorMessage],
  );
}

export async function getLatestSuccess(db: Queryable, jobName: string): Promise<OrchestratorRun | null> {
  const result = await db.query<RawRun>(
    `SELECT * FROM orchestrator_runs WHERE job_name = $1 AND status = 'success' ORDER BY finished_at DESC LIMIT 1`,
    [jobName],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getRecentRunning(
  db: Queryable,
  jobName: string,
  sinceMs: number,
): Promise<OrchestratorRun | null> {
  const result = await db.query<RawRun>(
    `SELECT * FROM orchestrator_runs WHERE job_name = $1 AND status = 'running' AND started_at >= $2 ORDER BY started_at DESC LIMIT 1`,
    [jobName, new Date(Date.now() - sinceMs)],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getRunHistory(db: Queryable, jobName: string, limit: number): Promise<OrchestratorRun[]> {
  const result = await db.query<RawRun>(
    `SELECT * FROM orchestrator_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT $2`,
    [jobName, limit],
  );
  return result.rows.map(mapRow);
}
```

`packages/db/src/index.ts`:

```ts
export * from './types.js';
export * from './client.js';
export * from './orchestratorRuns.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace=@lhr/db`
Expected: PASS (9 tests).

- [ ] **Step 7: Build the package**

Run: `npm run build --workspace=@lhr/db`
Expected: succeeds, produces `packages/db/dist/`.

- [ ] **Step 8: Commit**

```bash
git add package.json packages/db
git commit -m "feat: add @lhr/db package with orchestrator_runs schema and accessors"
```

---

### Task 4: `apps/lhr-office` — orchestration engine (`orchestrate.ts`)

**Files:**
- Create: `apps/lhr-office/package.json`
- Create: `apps/lhr-office/tsconfig.json`
- Create: `apps/lhr-office/vitest.config.ts`
- Create: `apps/lhr-office/src/orchestrate.ts`
- Create: `apps/lhr-office/tests/orchestrate.test.ts`
- Modify: `package.json` (root `workspaces` array)

**Interfaces:**
- Consumes: `Queryable`, `getLatestSuccess`, `getRecentRunning`, `insertRunningRow`, `finishRun`,
  `failRun` from `@lhr/db` (Task 3); `JobRegistration`, `isDue`, `selectMostOverdue` from `@lhr/jobs`
  (Tasks 1–2).
- Produces: `OrchestrationOutcome = { outcome: 'nothing-due' } | { outcome: 'skipped'; job: string; reason: 'already-running' } | { outcome: 'ran'; job: string; status: 'success'|'partial'|'failure'; summary: string }`,
  `runDueJob(db: Queryable, registry: JobRegistration[]): Promise<OrchestrationOutcome>`,
  `runJobNow(db: Queryable, registry: JobRegistration[], jobName: string): Promise<OrchestrationOutcome | null>`
  (`null` means the name isn't in the registry). Both consumed by `server.ts` (Tasks 5–6).

- [ ] **Step 1: Add the workspace to the root `package.json`**

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/jobs",
    "packages/db",
    "apps/lhr-office"
  ],
```

- [ ] **Step 2: Create the package scaffold**

`apps/lhr-office/package.json`:

```json
{
  "name": "lhr-office",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "npm run build --workspace=@lhr/db && npm run build --workspace=@lhr/jobs && tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@lhr/db": "*",
    "@lhr/jobs": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`apps/lhr-office/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": false
  },
  "include": ["src/**/*.ts", "api/**/*.ts"]
}
```

`apps/lhr-office/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

Run: `npm install`
Expected: installs cleanly, links `node_modules/lhr-office` and resolves `@lhr/db`/`@lhr/jobs` from
the workspace.

- [ ] **Step 3: Write the failing tests for the orchestration engine**

`apps/lhr-office/tests/orchestrate.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { JobRegistration } from '@lhr/jobs';
import type { Queryable } from '@lhr/db';

const db = {
  getLatestSuccess: vi.fn(),
  getRecentRunning: vi.fn(),
  insertRunningRow: vi.fn(),
  finishRun: vi.fn(),
  failRun: vi.fn(),
};

vi.mock('@lhr/db', () => ({
  getLatestSuccess: (...args: unknown[]) => db.getLatestSuccess(...args),
  getRecentRunning: (...args: unknown[]) => db.getRecentRunning(...args),
  insertRunningRow: (...args: unknown[]) => db.insertRunningRow(...args),
  finishRun: (...args: unknown[]) => db.finishRun(...args),
  failRun: (...args: unknown[]) => db.failRun(...args),
}));

const { runDueJob, runJobNow } = await import('../src/orchestrate');

const fakeDb = {} as Queryable;

function job(name: string, run: JobRegistration['run'], cadenceDays = 7): JobRegistration {
  return { name, cadenceDays, run };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getLatestSuccess.mockResolvedValue(null);
  db.getRecentRunning.mockResolvedValue(null);
  db.insertRunningRow.mockResolvedValue(1);
});

describe('runDueJob', () => {
  it('returns nothing-due when no job is due', async () => {
    db.getLatestSuccess.mockResolvedValue({ finishedAt: new Date() });
    const outcome = await runDueJob(fakeDb, [job('a', vi.fn())]);
    expect(outcome).toEqual({ outcome: 'nothing-due' });
    expect(db.insertRunningRow).not.toHaveBeenCalled();
  });

  it('runs the only due job and records success', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'success', summary: 'did the thing' });
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(run).toHaveBeenCalledOnce();
    expect(db.insertRunningRow).toHaveBeenCalledWith(fakeDb, 'a');
    expect(db.finishRun).toHaveBeenCalledWith(fakeDb, 1, 'success', 'did the thing');
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'success', summary: 'did the thing' });
  });

  it('picks the most overdue job when multiple are due', async () => {
    db.getLatestSuccess.mockImplementation(async (_db: unknown, name: string) => {
      if (name === 'a') return { finishedAt: new Date('2026-08-01T00:00:00Z') };
      return { finishedAt: new Date('2026-07-01T00:00:00Z') };
    });
    const runA = vi.fn().mockResolvedValue({ status: 'success', summary: '' });
    const runB = vi.fn().mockResolvedValue({ status: 'success', summary: '' });
    await runDueJob(fakeDb, [job('a', runA), job('b', runB)]);
    expect(runB).toHaveBeenCalledOnce();
    expect(runA).not.toHaveBeenCalled();
  });

  it('skips a job with a recent running row instead of double-running it', async () => {
    db.getRecentRunning.mockResolvedValue({ startedAt: new Date() });
    const run = vi.fn();
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'skipped', job: 'a', reason: 'already-running' });
  });

  it('records a failure row and returns a failure outcome (not a throw) when the job throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'));
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(db.failRun).toHaveBeenCalledWith(fakeDb, 1, 'boom');
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
  });

  it('treats a partial result as a completed run, not a failure', async () => {
    const run = vi.fn().mockResolvedValue({ status: 'partial', summary: 'skipped 2 diets' });
    const outcome = await runDueJob(fakeDb, [job('a', run)]);
    expect(db.finishRun).toHaveBeenCalledWith(fakeDb, 1, 'partial', 'skipped 2 diets');
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'partial', summary: 'skipped 2 diets' });
  });
});

describe('runJobNow', () => {
  it('returns null for an unknown job name', async () => {
    expect(await runJobNow(fakeDb, [job('a', vi.fn())], 'nope')).toBeNull();
  });

  it('runs the named job even if it is not due', async () => {
    db.getLatestSuccess.mockResolvedValue({ finishedAt: new Date() }); // recently succeeded, still not due
    const run = vi.fn().mockResolvedValue({ status: 'success', summary: 'manual run' });
    const outcome = await runJobNow(fakeDb, [job('a', run)], 'a');
    expect(run).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ outcome: 'ran', job: 'a', status: 'success', summary: 'manual run' });
  });

  it('still applies the overlap guard', async () => {
    db.getRecentRunning.mockResolvedValue({ startedAt: new Date() });
    const run = vi.fn();
    const outcome = await runJobNow(fakeDb, [job('a', run)], 'a');
    expect(run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'skipped', job: 'a', reason: 'already-running' });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace=lhr-office`
Expected: FAIL — `Cannot find module '../src/orchestrate'`.

- [ ] **Step 5: Write `orchestrate.ts`**

`apps/lhr-office/src/orchestrate.ts`:

```ts
import type { Queryable } from '@lhr/db';
import { getLatestSuccess, getRecentRunning, insertRunningRow, finishRun, failRun } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { isDue, selectMostOverdue } from '@lhr/jobs';

const OVERLAP_WINDOW_MS = 10 * 60 * 1000;

export type OrchestrationOutcome =
  | { outcome: 'nothing-due' }
  | { outcome: 'skipped'; job: string; reason: 'already-running' }
  | { outcome: 'ran'; job: string; status: 'success' | 'partial' | 'failure'; summary: string };

export async function runDueJob(db: Queryable, registry: JobRegistration[]): Promise<OrchestrationOutcome> {
  const now = new Date();
  const lastSuccessAt = new Map<string, Date | null>();
  const due: JobRegistration[] = [];

  for (const candidate of registry) {
    const latest = await getLatestSuccess(db, candidate.name);
    const finishedAt = latest?.finishedAt ?? null;
    lastSuccessAt.set(candidate.name, finishedAt);
    if (isDue(candidate.cadenceDays, finishedAt, now)) due.push(candidate);
  }

  const selected = selectMostOverdue(due, lastSuccessAt, now);
  if (!selected) return { outcome: 'nothing-due' };

  return runIfNotOverlapping(db, selected);
}

export async function runJobNow(
  db: Queryable,
  registry: JobRegistration[],
  jobName: string,
): Promise<OrchestrationOutcome | null> {
  const job = registry.find((candidate) => candidate.name === jobName);
  if (!job) return null;
  return runIfNotOverlapping(db, job);
}

async function runIfNotOverlapping(db: Queryable, job: JobRegistration): Promise<OrchestrationOutcome> {
  const running = await getRecentRunning(db, job.name, OVERLAP_WINDOW_MS);
  if (running) return { outcome: 'skipped', job: job.name, reason: 'already-running' };

  const id = await insertRunningRow(db, job.name);
  try {
    const result = await job.run();
    await finishRun(db, id, result.status, result.summary);
    return { outcome: 'ran', job: job.name, status: result.status, summary: result.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(db, id, message);
    return { outcome: 'ran', job: job.name, status: 'failure', summary: message };
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace=lhr-office`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json apps/lhr-office
git commit -m "feat: add orchestration engine (due-check, overlap guard, execute) to apps/lhr-office"
```

---

### Task 5: `apps/lhr-office` — Express server, cron endpoint, Vercel deployment config

**Files:**
- Modify: `apps/lhr-office/package.json` (add `express`, esbuild, supertest deps + `build`/`test` scripts)
- Create: `apps/lhr-office/src/server.ts`
- Create: `apps/lhr-office/api/index.ts`
- Create: `apps/lhr-office/vercel.json`
- Create: `apps/lhr-office/scripts/bundle.mjs`
- Create: `apps/lhr-office/tests/server.test.ts`

**Interfaces:**
- Consumes: `runDueJob` from `./orchestrate.js` (Task 4); `Queryable`, `getPool` from `@lhr/db`;
  `JobRegistration`, `jobs` (the registry) from `@lhr/jobs`.
- Produces: `createApp(db: Queryable, registry?: JobRegistration[]): express.Express` — an Express
  app factory taking the DB client and job registry as parameters (defaults to the real registry),
  so tests never need a real Postgres connection. Consumed by Task 6 (adds `/status` routes to the
  same app) and by `api/index.ts` (the Vercel entrypoint).

- [ ] **Step 1: Add the new dependencies**

Update `apps/lhr-office/package.json` to:

```json
{
  "name": "lhr-office",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "npm run build --workspace=@lhr/db && npm run build --workspace=@lhr/jobs && tsc --noEmit -p tsconfig.json && node scripts/bundle.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "@lhr/db": "*",
    "@lhr/jobs": "*",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^22.0.0",
    "@types/supertest": "^6.0.0",
    "esbuild": "^0.24.0",
    "supertest": "^7.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `npm install`
Expected: installs `express`, `esbuild`, `supertest` and their types.

- [ ] **Step 2: Write the failing tests**

`apps/lhr-office/tests/server.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const runDueJobMock = vi.fn();
vi.mock('../src/orchestrate', () => ({
  runDueJob: (...args: unknown[]) => runDueJobMock(...args),
}));

const { createApp } = await import('../src/server');

const fakeDb = {} as Queryable;
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('cron endpoint auth', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator');
    expect(res.status).toBe(401);
    expect(runDueJobMock).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
    expect(runDueJobMock).not.toHaveBeenCalled();
  });

  it('runs the due-job check on GET with the correct secret (Vercel Cron issues GET)', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'nothing-due' });
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'nothing-due' });
    expect(runDueJobMock).toHaveBeenCalledWith(fakeDb, []);
  });

  it('also accepts POST with the correct secret (for manual testing)', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'nothing-due' });
    const app = createApp(fakeDb, []);
    const res = await request(app).post('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
  });

  it('returns 200 (not 500) with a failure outcome when a job throws', async () => {
    runDueJobMock.mockResolvedValue({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/api/cron/orchestrator').set('Authorization', 'Bearer test-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'ran', job: 'a', status: 'failure', summary: 'boom' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test --workspace=lhr-office`
Expected: FAIL — `Cannot find module '../src/server'`.

- [ ] **Step 4: Write `server.ts`**

`apps/lhr-office/src/server.ts`:

```ts
import express from 'express';
import type { Queryable } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from '@lhr/jobs';
import { runDueJob } from './orchestrate.js';

export function createApp(db: Queryable, registry: JobRegistration[] = defaultRegistry): express.Express {
  const app = express();
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const handleCron = async (req: express.Request, res: express.Response) => {
    const secret = process.env.CRON_SECRET;
    const authHeader = req.header('authorization') ?? '';
    if (!secret || authHeader !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const outcome = await runDueJob(db, registry);
    res.status(200).json(outcome);
  };

  // Vercel Cron always issues a GET request to the configured path; POST is
  // kept too so the endpoint can be triggered manually (e.g. via curl)
  // during setup and debugging.
  app.get('/api/cron/orchestrator', handleCron);
  app.post('/api/cron/orchestrator', handleCron);

  return app;
}
```

`apps/lhr-office/api/index.ts`:

```ts
import { getPool } from '@lhr/db';
import { createApp } from '../src/server.js';

export default createApp(getPool());
```

`apps/lhr-office/scripts/bundle.mjs`:

```js
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
};

await Promise.all([
  build({ ...shared, entryPoints: ['api/index.ts'], outfile: 'dist/api/index.js' }),
  build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/src/server.js' }),
]);
```

`apps/lhr-office/vercel.json`:

```json
{
  "version": 2,
  "rewrites": [
    { "source": "/(.*)", "destination": "/api" }
  ],
  "crons": [
    { "path": "/api/cron/orchestrator", "schedule": "0 13 * * *" }
  ]
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test --workspace=lhr-office`
Expected: PASS (6 tests, 15 total in this workspace).

- [ ] **Step 6: Run the full build to confirm the bundle compiles**

Run: `npm run build --workspace=lhr-office`
Expected: succeeds, produces `apps/lhr-office/dist/api/index.js` and `dist/src/server.js`.

- [ ] **Step 7: Commit**

```bash
git add apps/lhr-office
git commit -m "feat: add Express server with cron endpoint and Vercel deployment config"
```

---

### Task 6: `apps/lhr-office` — `/status` page and manual run-now

**Files:**
- Create: `apps/lhr-office/src/statusPage.ts`
- Create: `apps/lhr-office/tests/statusPage.test.ts`
- Modify: `apps/lhr-office/src/server.ts` (add `/status` and `/status/run/:jobName` routes)
- Modify: `apps/lhr-office/tests/server.test.ts` (mock `runJobNow` and `getRunHistory`, add route tests)

**Interfaces:**
- Consumes: `runJobNow` from `./orchestrate.js` (Task 4); `getRunHistory`, `OrchestratorRun` from
  `@lhr/db` (Task 3).
- Produces: `renderStatusPage(rows: JobStatusRow[]): string` where
  `JobStatusRow = { name: string; cadenceDays: number; history: OrchestratorRun[] }`.

- [ ] **Step 1: Write the failing test for the status page renderer**

`apps/lhr-office/tests/statusPage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderStatusPage } from '../src/statusPage';
import type { OrchestratorRun } from '@lhr/db';

const run: OrchestratorRun = {
  id: 1,
  jobName: 'recipe-variant-generator',
  status: 'success',
  summary: 'generated 1 variant',
  errorMessage: null,
  startedAt: new Date('2026-08-20T00:00:00Z'),
  finishedAt: new Date('2026-08-20T00:05:00Z'),
};

describe('renderStatusPage', () => {
  it('renders each job\'s name, cadence, and latest summary', () => {
    const html = renderStatusPage([{ name: 'recipe-variant-generator', cadenceDays: 7, history: [run] }]);
    expect(html).toContain('recipe-variant-generator');
    expect(html).toContain('generated 1 variant');
    expect(html).toContain('every 7 days');
  });

  it('renders a placeholder when no jobs are registered', () => {
    const html = renderStatusPage([]);
    expect(html).toContain('No jobs registered yet');
  });

  it('renders "never run" for a job with no history', () => {
    const html = renderStatusPage([{ name: 'affiliate-sourcing', cadenceDays: 7, history: [] }]);
    expect(html).toContain('never run');
  });

  it('escapes HTML in a job summary so a failure message cannot inject markup', () => {
    const dangerous: OrchestratorRun = { ...run, summary: '<script>alert(1)</script>' };
    const html = renderStatusPage([{ name: 'a', cadenceDays: 7, history: [dangerous] }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=lhr-office`
Expected: FAIL — `Cannot find module '../src/statusPage'`.

- [ ] **Step 3: Write `statusPage.ts`**

`apps/lhr-office/src/statusPage.ts`:

```ts
import type { OrchestratorRun } from '@lhr/db';

export interface JobStatusRow {
  name: string;
  cadenceDays: number;
  history: OrchestratorRun[];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function describeRun(run: OrchestratorRun): string {
  const detail = escapeHtml(run.summary ?? run.errorMessage ?? '');
  const when = run.finishedAt ? run.finishedAt.toISOString() : 'in progress';
  return `${escapeHtml(run.status)} — ${detail} (${when})`;
}

export function renderStatusPage(rows: JobStatusRow[]): string {
  const sections = rows
    .map((row) => {
      const latest = row.history[0];
      const historyItems = row.history
        .map((run) => `<li>${describeRun(run)} — started ${run.startedAt.toISOString()}</li>`)
        .join('');
      return `
        <section>
          <h2>${escapeHtml(row.name)}</h2>
          <p>Cadence: every ${row.cadenceDays} days</p>
          <p>Latest: ${latest ? describeRun(latest) : 'never run'}</p>
          <ul>${historyItems}</ul>
          <form method="post" action="/status/run/${encodeURIComponent(row.name)}">
            <button type="submit">Run now</button>
          </form>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Orchestrator status</title>
  </head>
  <body>
    <h1>Orchestrator status</h1>
    ${sections || '<p>No jobs registered yet.</p>'}
  </body>
</html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=lhr-office`
Expected: PASS (4 new tests).

- [ ] **Step 5: Write the failing tests for the `/status` routes**

Add to `apps/lhr-office/tests/server.test.ts` — extend the existing mock and add new `describe`
blocks:

```ts
// Replace the existing `vi.mock('../src/orchestrate', ...)` block with:
const runJobNowMock = vi.fn();
vi.mock('../src/orchestrate', () => ({
  runDueJob: (...args: unknown[]) => runDueJobMock(...args),
  runJobNow: (...args: unknown[]) => runJobNowMock(...args),
}));

// Add alongside the existing `const { createApp } = await import('../src/server');`:
const getRunHistoryMock = vi.fn();
vi.mock('@lhr/db', () => ({
  getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args),
}));
```

```ts
describe('GET /status', () => {
  it("renders each registered job's name and latest run", async () => {
    getRunHistoryMock.mockResolvedValue([
      {
        id: 1,
        jobName: 'recipe-variant-generator',
        status: 'success',
        summary: 'generated 1 variant',
        errorMessage: null,
        startedAt: new Date('2026-08-20T00:00:00Z'),
        finishedAt: new Date('2026-08-20T00:05:00Z'),
      },
    ]);
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.text).toContain('recipe-variant-generator');
    expect(res.text).toContain('generated 1 variant');
  });

  it('renders a placeholder when no jobs are registered', async () => {
    const app = createApp(fakeDb, []);
    const res = await request(app).get('/status');
    expect(res.text).toContain('No jobs registered yet');
  });
});

describe('POST /status/run/:jobName', () => {
  it('runs the named job and redirects back to /status', async () => {
    runJobNowMock.mockResolvedValue({ outcome: 'ran', job: 'recipe-variant-generator', status: 'success', summary: 'ok' });
    const app = createApp(fakeDb, [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]);
    const res = await request(app).post('/status/run/recipe-variant-generator');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
    expect(runJobNowMock).toHaveBeenCalledWith(fakeDb, expect.any(Array), 'recipe-variant-generator');
  });

  it('returns 404 for an unknown job name', async () => {
    runJobNowMock.mockResolvedValue(null);
    const app = createApp(fakeDb, []);
    const res = await request(app).post('/status/run/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test --workspace=lhr-office`
Expected: FAIL — `GET /status` returns 404 (no such route yet).

- [ ] **Step 7: Wire the routes into `server.ts`**

Update `apps/lhr-office/src/server.ts` — add these imports:

```ts
import { getRunHistory } from '@lhr/db';
import { runDueJob, runJobNow } from './orchestrate.js';
import { renderStatusPage } from './statusPage.js';
```

And add these two routes inside `createApp`, after the cron routes:

```ts
  app.get('/status', async (_req, res) => {
    const rows = await Promise.all(
      registry.map(async (job) => ({
        name: job.name,
        cadenceDays: job.cadenceDays,
        history: await getRunHistory(db, job.name, 5),
      })),
    );
    res.type('html').send(renderStatusPage(rows));
  });

  app.post('/status/run/:jobName', async (req, res) => {
    const outcome = await runJobNow(db, registry, req.params.jobName);
    if (outcome === null) {
      res.status(404).send('Unknown job');
      return;
    }
    res.redirect(303, '/status');
  });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test --workspace=lhr-office`
Expected: PASS (all tests in this workspace, ~21 total).

- [ ] **Step 9: Run the full build**

Run: `npm run build --workspace=lhr-office`
Expected: succeeds.

- [ ] **Step 10: Commit**

```bash
git add apps/lhr-office
git commit -m "feat: add /status page and manual run-now endpoint"
```

---

### Task 7: Operational setup documentation

**Files:**
- Modify: `docs/DEPLOYMENT.md` (append a new numbered section)

**Interfaces:** None — documentation only.

- [ ] **Step 1: Append the new section**

Add to the end of `docs/DEPLOYMENT.md`:

```markdown
7. Set up the automation orchestrator (`apps/lhr-office`), which runs the site's weekly automation
   jobs on a schedule — currently an empty engine with no jobs registered yet:
   - In the Vercel dashboard, import this same GitHub repository as a **second**, separate Vercel
     project, setting its **Root Directory** to `apps/lhr-office`. Vercel reads that project's own
     `apps/lhr-office/vercel.json` automatically.
   - Add the custom domain `office.loveheatrelationship.com` to this new project.
   - Provision a Postgres database (e.g. Vercel Postgres or Neon) and set `DATABASE_URL` on the
     `apps/lhr-office` Vercel project to its connection string.
   - Run the schema once against that database: `psql "$DATABASE_URL" -f packages/db/src/schema.sql`.
   - Generate a random secret (`openssl rand -hex 32`) and set it as `CRON_SECRET` on the
     `apps/lhr-office` Vercel project. Vercel automatically sends this value as
     `Authorization: Bearer <CRON_SECRET>` on requests it makes to the paths listed under `crons`
     in `vercel.json` — this is what stops `/api/cron/orchestrator` from being triggered by an
     arbitrary public request.
   - Confirm the Cron Job appears (enabled by default) in that Vercel project's Cron Jobs tab.
   - Push to `main` — Vercel auto-deploys this project the same way it does the main site.
   - Visit `https://office.loveheatrelationship.com/status` to confirm the page loads. Every job
     will show "No jobs registered yet" until agents are added to the registry (next bullet).
   - `packages/jobs/src/registry.ts` ships with zero entries. Each of the five planned automation
     agents (recipe variant generator, affiliate sourcing, trends watcher, competitor analysis,
     product-in-photo placement) is registered later, one at a time, in its own implementation
     plan, by appending a `JobRegistration` entry to that file — no other change to
     `apps/lhr-office` is needed to add a job. Each agent's own plan is also responsible for adding
     whatever env vars its pipeline needs (e.g. `OPENROUTER_API_KEY`, `KEEPA_API_KEY`,
     `SERPAPI_KEY`) to the `apps/lhr-office` Vercel project.
```

- [ ] **Step 2: Review the rendered section**

Run: `cat docs/DEPLOYMENT.md` (or open in an editor) and re-read the new section end to end for
accuracy against what Tasks 1–6 actually built (env var names, file paths, domain).
Expected: every path and env var name mentioned matches a file/variable introduced in Tasks 1–6.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: add apps/lhr-office operational setup instructions"
```

---

## Post-plan state

- `apps/lhr-office` is a fully working, tested, deployable orchestrator with an **empty** job
  registry — `GET/POST /api/cron/orchestrator` always returns `{ outcome: 'nothing-due' }`, and
  `/status` always shows "No jobs registered yet" until the first agent is registered.
- Registering the first real agent is a follow-up plan that: (a) implements that agent's pipeline
  as an exported `async () => JobResult` function somewhere in this repo, (b) adds one
  `JobRegistration` entry importing it into `packages/jobs/src/registry.ts`, and (c) adds that
  pipeline's own env vars to the `apps/lhr-office` Vercel project per Task 7's note. No other file
  from this plan needs to change.
