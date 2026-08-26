# Trends Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly-refreshed trends report (web design, cooking, nutrition), sourced from Google Trends via SerpApi and synthesized by an LLM into "what's worth knowing," viewable at `/trends` in a shared internal `apps/lhr-office` app behind real admin username/password login — and establish that admin-auth foundation (`office_admins`/`office_sessions`, `requireAdminSession()`) for the whole app, not just this feature.

**Architecture:** A local weekly cron script (`mcp-server/scripts/source-weekly-trends.ts`, thin wrapper around testable orchestration logic in `mcp-server/src/sourceWeeklyTrends.ts`) reads curated seed topics from Postgres, asks an OpenRouter LLM for up to 2 adjacent topic suggestions per category, pulls SerpApi Google Trends data (interest + related queries) for every curated + suggested topic plus one category-wide "trending now" wildcard call, updates the seed-topic table (increment/insert/auto-promote), synthesizes a summary via a second OpenRouter call, and writes one `trends_reports` row per category. The deployed side is two new page groups inside the already-scaffolding-in-progress `apps/lhr-office` Astro app: `/trends` (read-only report viewer) and `/admin` (manage admin accounts and seed topics), both gated by a shared `requireAdminSession()` helper backed by real scrypt-hashed username/password accounts — the auth layer every other route in this shared app (including the affiliate-review feature being built in parallel) depends on.

**Tech Stack:** TypeScript (strict), `pg` (node-postgres, Neon Postgres via `DATABASE_URL`), native `fetch` (SerpApi + OpenRouter — no new HTTP client dependency), `node:crypto` (`scrypt`/`timingSafeEqual` for password hashing, `randomBytes` for session tokens — no new dependency), Astro with `output: 'server'` + `@astrojs/vercel` adapter, Vitest, `tsx` (script runner, matching the existing `backfill:ingredient-links`/`generate:weekly-recipe` convention).

**Spec:** [docs/superpowers/specs/active/2026-08-24-trends-watcher-design.md](../../../.claude/worktrees/recipe-affiliate-agent-system-bd11aa/docs/superpowers/specs/active/2026-08-24-trends-watcher-design.md) *(this spec currently lives in a sibling worktree, branch `claude/recipe-affiliate-agent-system-bd11aa` — every section this plan implements is quoted or paraphrased below so no separate lookup is required to execute this plan)*

## Global Constraints

- **Cross-branch prerequisites (read before Task 1).** This worktree/branch (`claude/trends-watcher-design-cb1688`) currently has none of the shared infrastructure this spec builds on. Two sibling branches, developed in parallel worktrees, already have it:
  - `claude/affiliate-sourcing-agent-design-b97539` has `packages/db` (`@lhr/db` — Postgres schema/migrations/queries) and `packages/github` (`@lhr/github` — GitHub-as-database commit helper). This spec's own note confirms the intent: *"this spec builds on top of those rather than re-establishing them."*
  - `claude/recipe-affiliate-agent-system-bd11aa` has `mcp-server/src/openrouter.ts` (`callOpenRouter`), the shared OpenRouter LLM-call helper this spec's §2/§7 explicitly say to reuse ("consistent with the other two sub-projects").
  - Task 1 pulls these in verbatim via `git checkout <branch> -- <path>` (both branches are local refs in this same repository — no fetch needed) rather than reimplementing them, so this branch stays mergeable with the sibling work instead of diverging into a competing copy.
- **`apps/lhr-office` may already exist by the time this plan runs.** The affiliate-sourcing-agent plan (sibling branch, Task 13) scaffolds the same shared app concurrently, idempotently ("create only if missing"). Task 4 below mirrors that exact scaffold content so whichever plan lands first produces an identical result and the other's "if missing" check is a no-op.
- **`@lhr/github` is not used by this sub-project's own logic.** Pulled into the workspace only because `apps/lhr-office`'s scaffold (mirrored verbatim from the sibling plan) declares it as a dependency. Trends data lives entirely in Postgres — nothing this plan builds commits anything to git.
- **Promotion threshold:** a candidate topic crossing `times_seen >= 3` (three separate cycles' suggestion passes, not three mentions within one cycle) auto-promotes to `status='curated'` (spec §5).
- **Lockout:** 5 consecutive failed login attempts locks an account for 15 minutes (`locked_until`); a successful login resets `failed_attempts` to 0. `locked_until` in the past is treated as unlocked — no separate cleanup job (spec §3, §8).
- **Session cookie:** httpOnly + secure + `sameSite=lax`, holding the session id; 7-day expiry with sliding renewal on every authenticated request (spec §3).
- **`requireAdminSession()` gates every route** — page or API — in `apps/lhr-office`, redirecting to `/login` on any missing/invalid/expired session rather than ever rendering protected content on a failed check (spec §3, §8).
- **Partial reports, never a lost week:** a SerpApi failure for one topic is logged and that topic is skipped — the cycle still synthesizes and stores a report from whatever topics succeeded. A failure of the LLM synthesis call itself still writes the report row, with `summary` set to the literal placeholder `"[Summary generation failed this cycle]"` (spec §8).
- **Duplicate seed-topic upserts are conflict-safe**, not app-level races: the `UNIQUE (category, topic)` constraint plus `ON CONFLICT ... DO UPDATE` is the whole mechanism (spec §5, §8).
- **Budget cap** (not auto-enforced, just logged): curated seeds are expected to settle ~4-5/category; log the SerpApi call count per category per cycle so growth past that is visible before it becomes a problem (spec §6).
- All new Postgres-touching functions take an explicit `Pool` as their first parameter rather than a module-level singleton — mirrors the existing `@lhr/db` (`candidates.ts`, `decisionHistory.ts`) and `mcp-server/src/github.ts` dependency-injection style, which is what makes every module mockable in tests exactly like the rest of this codebase.
- **External API details this plan could not fully verify at planning time** — specifically SerpApi's exact `related_queries.top`/`related_queries.rising` item field names for the `RELATED_QUERIES` data type (SerpApi's own docs don't publish a sample response for it) — are called out explicitly at Task 9 with a concrete live-call verification step, never silently hard-coded as fact. `google_trends_trending_now`'s `category_id` values (`18`=Technology, `5`=Food and Drink, `7`=Health) were confirmed directly from SerpApi's published category list and are used as-is.

---

### Task 1: Pull in prerequisite shared packages and wire the workspace

**Files:**
- Create (via `git checkout`, unmodified): `packages/db/**`, `packages/github/**`
- Create (via `git checkout`, unmodified): `mcp-server/src/openrouter.ts`, `mcp-server/tests/openrouter.test.ts`
- Modify: `package.json` (root — add `packages/github`, `packages/db` to `workspaces` and their builds to `postinstall`)
- Modify: `mcp-server/package.json` (add `OPENROUTER_API_KEY`-consuming code has no new dependency — `openrouter.ts` only uses native `fetch` and the existing `requireEnv` from `./blob.js`, already present in this worktree; no dependency changes needed here)
- Modify: `.env.example` (add `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DATABASE_URL`, `SERPAPI_KEY`)

**Interfaces:**
- Produces: `@lhr/db` exporting `candidates.ts`/`decisionHistory.ts`/`scoring.ts`/`affiliateLinkFile.ts`/`migrate.ts`/`schema.ts` (from the sibling branch, unchanged by this task); `@lhr/github` exporting `createGitHubClient`, `commitFilesToMain`, etc. (unchanged); `callOpenRouter(messages: {role: 'system'|'user'; content: string}[]): Promise<string>` from `mcp-server/src/openrouter.ts`. Consumed by Tasks 2, 4, 7, 9.

- [ ] **Step 1: Pull `packages/db` and `packages/github` from the sibling branch**

```bash
git checkout claude/affiliate-sourcing-agent-design-b97539 -- packages/db packages/github
```

Expected: `packages/db/` and `packages/github/` now exist in this worktree, staged, containing `package.json`, `tsconfig.json`, `src/`, `tests/`, and (for `db`) `scripts/migrate.ts`.

- [ ] **Step 2: Pull `openrouter.ts` from the other sibling branch**

```bash
git checkout claude/recipe-affiliate-agent-system-bd11aa -- mcp-server/src/openrouter.ts mcp-server/tests/openrouter.test.ts
```

Expected: both files now exist, staged, unchanged from that branch.

- [ ] **Step 3: Wire the new workspaces into the root**

In root `package.json`, update `workspaces` and `postinstall`:

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/github",
    "packages/db"
  ],
```

```json
    "postinstall": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/github && npm run build --workspace=@lhr/db",
```

- [ ] **Step 4: Add the new env vars to `.env.example`**

Append to `.env.example`:

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
DATABASE_URL=
SERPAPI_KEY=
```

- [ ] **Step 5: Install and verify the build**

```bash
npm install
npm run build --workspace=@lhr/db
npm run build --workspace=@lhr/github
cd mcp-server && npx vitest run tests/openrouter.test.ts
```

Expected: both package builds succeed; `openrouter.test.ts` passes unchanged (it was already passing on the branch it came from).

- [ ] **Step 6: Commit**

```bash
git add packages/db packages/github mcp-server/src/openrouter.ts mcp-server/tests/openrouter.test.ts package.json package-lock.json .env.example
git commit -m "Pull in shared @lhr/db, @lhr/github, and openrouter.ts from sibling branches"
```

---

### Task 2: Admin accounts (`office_admins`) — schema, hashing, lockout

**Files:**
- Modify: `packages/db/src/schema.ts` (add `OFFICE_ADMINS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts` (run it)
- Create: `packages/db/src/officeAdmins.ts`
- Create: `packages/db/tests/officeAdmins.test.ts`
- Modify: `packages/db/src/index.ts` (export the new module)
- Modify: `packages/db/tests/migrate.test.ts` (assert the new table's migration runs)

**Interfaces:**
- Produces (from `@lhr/db`): `OfficeAdmin`, `OfficeAdminSummary`, `hashPassword(password): string`, `verifyPassword(password, stored): boolean`, `isLocked(admin: {lockedUntil: Date|null}): boolean`, `createAdmin(pool, username, password, createdBy: number|null): Promise<OfficeAdmin>`, `getAdminByUsername(pool, username): Promise<OfficeAdmin|null>`, `getAdminById(pool, id): Promise<OfficeAdmin|null>`, `listAdmins(pool): Promise<OfficeAdminSummary[]>`, `recordFailedAttempt(pool, adminId): Promise<void>`, `resetFailedAttempts(pool, adminId): Promise<void>`. Consumed by Tasks 4, 5, 6, 12.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/officeAdmins.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  isLocked,
  createAdmin,
  getAdminByUsername,
  getAdminById,
  listAdmins,
  recordFailedAttempt,
  resetFailedAttempts,
} from '../src/officeAdmins';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    expect(hashPassword('same password')).not.toBe(hashPassword('same password'));
  });

  it('rejects a malformed stored hash', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });
});

describe('isLocked', () => {
  it('is false when lockedUntil is null', () => {
    expect(isLocked({ lockedUntil: null })).toBe(false);
  });

  it('is false when lockedUntil is in the past', () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() - 1000) })).toBe(false);
  });

  it('is true when lockedUntil is in the future', () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });
});

describe('createAdmin', () => {
  it('inserts a hashed password and returns the created admin', async () => {
    const row = {
      id: 1, username: 'ash', password_hash: 'salt:hash', failed_attempts: 0,
      locked_until: null, created_at: new Date('2026-08-24T00:00:00Z'), created_by: null,
    };
    const pool = mockPool([row]);
    const result = await createAdmin(pool as never, 'ash', 'hunter2', null);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO office_admins'), [
      'ash', expect.any(String), null,
    ]);
    expect(result).toEqual({
      id: 1, username: 'ash', passwordHash: 'salt:hash', failedAttempts: 0,
      lockedUntil: null, createdAt: new Date('2026-08-24T00:00:00Z'), createdBy: null,
    });
  });
});

describe('getAdminByUsername / getAdminById', () => {
  const row = {
    id: 2, username: 'noah', password_hash: 'salt:hash', failed_attempts: 1,
    locked_until: null, created_at: new Date('2026-08-24T00:00:00Z'), created_by: 1,
  };

  it('returns null when no admin matches the username', async () => {
    const pool = mockPool([]);
    expect(await getAdminByUsername(pool as never, 'nobody')).toBeNull();
  });

  it('maps a found row to camelCase by username', async () => {
    const pool = mockPool([row]);
    const result = await getAdminByUsername(pool as never, 'noah');
    expect(result?.passwordHash).toBe('salt:hash');
    expect(result?.failedAttempts).toBe(1);
  });

  it('maps a found row to camelCase by id', async () => {
    const pool = mockPool([row]);
    const result = await getAdminById(pool as never, 2);
    expect(result?.username).toBe('noah');
  });
});

describe('listAdmins', () => {
  it('never includes passwordHash in the returned summaries', async () => {
    const row = {
      id: 3, username: 'guest', password_hash: 'salt:hash', failed_attempts: 0,
      locked_until: null, created_at: new Date('2026-08-24T00:00:00Z'), created_by: 1,
    };
    const pool = mockPool([row]);
    const result = await listAdmins(pool as never);
    expect(result).toEqual([{
      id: 3, username: 'guest', failedAttempts: 0, lockedUntil: null,
      createdAt: new Date('2026-08-24T00:00:00Z'), createdBy: 1,
    }]);
    expect(result[0]).not.toHaveProperty('passwordHash');
  });
});

describe('recordFailedAttempt', () => {
  it('increments failed_attempts and does not lock below the threshold', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ failed_attempts: 3 }] }) };
    await recordFailedAttempt(pool as never, 5);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('failed_attempts = failed_attempts + 1');
  });

  it('locks the account once failed_attempts reaches 5', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ failed_attempts: 5 }] }) };
    await recordFailedAttempt(pool as never, 5);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][0]).toContain('locked_until');
  });
});

describe('resetFailedAttempts', () => {
  it('clears failed_attempts and locked_until', async () => {
    const pool = mockPool();
    await resetFailedAttempts(pool as never, 5);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('failed_attempts = 0'), [5]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/officeAdmins.test.ts
```

Expected: FAIL — `../src/officeAdmins` does not exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append:

```ts
export const OFFICE_ADMINS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS office_admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES office_admins(id)
);
`;
```

- [ ] **Step 4: Implement `officeAdmins.ts`**

`packages/db/src/officeAdmins.ts`:

```ts
import type { Pool, QueryResult } from 'pg';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface OfficeAdmin {
  id: number;
  username: string;
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  createdBy: number | null;
}

export type OfficeAdminSummary = Omit<OfficeAdmin, 'passwordHash'>;

interface OfficeAdminRow {
  id: number;
  username: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  created_by: number | null;
}

const SCRYPT_KEYLEN = 64;
const LOCKOUT_THRESHOLD = 5;

function rowToAdmin(row: OfficeAdminRow): OfficeAdmin {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function isLocked(admin: Pick<OfficeAdmin, 'lockedUntil'>): boolean {
  return admin.lockedUntil !== null && admin.lockedUntil.getTime() > Date.now();
}

export async function createAdmin(
  pool: Pool,
  username: string,
  password: string,
  createdBy: number | null,
): Promise<OfficeAdmin> {
  const passwordHash = hashPassword(password);
  const res = (await pool.query(
    `INSERT INTO office_admins (username, password_hash, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [username, passwordHash, createdBy],
  )) as QueryResult<OfficeAdminRow>;
  return rowToAdmin(res.rows[0]);
}

export async function getAdminByUsername(pool: Pool, username: string): Promise<OfficeAdmin | null> {
  const res = (await pool.query(
    `SELECT * FROM office_admins WHERE username = $1`,
    [username],
  )) as QueryResult<OfficeAdminRow>;
  return res.rows[0] ? rowToAdmin(res.rows[0]) : null;
}

export async function getAdminById(pool: Pool, id: number): Promise<OfficeAdmin | null> {
  const res = (await pool.query(`SELECT * FROM office_admins WHERE id = $1`, [id])) as QueryResult<OfficeAdminRow>;
  return res.rows[0] ? rowToAdmin(res.rows[0]) : null;
}

export async function listAdmins(pool: Pool): Promise<OfficeAdminSummary[]> {
  const res = (await pool.query(
    `SELECT * FROM office_admins ORDER BY created_at ASC`,
  )) as QueryResult<OfficeAdminRow>;
  return res.rows.map(rowToAdmin).map(({ passwordHash: _passwordHash, ...rest }) => rest);
}

export async function recordFailedAttempt(pool: Pool, adminId: number): Promise<void> {
  const res = (await pool.query(
    `UPDATE office_admins SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts`,
    [adminId],
  )) as QueryResult<{ failed_attempts: number }>;
  const failedAttempts = res.rows[0]?.failed_attempts ?? 0;
  if (failedAttempts >= LOCKOUT_THRESHOLD) {
    await pool.query(
      `UPDATE office_admins SET locked_until = now() + interval '15 minutes' WHERE id = $1`,
      [adminId],
    );
  }
}

export async function resetFailedAttempts(pool: Pool, adminId: number): Promise<void> {
  await pool.query(`UPDATE office_admins SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [adminId]);
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`:

```ts
import type { Pool } from 'pg';
import { CANDIDATES_TABLE_SQL, DECISION_HISTORY_TABLE_SQL, OFFICE_ADMINS_TABLE_SQL } from './schema.js';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(CANDIDATES_TABLE_SQL);
  await pool.query(DECISION_HISTORY_TABLE_SQL);
  await pool.query(OFFICE_ADMINS_TABLE_SQL);
}
```

In `packages/db/src/index.ts`, add:

```ts
export * from './officeAdmins.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the office_admins table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS office_admins'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS (all of `officeAdmins.test.ts`, updated `migrate.test.ts`, and every pre-existing test).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/officeAdmins.ts packages/db/src/index.ts packages/db/tests/officeAdmins.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add office_admins table with scrypt hashing and lockout logic"
```

---

### Task 3: Admin sessions (`office_sessions`)

**Files:**
- Modify: `packages/db/src/schema.ts` (add `OFFICE_SESSIONS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts`
- Create: `packages/db/src/officeSessions.ts`
- Create: `packages/db/tests/officeSessions.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/tests/migrate.test.ts`

**Interfaces:**
- Produces: `OfficeSession`, `createSession(pool, adminId): Promise<OfficeSession>`, `getSession(pool, id): Promise<OfficeSession|null>`, `renewSession(pool, id): Promise<void>`, `deleteSession(pool, id): Promise<void>`. Consumed by Task 4 (`requireAdminSession`), Task 5 (login/logout routes).

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/officeSessions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSession, getSession, renewSession, deleteSession } from '../src/officeSessions';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSession', () => {
  it('inserts a random session id with a 7-day expiry and returns it', async () => {
    const pool = { query: vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => ({
      rows: [{ id: params[0], admin_id: params[1], created_at: new Date('2026-08-24T00:00:00Z'), expires_at: params[2] }],
    })) };
    const before = Date.now();
    const session = await createSession(pool as never, 7);
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(session.adminId).toBe(7);
    const expiresInMs = session.expiresAt.getTime() - before;
    expect(expiresInMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(expiresInMs).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });
});

describe('getSession', () => {
  it('returns null when no session matches', async () => {
    const pool = mockPool([]);
    expect(await getSession(pool as never, 'nope')).toBeNull();
  });

  it('maps a found row to camelCase', async () => {
    const row = { id: 'abc', admin_id: 1, created_at: new Date('2026-08-24T00:00:00Z'), expires_at: new Date('2026-08-31T00:00:00Z') };
    const pool = mockPool([row]);
    const result = await getSession(pool as never, 'abc');
    expect(result).toEqual({ id: 'abc', adminId: 1, createdAt: row.created_at, expiresAt: row.expires_at });
  });
});

describe('renewSession', () => {
  it('pushes expires_at forward by 7 days from now', async () => {
    const pool = mockPool();
    await renewSession(pool as never, 'abc');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE office_sessions SET expires_at'), [
      expect.any(Date), 'abc',
    ]);
  });
});

describe('deleteSession', () => {
  it('deletes the session row', async () => {
    const pool = mockPool();
    await deleteSession(pool as never, 'abc');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM office_sessions'), ['abc']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/officeSessions.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append:

```ts
export const OFFICE_SESSIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS office_sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES office_admins(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
`;
```

- [ ] **Step 4: Implement `officeSessions.ts`**

`packages/db/src/officeSessions.ts`:

```ts
import type { Pool, QueryResult } from 'pg';
import { randomBytes } from 'node:crypto';

export interface OfficeSession {
  id: string;
  adminId: number;
  createdAt: Date;
  expiresAt: Date;
}

interface OfficeSessionRow {
  id: string;
  admin_id: number;
  created_at: Date;
  expires_at: Date;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function rowToSession(row: OfficeSessionRow): OfficeSession {
  return { id: row.id, adminId: row.admin_id, createdAt: row.created_at, expiresAt: row.expires_at };
}

export async function createSession(pool: Pool, adminId: number): Promise<OfficeSession> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const res = (await pool.query(
    `INSERT INTO office_sessions (id, admin_id, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [id, adminId, expiresAt],
  )) as QueryResult<OfficeSessionRow>;
  return rowToSession(res.rows[0]);
}

export async function getSession(pool: Pool, id: string): Promise<OfficeSession | null> {
  const res = (await pool.query(`SELECT * FROM office_sessions WHERE id = $1`, [id])) as QueryResult<OfficeSessionRow>;
  return res.rows[0] ? rowToSession(res.rows[0]) : null;
}

export async function renewSession(pool: Pool, id: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(`UPDATE office_sessions SET expires_at = $1 WHERE id = $2`, [expiresAt, id]);
}

export async function deleteSession(pool: Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM office_sessions WHERE id = $1`, [id]);
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`, import and call `OFFICE_SESSIONS_TABLE_SQL` after `OFFICE_ADMINS_TABLE_SQL` (sessions reference admins via foreign key, so admins must migrate first):

```ts
import type { Pool } from 'pg';
import {
  CANDIDATES_TABLE_SQL,
  DECISION_HISTORY_TABLE_SQL,
  OFFICE_ADMINS_TABLE_SQL,
  OFFICE_SESSIONS_TABLE_SQL,
} from './schema.js';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(CANDIDATES_TABLE_SQL);
  await pool.query(DECISION_HISTORY_TABLE_SQL);
  await pool.query(OFFICE_ADMINS_TABLE_SQL);
  await pool.query(OFFICE_SESSIONS_TABLE_SQL);
}
```

In `packages/db/src/index.ts`, add:

```ts
export * from './officeSessions.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the office_sessions table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS office_sessions'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/officeSessions.ts packages/db/src/index.ts packages/db/tests/officeSessions.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add office_sessions table with sliding 7-day expiry"
```

---

### Task 4: Scaffold `apps/lhr-office` and the shared `requireAdminSession()` helper

**Files:**
- Create (only if missing — mirrored verbatim from the sibling affiliate-sourcing-agent plan's Task 13 so both plans converge on the same scaffold): `apps/lhr-office/package.json`, `apps/lhr-office/astro.config.mjs`, `apps/lhr-office/tsconfig.json`, `apps/lhr-office/src/pages/index.astro`
- Create (only if missing): `apps/lhr-office/src/lib/db.ts`
- Create: `apps/lhr-office/src/lib/auth.ts`
- Create: `apps/lhr-office/vitest.config.ts`
- Create: `apps/lhr-office/tests/auth.test.ts`
- Modify: `package.json` (root — add `apps/lhr-office` to `workspaces` if not already present)
- Modify: `vitest.config.ts` (root — exclude `apps/**`)

**Interfaces:**
- Consumes: `getSession`, `renewSession`, `getAdminById`, `type OfficeAdmin` (`@lhr/db`).
- Produces: `getPool(): Pool` (`apps/lhr-office/src/lib/db.ts`); `requireAdminSession(context: AuthContext): Promise<AuthResult>`, `type AuthContext`, `type AuthResult` (`apps/lhr-office/src/lib/auth.ts`) — consumed by every page/route task from here on (Tasks 5, 11, 12, 13).

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

- [ ] **Step 2b: If `EXISTS`, just confirm the dependencies this task needs are present**

Read the existing `apps/lhr-office/package.json`. If `@lhr/db` or `pg`/`@types/pg` are missing from it, add them (leave everything else untouched). Confirm `apps/lhr-office/astro.config.mjs` already has `output: 'server'` and a Vercel adapter — if it doesn't, this feature's routes won't run server-side; stop and flag this rather than silently proceeding.

- [ ] **Step 3: Add the shared DB pool helper (only if missing)**

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

If this file already exists (the sibling plan's Task 13 created it first), leave it untouched — this is the exact content it would already contain.

- [ ] **Step 4: Wire the workspace into the root**

In root `package.json`, add `"apps/lhr-office"` to `workspaces` if it isn't already listed:

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

Then:

```bash
npm install
```

- [ ] **Step 5: Add a vitest config for the app (only if missing)**

`apps/lhr-office/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 6: Write the failing auth tests**

`apps/lhr-office/tests/auth.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const dbMock = {
  getSession: vi.fn(),
  renewSession: vi.fn(),
  getAdminById: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const { requireAdminSession } = await import('../src/lib/auth');

function makeContext(cookieValue: string | undefined) {
  const redirectResponse = new Response(null, { status: 302 });
  return {
    cookies: { get: vi.fn(() => (cookieValue === undefined ? undefined : { value: cookieValue })) },
    redirect: vi.fn(() => redirectResponse),
  };
}

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAdminSession', () => {
  it('redirects to /login when there is no session cookie', async () => {
    const context = makeContext(undefined);
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
    expect(context.redirect).toHaveBeenCalledWith('/login');
    expect(dbMock.getSession).not.toHaveBeenCalled();
  });

  it('redirects to /login when the session does not exist', async () => {
    dbMock.getSession.mockResolvedValue(null);
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
    expect(context.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when the session is expired', async () => {
    dbMock.getSession.mockResolvedValue({ id: 'sess-1', adminId: 1, createdAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
    expect(context.redirect).toHaveBeenCalledWith('/login');
  });

  it('returns the admin and renews the session on a valid session', async () => {
    dbMock.getSession.mockResolvedValue({ id: 'sess-1', adminId: 1, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    dbMock.getAdminById.mockResolvedValue(admin);
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('admin' in result && result.admin).toEqual(admin);
    expect(dbMock.renewSession).toHaveBeenCalledWith(mockPool, 'sess-1');
    expect(context.redirect).not.toHaveBeenCalled();
  });

  it('redirects to /login when the session references a since-deleted admin', async () => {
    dbMock.getSession.mockResolvedValue({ id: 'sess-1', adminId: 999, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    dbMock.getAdminById.mockResolvedValue(null);
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/auth.test.ts
```

Expected: FAIL — `../src/lib/auth` does not exist yet.

- [ ] **Step 8: Implement `auth.ts`**

`apps/lhr-office/src/lib/auth.ts`:

```ts
import { getPool } from './db.js';
import { getSession, renewSession, getAdminById, type OfficeAdmin } from '@lhr/db';

const SESSION_COOKIE = 'office_session';

export interface AuthContext {
  cookies: { get(name: string): { value: string } | undefined };
  redirect(path: string): Response;
}

export type AuthResult = { admin: OfficeAdmin } | { response: Response };

export async function requireAdminSession(context: AuthContext): Promise<AuthResult> {
  const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return { response: context.redirect('/login') };

  const pool = getPool();
  const session = await getSession(pool, sessionId);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    return { response: context.redirect('/login') };
  }

  const admin = await getAdminById(pool, session.adminId);
  if (!admin) return { response: context.redirect('/login') };

  await renewSession(pool, sessionId);
  return { admin };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/auth.test.ts
```

Expected: PASS.

- [ ] **Step 10: Verify the app builds**

```bash
cd apps/lhr-office && npm run build
```

Expected: succeeds.

- [ ] **Step 11: Commit**

```bash
git add apps/lhr-office package.json package-lock.json vitest.config.ts
git commit -m "Scaffold shared lhr-office app (or extend it) with requireAdminSession()"
```

---

### Task 5: Login, logout, and gating the root page

**Files:**
- Create: `apps/lhr-office/src/pages/login.astro`
- Create: `apps/lhr-office/src/pages/api/login.ts`
- Create: `apps/lhr-office/src/pages/api/logout.ts`
- Create: `apps/lhr-office/tests/login.test.ts`
- Create: `apps/lhr-office/tests/logout.test.ts`
- Modify: `apps/lhr-office/src/pages/index.astro` (gate with `requireAdminSession`, add links to `/trends` and `/admin`)

**Interfaces:**
- Consumes: `requireAdminSession`, `SESSION_COOKIE_NAME` (`../lib/auth.js`); `getPool` (`../lib/db.js`); `getAdminByUsername`, `isLocked`, `verifyPassword`, `recordFailedAttempt`, `resetFailedAttempts`, `createSession`, `deleteSession` (`@lhr/db`).
- Produces: `/login` page, `POST /api/login`, `POST /api/logout`.

- [ ] **Step 1: Write the failing API tests**

`apps/lhr-office/tests/login.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const dbMock = {
  getAdminByUsername: vi.fn(),
  isLocked: vi.fn(() => false),
  verifyPassword: vi.fn(),
  recordFailedAttempt: vi.fn(),
  resetFailedAttempts: vi.fn(),
  createSession: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/login');

const admin = { id: 1, username: 'ash', passwordHash: 'stored-hash', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(username: string, password: string) {
  const form = new FormData();
  form.set('username', username);
  form.set('password', password);
  const cookies = { set: vi.fn() };
  const redirectResponse = new Response(null, { status: 302 });
  return { request: new Request('http://localhost/api/login', { method: 'POST', body: form }), cookies, redirect: vi.fn(() => redirectResponse) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.isLocked.mockReturnValue(false);
});

describe('POST /api/login', () => {
  it('creates a session and sets the cookie on correct credentials', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(admin);
    dbMock.verifyPassword.mockReturnValue(true);
    dbMock.createSession.mockResolvedValue({ id: 'sess-1', adminId: 1, createdAt: new Date(), expiresAt: new Date() });

    const context = makeContext('ash', 'correct-password');
    const res = await POST(context as never);

    expect(dbMock.resetFailedAttempts).toHaveBeenCalledWith(mockPool, 1);
    expect(context.cookies.set).toHaveBeenCalledWith(
      'office_session', 'sess-1',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
    expect(context.redirect).toHaveBeenCalledWith('/');
    expect(res.status).toBe(302);
  });

  it('returns 401 and records a failed attempt on wrong password', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(admin);
    dbMock.verifyPassword.mockReturnValue(false);

    const context = makeContext('ash', 'wrong-password');
    const res = await POST(context as never);

    expect(res.status).toBe(401);
    expect(dbMock.recordFailedAttempt).toHaveBeenCalledWith(mockPool, 1);
    expect(dbMock.createSession).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown username without leaking which part was wrong', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(null);
    const context = makeContext('nobody', 'anything');
    const res = await POST(context as never);
    expect(res.status).toBe(401);
  });

  it('returns 423 when the account is locked', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(admin);
    dbMock.isLocked.mockReturnValue(true);
    const context = makeContext('ash', 'correct-password');
    const res = await POST(context as never);
    expect(res.status).toBe(423);
    expect(dbMock.verifyPassword).not.toHaveBeenCalled();
  });
});
```

`apps/lhr-office/tests/logout.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const dbMock = { deleteSession: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/logout');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/logout', () => {
  it('deletes the session and clears the cookie', async () => {
    const cookies = { get: vi.fn(() => ({ value: 'sess-1' })), delete: vi.fn() };
    const redirectResponse = new Response(null, { status: 302 });
    const context = { cookies, redirect: vi.fn(() => redirectResponse) };

    const res = await POST(context as never);

    expect(dbMock.deleteSession).toHaveBeenCalledWith(mockPool, 'sess-1');
    expect(cookies.delete).toHaveBeenCalledWith('office_session', expect.objectContaining({ path: '/' }));
    expect(context.redirect).toHaveBeenCalledWith('/login');
    expect(res.status).toBe(302);
  });

  it('redirects to /login without erroring when there is no session cookie', async () => {
    const cookies = { get: vi.fn(() => undefined), delete: vi.fn() };
    const redirectResponse = new Response(null, { status: 302 });
    const context = { cookies, redirect: vi.fn(() => redirectResponse) };

    await POST(context as never);

    expect(dbMock.deleteSession).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith('/login');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/login.test.ts tests/logout.test.ts
```

Expected: FAIL — route modules don't exist yet.

- [ ] **Step 3: Implement the login page and API routes**

`apps/lhr-office/src/pages/login.astro`:

```astro
---
const error = Astro.url.searchParams.get('error');
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Log in — LHR Office</title>
    <style>
      body { font-family: sans-serif; max-width: 360px; margin: 4rem auto; padding: 0 1rem; }
      label { display: block; margin-top: 1rem; font-size: 0.9rem; }
      input { width: 100%; padding: 0.5rem; font-size: 1rem; margin-top: 0.25rem; box-sizing: border-box; }
      button { margin-top: 1.5rem; width: 100%; padding: 0.6rem; font-size: 1rem; cursor: pointer; }
      .error { color: #dc2626; font-size: 0.9rem; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>LHR Office</h1>
    <form method="POST" action="/api/login">
      <label>Username<input type="text" name="username" required autofocus /></label>
      <label>Password<input type="password" name="password" required /></label>
      <button type="submit">Log in</button>
    </form>
    {error && <p class="error">{error}</p>}
  </body>
</html>
```

`apps/lhr-office/src/pages/api/login.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../lib/db.js';
import { getAdminByUsername, isLocked, verifyPassword, recordFailedAttempt, resetFailedAttempts, createSession } from '@lhr/db';

const SESSION_COOKIE = 'office_session';
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export async function POST({ request, cookies, redirect }: APIContext): Promise<Response> {
  const form = await request.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');

  const pool = getPool();
  const admin = await getAdminByUsername(pool, username);
  if (!admin) {
    return new Response('Invalid username or password', { status: 401 });
  }
  if (isLocked(admin)) {
    return new Response('Account locked. Try again in 15 minutes.', { status: 423 });
  }
  if (!verifyPassword(password, admin.passwordHash)) {
    await recordFailedAttempt(pool, admin.id);
    return new Response('Invalid username or password', { status: 401 });
  }

  await resetFailedAttempts(pool, admin.id);
  const session = await createSession(pool, admin.id);
  cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SEVEN_DAYS_SECONDS,
  });
  return redirect('/');
}
```

`apps/lhr-office/src/pages/api/logout.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../lib/db.js';
import { deleteSession } from '@lhr/db';

const SESSION_COOKIE = 'office_session';

export async function POST({ cookies, redirect }: APIContext): Promise<Response> {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await deleteSession(getPool(), sessionId);
  }
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login');
}
```

- [ ] **Step 4: Gate the root page and add nav links**

`apps/lhr-office/src/pages/index.astro`:

```astro
---
import { requireAdminSession } from '../lib/auth.js';

const authResult = await requireAdminSession(Astro);
if ('response' in authResult) {
  return authResult.response;
}
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>LHR Office</title>
  </head>
  <body>
    <h1>LHR Office</h1>
    <ul>
      <li><a href="/trends/">Trends report</a></li>
      <li><a href="/admin/">Admin</a></li>
      <li><a href="/affiliate-review/">Affiliate candidate review</a></li>
    </ul>
    <form method="POST" action="/api/logout"><button type="submit">Log out</button></form>
  </body>
</html>
```

*(Leave the `/affiliate-review/` link in place even if that route doesn't exist in this worktree yet — it's built by the sibling plan and this link is what makes it reachable once both merge; a dead link until then is harmless.)*

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run
```

Expected: PASS (all tests in the app, including `auth.test.ts` from Task 4).

- [ ] **Step 6: Manual verification**

```bash
cd apps/lhr-office && npm run dev
```

Visit `http://localhost:4321/` — confirm it redirects to `/login` (no session cookie yet). This confirms the gate works end-to-end; full login-flow verification (creating a real admin and logging in) happens after Task 6 provides a way to create one.

- [ ] **Step 7: Commit**

```bash
git add apps/lhr-office/src/pages/login.astro apps/lhr-office/src/pages/api/login.ts apps/lhr-office/src/pages/api/logout.ts apps/lhr-office/src/pages/index.astro apps/lhr-office/tests/login.test.ts apps/lhr-office/tests/logout.test.ts
git commit -m "Add login/logout routes and gate the office app's root page"
```

---

### Task 6: Bootstrap script for the first admin account

**Files:**
- Create: `mcp-server/scripts/create-office-admin.ts`
- Modify: `mcp-server/package.json` (add `@lhr/db` dependency, add `create-office-admin` script)

**Interfaces:**
- Consumes: `createAdmin` (`@lhr/db`).

- [ ] **Step 1: Add the dependency and script entry**

In `mcp-server/package.json`, add to `dependencies`:

```json
    "@lhr/db": "*",
```

and to `scripts`:

```json
    "create-office-admin": "tsx scripts/create-office-admin.ts"
```

- [ ] **Step 2: Implement the script**

`mcp-server/scripts/create-office-admin.ts`:

```ts
import { Pool } from 'pg';
import { createAdmin } from '@lhr/db';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: tsx scripts/create-office-admin.ts <username> <password>');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL env var is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const admin = await createAdmin(pool, username, password, null);
  console.log(`Created admin "${admin.username}" (id ${admin.id}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Install and verify it type-checks**

```bash
npm install
cd mcp-server && npx tsc --noEmit -p tsconfig.json
```

Expected: no type errors.

- [ ] **Step 4: Manual verification with a real dev database**

This needs a real `DATABASE_URL` — run by hand once:

```bash
cd packages/db && npm run db:migrate   # applies all migrations, including office_admins/office_sessions
cd ../../mcp-server && DATABASE_URL="$DATABASE_URL" npm run create-office-admin -- ash a-real-password
```

Expected: logs `Created admin "ash" (id 1).`. Confirm via `psql "$DATABASE_URL" -c "SELECT username FROM office_admins;"`.

Then, with `apps/lhr-office` running (`cd apps/lhr-office && npm run dev`), visit `/login`, log in as `ash`, and confirm you land on `/` and see the nav links from Task 5.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/scripts/create-office-admin.ts mcp-server/package.json package-lock.json
git commit -m "Add bootstrap script for the first office admin account"
```

---

### Task 7: Seed topic management (`trend_seed_topics`)

**Files:**
- Modify: `packages/db/src/schema.ts` (add `TREND_SEED_TOPICS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts`
- Create: `packages/db/src/trendSeedTopics.ts`
- Create: `packages/db/tests/trendSeedTopics.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/tests/migrate.test.ts`

**Interfaces:**
- Produces: `TREND_CATEGORIES` (`readonly ['web-design', 'cooking', 'nutrition']`), `type TrendCategory`, `TrendSeedTopic`, `normalizeTopic(topic): string`, `getCuratedTopics(pool, category): Promise<TrendSeedTopic[]>`, `getAllTopics(pool): Promise<TrendSeedTopic[]>`, `upsertSuggestedTopic(pool, category, topic): Promise<TrendSeedTopic>`, `promoteEligibleCandidates(pool): Promise<TrendSeedTopic[]>`, `setTopicStatus(pool, id, status: 'curated'|'candidate'): Promise<void>`, `addCuratedTopic(pool, category, topic): Promise<TrendSeedTopic>`. Consumed by Tasks 8, 10, 13.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/trendSeedTopics.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  normalizeTopic,
  getCuratedTopics,
  getAllTopics,
  upsertSuggestedTopic,
  promoteEligibleCandidates,
  setTopicStatus,
  addCuratedTopic,
} from '../src/trendSeedTopics';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const topicRow = {
  id: 1, category: 'cooking', topic: 'air fryer recipes', status: 'candidate', times_seen: 2,
  first_seen_at: new Date('2026-08-01T00:00:00Z'), last_seen_at: new Date('2026-08-15T00:00:00Z'), promoted_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeTopic', () => {
  it('lowercases and trims without any fuzzy matching', () => {
    expect(normalizeTopic('  Air Fryer Recipes  ')).toBe('air fryer recipes');
    expect(normalizeTopic('AIR FRYER RECIPES')).toBe('air fryer recipes');
  });
});

describe('getCuratedTopics', () => {
  it('queries curated rows for one category', async () => {
    const pool = mockPool([{ ...topicRow, status: 'curated' }]);
    const result = await getCuratedTopics(pool as never, 'cooking');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'curated'"), ['cooking']);
    expect(result[0].status).toBe('curated');
  });
});

describe('getAllTopics', () => {
  it('returns every topic across categories', async () => {
    const pool = mockPool([topicRow]);
    const result = await getAllTopics(pool as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 1, category: 'cooking', topic: 'air fryer recipes', status: 'candidate', timesSeen: 2,
      firstSeenAt: topicRow.first_seen_at, lastSeenAt: topicRow.last_seen_at, promotedAt: null,
    });
  });
});

describe('upsertSuggestedTopic', () => {
  it('normalizes the topic and issues an insert-or-increment upsert', async () => {
    const pool = mockPool([topicRow]);
    await upsertSuggestedTopic(pool as never, 'cooking', '  Air Fryer Recipes  ');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (category, topic)'),
      ['cooking', 'air fryer recipes'],
    );
    expect(pool.query.mock.calls[0][0]).toContain('times_seen = trend_seed_topics.times_seen + 1');
  });
});

describe('promoteEligibleCandidates', () => {
  it('promotes only candidates at or above the threshold', async () => {
    const pool = mockPool([{ ...topicRow, status: 'curated', times_seen: 3, promoted_at: new Date() }]);
    const result = await promoteEligibleCandidates(pool as never);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'candidate' AND times_seen >= $1"), [3]);
    expect(result[0].status).toBe('curated');
  });
});

describe('setTopicStatus', () => {
  it('sets promoted_at when manually promoting to curated', async () => {
    const pool = mockPool();
    await setTopicStatus(pool as never, 1, 'curated');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'curated'"), [1]);
    expect(pool.query.mock.calls[0][0]).toContain('promoted_at = now()');
  });

  it('clears promoted_at when demoting to candidate', async () => {
    const pool = mockPool();
    await setTopicStatus(pool as never, 1, 'candidate');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'candidate'"), [1]);
    expect(pool.query.mock.calls[0][0]).toContain('promoted_at = NULL');
  });
});

describe('addCuratedTopic', () => {
  it('inserts (or upgrades) a topic directly as curated', async () => {
    const pool = mockPool([{ ...topicRow, status: 'curated', promoted_at: new Date() }]);
    const result = await addCuratedTopic(pool as never, 'cooking', 'Sourdough');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("'curated'"), ['cooking', 'sourdough']);
    expect(result.status).toBe('curated');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/trendSeedTopics.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append:

```ts
export const TREND_SEED_TOPICS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS trend_seed_topics (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  times_seen INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at TIMESTAMPTZ,
  UNIQUE (category, topic)
);
`;
```

- [ ] **Step 4: Implement `trendSeedTopics.ts`**

`packages/db/src/trendSeedTopics.ts`:

```ts
import type { Pool, QueryResult } from 'pg';

export const TREND_CATEGORIES = ['web-design', 'cooking', 'nutrition'] as const;
export type TrendCategory = (typeof TREND_CATEGORIES)[number];

export interface TrendSeedTopic {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
  timesSeen: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  promotedAt: Date | null;
}

interface TrendSeedTopicRow {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
  times_seen: number;
  first_seen_at: Date;
  last_seen_at: Date;
  promoted_at: Date | null;
}

const PROMOTION_THRESHOLD = 3;

function rowToTopic(row: TrendSeedTopicRow): TrendSeedTopic {
  return {
    id: row.id,
    category: row.category,
    topic: row.topic,
    status: row.status,
    timesSeen: row.times_seen,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    promotedAt: row.promoted_at,
  };
}

export function normalizeTopic(topic: string): string {
  return topic.toLowerCase().trim();
}

export async function getCuratedTopics(pool: Pool, category: TrendCategory): Promise<TrendSeedTopic[]> {
  const res = (await pool.query(
    `SELECT * FROM trend_seed_topics WHERE category = $1 AND status = 'curated' ORDER BY topic ASC`,
    [category],
  )) as QueryResult<TrendSeedTopicRow>;
  return res.rows.map(rowToTopic);
}

export async function getAllTopics(pool: Pool): Promise<TrendSeedTopic[]> {
  const res = (await pool.query(
    `SELECT * FROM trend_seed_topics ORDER BY category ASC, status ASC, times_seen DESC`,
  )) as QueryResult<TrendSeedTopicRow>;
  return res.rows.map(rowToTopic);
}

export async function upsertSuggestedTopic(
  pool: Pool,
  category: TrendCategory,
  topic: string,
): Promise<TrendSeedTopic> {
  const normalized = normalizeTopic(topic);
  const res = (await pool.query(
    `INSERT INTO trend_seed_topics (category, topic)
     VALUES ($1, $2)
     ON CONFLICT (category, topic)
     DO UPDATE SET times_seen = trend_seed_topics.times_seen + 1, last_seen_at = now()
     RETURNING *`,
    [category, normalized],
  )) as QueryResult<TrendSeedTopicRow>;
  return rowToTopic(res.rows[0]);
}

export async function promoteEligibleCandidates(pool: Pool): Promise<TrendSeedTopic[]> {
  const res = (await pool.query(
    `UPDATE trend_seed_topics
     SET status = 'curated', promoted_at = now()
     WHERE status = 'candidate' AND times_seen >= $1
     RETURNING *`,
    [PROMOTION_THRESHOLD],
  )) as QueryResult<TrendSeedTopicRow>;
  return res.rows.map(rowToTopic);
}

export async function setTopicStatus(pool: Pool, id: number, status: 'curated' | 'candidate'): Promise<void> {
  if (status === 'curated') {
    await pool.query(`UPDATE trend_seed_topics SET status = 'curated', promoted_at = now() WHERE id = $1`, [id]);
  } else {
    await pool.query(`UPDATE trend_seed_topics SET status = 'candidate', promoted_at = NULL WHERE id = $1`, [id]);
  }
}

export async function addCuratedTopic(pool: Pool, category: TrendCategory, topic: string): Promise<TrendSeedTopic> {
  const normalized = normalizeTopic(topic);
  const res = (await pool.query(
    `INSERT INTO trend_seed_topics (category, topic, status, times_seen, promoted_at)
     VALUES ($1, $2, 'curated', 1, now())
     ON CONFLICT (category, topic)
     DO UPDATE SET status = 'curated', promoted_at = now()
     RETURNING *`,
    [category, normalized],
  )) as QueryResult<TrendSeedTopicRow>;
  return rowToTopic(res.rows[0]);
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`, add `TREND_SEED_TOPICS_TABLE_SQL` to the imports and call it:

```ts
  await pool.query(TREND_SEED_TOPICS_TABLE_SQL);
```

In `packages/db/src/index.ts`, add:

```ts
export * from './trendSeedTopics.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the trend_seed_topics table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS trend_seed_topics'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/trendSeedTopics.ts packages/db/src/index.ts packages/db/tests/trendSeedTopics.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add trend_seed_topics table with normalize/upsert/promote logic"
```

---

### Task 8: Trend report storage (`trends_reports`)

**Files:**
- Modify: `packages/db/src/schema.ts` (add `TRENDS_REPORTS_TABLE_SQL`)
- Modify: `packages/db/src/migrate.ts`
- Create: `packages/db/src/trendsReports.ts`
- Create: `packages/db/tests/trendsReports.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/tests/migrate.test.ts`

**Interfaces:**
- Consumes: `type TrendCategory` (`./trendSeedTopics.js`).
- Produces: `TopicUsed`, `TrendsReport`, `NewTrendsReport`, `insertTrendsReport(pool, report): Promise<TrendsReport>`, `listRecentReports(pool, category, limit?): Promise<TrendsReport[]>`. Consumed by Tasks 10, 11.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/trendsReports.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertTrendsReport, listRecentReports, type NewTrendsReport } from '../src/trendsReports';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewTrendsReport = {
  cycleId: '2026-08-24',
  category: 'cooking',
  topicsUsed: [{ topic: 'air fryer recipes', source: 'curated' }],
  rawFindings: { topics: [], trendingNow: [] },
  summary: 'Air fryer content is trending; we already cover it well.',
};

const reportRow = {
  id: 1, cycle_id: '2026-08-24', category: 'cooking', generated_at: new Date('2026-08-24T00:00:00Z'),
  topics_used: newReport.topicsUsed, raw_findings: newReport.rawFindings, summary: newReport.summary,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertTrendsReport', () => {
  it('inserts JSONB-encoded topics_used and raw_findings and returns the row', async () => {
    const pool = mockPool([reportRow]);
    const result = await insertTrendsReport(pool as never, newReport);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO trends_reports'),
      ['2026-08-24', 'cooking', JSON.stringify(newReport.topicsUsed), JSON.stringify(newReport.rawFindings), newReport.summary],
    );
    expect(result.summary).toBe(newReport.summary);
    expect(result.topicsUsed).toEqual(newReport.topicsUsed);
  });
});

describe('listRecentReports', () => {
  it('queries by category, most recent first, respecting the limit', async () => {
    const pool = mockPool([reportRow]);
    const result = await listRecentReports(pool as never, 'cooking', 5);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC'), ['cooking', 5]);
    expect(result).toHaveLength(1);
  });

  it('defaults the limit to 10', async () => {
    const pool = mockPool([]);
    await listRecentReports(pool as never, 'nutrition');
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['nutrition', 10]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/db && npx vitest run tests/trendsReports.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Add the schema**

In `packages/db/src/schema.ts`, append:

```ts
export const TRENDS_REPORTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS trends_reports (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  category TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  topics_used JSONB NOT NULL,
  raw_findings JSONB NOT NULL,
  summary TEXT NOT NULL
);
`;
```

- [ ] **Step 4: Implement `trendsReports.ts`**

`packages/db/src/trendsReports.ts`:

```ts
import type { Pool, QueryResult } from 'pg';
import type { TrendCategory } from './trendSeedTopics.js';

export interface TopicUsed {
  topic: string;
  source: 'curated' | 'suggested';
}

export interface TrendsReport {
  id: number;
  cycleId: string;
  category: TrendCategory;
  generatedAt: Date;
  topicsUsed: TopicUsed[];
  rawFindings: unknown;
  summary: string;
}

export interface NewTrendsReport {
  cycleId: string;
  category: TrendCategory;
  topicsUsed: TopicUsed[];
  rawFindings: unknown;
  summary: string;
}

interface TrendsReportRow {
  id: number;
  cycle_id: string;
  category: TrendCategory;
  generated_at: Date;
  topics_used: TopicUsed[];
  raw_findings: unknown;
  summary: string;
}

function rowToReport(row: TrendsReportRow): TrendsReport {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    category: row.category,
    generatedAt: row.generated_at,
    topicsUsed: row.topics_used,
    rawFindings: row.raw_findings,
    summary: row.summary,
  };
}

export async function insertTrendsReport(pool: Pool, report: NewTrendsReport): Promise<TrendsReport> {
  const res = (await pool.query(
    `INSERT INTO trends_reports (cycle_id, category, topics_used, raw_findings, summary)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      report.cycleId,
      report.category,
      JSON.stringify(report.topicsUsed),
      JSON.stringify(report.rawFindings),
      report.summary,
    ],
  )) as QueryResult<TrendsReportRow>;
  return rowToReport(res.rows[0]);
}

export async function listRecentReports(pool: Pool, category: TrendCategory, limit = 10): Promise<TrendsReport[]> {
  const res = (await pool.query(
    `SELECT * FROM trends_reports WHERE category = $1 ORDER BY generated_at DESC LIMIT $2`,
    [category, limit],
  )) as QueryResult<TrendsReportRow>;
  return res.rows.map(rowToReport);
}
```

- [ ] **Step 5: Wire migration and exports**

In `packages/db/src/migrate.ts`, add `TRENDS_REPORTS_TABLE_SQL` to the imports and call it (order doesn't matter — no foreign keys):

```ts
  await pool.query(TRENDS_REPORTS_TABLE_SQL);
```

In `packages/db/src/index.ts`, add:

```ts
export * from './trendsReports.js';
```

In `packages/db/tests/migrate.test.ts`, add:

```ts
  it('creates the trends_reports table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS trends_reports'))).toBe(true);
  });
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrate.ts packages/db/src/trendsReports.ts packages/db/src/index.ts packages/db/tests/trendsReports.test.ts packages/db/tests/migrate.test.ts
git commit -m "Add trends_reports table for weekly cycle storage"
```

---

### Task 9: SerpApi client (`serpapiTrends.ts`)

**Files:**
- Create: `mcp-server/src/serpapiTrends.ts`
- Create: `mcp-server/tests/serpapiTrends.test.ts`

**Interfaces:**
- Consumes: `requireEnv` (`./blob.js`).
- Produces: `RelatedQuery`, `InterestAndRelatedQueries`, `TrendingNowItem`, `fetchInterestAndRelatedQueries(topic, geo?): Promise<InterestAndRelatedQueries>`, `fetchTrendingNow(category): Promise<TrendingNowItem[]>`. Consumed by Task 10.

**Verification note (Global Constraints):** SerpApi's `RELATED_QUERIES` response's exact `related_queries.top`/`related_queries.rising` item field names weren't confirmed from published docs at planning time (only `interest_over_time.timeline_data[].values[].{query,value,extracted_value}` is documented with a sample). Step 5 below includes a live-call check against the assumed `{query, value}` shape before this task is considered done — adjust `RelatedQueryItem`/`toRelated` if the real response differs.

- [ ] **Step 1: Write the failing tests**

`mcp-server/tests/serpapiTrends.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fetchInterestAndRelatedQueries, fetchTrendingNow } from '../src/serpapiTrends';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SERPAPI_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('fetchInterestAndRelatedQueries', () => {
  it('fetches TIMESERIES and RELATED_QUERIES and combines them', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return {
          ok: true,
          json: async () => ({
            interest_over_time: {
              timeline_data: [
                { values: [{ extracted_value: 20 }] },
                { values: [{ extracted_value: 60 }] },
              ],
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          related_queries: {
            top: [{ query: 'air fryer chicken', value: '100' }],
            rising: [{ query: 'air fryer salmon', value: 'Breakout' }],
          },
        }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('air fryer recipes');

    expect(result.direction).toBe('rising');
    expect(result.topQueries).toEqual([{ query: 'air fryer chicken', value: '100' }]);
    expect(result.risingQueries).toEqual([{ query: 'air fryer salmon', value: 'Breakout' }]);
  });

  it('reports falling direction when the trend declines', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return { ok: true, json: async () => ({ interest_over_time: { timeline_data: [{ values: [{ extracted_value: 60 }] }, { values: [{ extracted_value: 10 }] }] } }) };
      }
      return { ok: true, json: async () => ({ related_queries: {} }) };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('declining topic');
    expect(result.direction).toBe('falling');
  });

  it('throws when SERPAPI_KEY is not set', async () => {
    delete process.env.SERPAPI_KEY;
    await expect(fetchInterestAndRelatedQueries('anything')).rejects.toThrow(/SERPAPI_KEY/);
  });

  it('throws with the topic name when the TIMESERIES request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    await expect(fetchInterestAndRelatedQueries('rate limited topic')).rejects.toThrow(/rate limited topic/);
  });
});

describe('fetchTrendingNow', () => {
  it('maps trending_searches into TrendingNowItem[]', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        trending_searches: [
          { query: 'meal prep containers', search_volume: 5000, increase_percentage: 120 },
        ],
      }),
    }) as unknown as typeof fetch;

    const result = await fetchTrendingNow('cooking');
    expect(result).toEqual([{ query: 'meal prep containers', searchVolume: 5000, increasePercentage: 120 }]);
  });

  it('uses the documented category_id for each known category', async () => {
    let capturedUrl = '';
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      capturedUrl = url.toString();
      return { ok: true, json: async () => ({ trending_searches: [] }) };
    }) as unknown as typeof fetch;

    await fetchTrendingNow('web-design');
    expect(new URL(capturedUrl).searchParams.get('category_id')).toBe('18');

    await fetchTrendingNow('cooking');
    expect(new URL(capturedUrl).searchParams.get('category_id')).toBe('5');

    await fetchTrendingNow('nutrition');
    expect(new URL(capturedUrl).searchParams.get('category_id')).toBe('7');
  });

  it('throws with the category name when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(fetchTrendingNow('cooking')).rejects.toThrow(/cooking/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npx vitest run tests/serpapiTrends.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `serpapiTrends.ts`**

`mcp-server/src/serpapiTrends.ts`:

```ts
import { requireEnv } from './blob.js';

const SERPAPI_URL = 'https://serpapi.com/search.json';

// Confirmed from SerpApi's published Google Trends Trending Now category list.
const CATEGORY_ID_MAP: Record<string, string> = {
  'web-design': '18', // Technology
  cooking: '5', // Food and Drink
  nutrition: '7', // Health
};

export interface RelatedQuery {
  query: string;
  value: string;
}

export interface InterestAndRelatedQueries {
  direction: 'rising' | 'falling' | 'flat';
  topQueries: RelatedQuery[];
  risingQueries: RelatedQuery[];
}

export interface TrendingNowItem {
  query: string;
  searchVolume: number | null;
  increasePercentage: number | null;
}

interface TimelinePoint {
  values?: { extracted_value?: number }[];
}

interface GoogleTrendsInterestResponse {
  interest_over_time?: { timeline_data?: TimelinePoint[] };
}

interface RelatedQueryItem {
  query?: string;
  value?: string;
}

interface GoogleTrendsRelatedResponse {
  related_queries?: { top?: RelatedQueryItem[]; rising?: RelatedQueryItem[] };
}

interface TrendingNowResponse {
  trending_searches?: { query?: string; search_volume?: number; increase_percentage?: number }[];
}

const DIRECTION_THRESHOLD = 5;

function computeDirection(points: TimelinePoint[]): 'rising' | 'falling' | 'flat' {
  const values = points
    .map((p) => p.values?.[0]?.extracted_value)
    .filter((v): v is number => typeof v === 'number');
  if (values.length < 2) return 'flat';
  const delta = values[values.length - 1] - values[0];
  if (delta > DIRECTION_THRESHOLD) return 'rising';
  if (delta < -DIRECTION_THRESHOLD) return 'falling';
  return 'flat';
}

function toRelated(items: RelatedQueryItem[] | undefined): RelatedQuery[] {
  return (items ?? [])
    .filter((item): item is Required<RelatedQueryItem> => typeof item.query === 'string' && typeof item.value === 'string')
    .map((item) => ({ query: item.query, value: item.value }));
}

export async function fetchInterestAndRelatedQueries(
  topic: string,
  geo = 'US',
): Promise<InterestAndRelatedQueries> {
  const apiKey = requireEnv('SERPAPI_KEY');

  const interestUrl = new URL(SERPAPI_URL);
  interestUrl.searchParams.set('engine', 'google_trends');
  interestUrl.searchParams.set('q', topic);
  interestUrl.searchParams.set('geo', geo);
  interestUrl.searchParams.set('data_type', 'TIMESERIES');
  interestUrl.searchParams.set('api_key', apiKey);

  const interestRes = await fetch(interestUrl);
  if (!interestRes.ok) {
    throw new Error(`SerpApi google_trends TIMESERIES request failed for "${topic}": ${interestRes.status}`);
  }
  const interestData = (await interestRes.json()) as GoogleTrendsInterestResponse;

  const relatedUrl = new URL(SERPAPI_URL);
  relatedUrl.searchParams.set('engine', 'google_trends');
  relatedUrl.searchParams.set('q', topic);
  relatedUrl.searchParams.set('geo', geo);
  relatedUrl.searchParams.set('data_type', 'RELATED_QUERIES');
  relatedUrl.searchParams.set('api_key', apiKey);

  const relatedRes = await fetch(relatedUrl);
  if (!relatedRes.ok) {
    throw new Error(`SerpApi google_trends RELATED_QUERIES request failed for "${topic}": ${relatedRes.status}`);
  }
  const relatedData = (await relatedRes.json()) as GoogleTrendsRelatedResponse;

  const timelineData = interestData.interest_over_time?.timeline_data ?? [];

  return {
    direction: computeDirection(timelineData),
    topQueries: toRelated(relatedData.related_queries?.top),
    risingQueries: toRelated(relatedData.related_queries?.rising),
  };
}

export async function fetchTrendingNow(category: string): Promise<TrendingNowItem[]> {
  const apiKey = requireEnv('SERPAPI_KEY');

  const url = new URL(SERPAPI_URL);
  url.searchParams.set('engine', 'google_trends_trending_now');
  url.searchParams.set('geo', 'US');
  const categoryId = CATEGORY_ID_MAP[category];
  if (categoryId) url.searchParams.set('category_id', categoryId);
  url.searchParams.set('api_key', apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpApi google_trends_trending_now request failed for category "${category}": ${res.status}`);
  }
  const data = (await res.json()) as TrendingNowResponse;

  return (data.trending_searches ?? [])
    .filter((item): item is { query: string; search_volume?: number; increase_percentage?: number } => typeof item.query === 'string')
    .map((item) => ({
      query: item.query,
      searchVolume: item.search_volume ?? null,
      increasePercentage: item.increase_percentage ?? null,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npx vitest run tests/serpapiTrends.test.ts
```

Expected: PASS.

- [ ] **Step 5: Live-call verification (needs a real `SERPAPI_KEY`)**

Per the Global Constraints note on this task, confirm the assumed `RELATED_QUERIES` shape against a real response before relying on it in production:

```bash
curl -s "https://serpapi.com/search.json?engine=google_trends&q=air%20fryer%20recipes&geo=US&data_type=RELATED_QUERIES&api_key=$SERPAPI_KEY" | head -c 2000
```

Compare the actual `related_queries.top`/`related_queries.rising` item fields against `RelatedQueryItem` (`query`, `value`) above. If the real fields differ (e.g. nested under a different key, or missing `value`), update `RelatedQueryItem`/`toRelated`/the test fixtures to match, then re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/serpapiTrends.ts mcp-server/tests/serpapiTrends.test.ts
git commit -m "Add SerpApi client for Google Trends interest/related-queries and trending-now"
```

---

### Task 10: Weekly trends cron script

**Files:**
- Create: `mcp-server/src/sourceWeeklyTrends.ts`
- Create: `mcp-server/scripts/source-weekly-trends.ts`
- Create: `mcp-server/tests/fixtures/trendsRepoRoot/docs/CONSTITUTION.md`
- Create: `mcp-server/tests/fixtures/trendsRepoRoot/src/content/posts/sample-recipe.mdx`
- Create: `mcp-server/tests/integration/sourceWeeklyTrends.test.ts`
- Modify: `mcp-server/package.json` (add `source:weekly-trends` script)

**Interfaces:**
- Consumes: `TREND_CATEGORIES`, `type TrendCategory`, `getCuratedTopics`, `upsertSuggestedTopic`, `promoteEligibleCandidates`, `insertTrendsReport`, `type TopicUsed` (`@lhr/db`); `fetchInterestAndRelatedQueries`, `fetchTrendingNow`, `type InterestAndRelatedQueries`, `type TrendingNowItem` (`./serpapiTrends.js`); `callOpenRouter` (`./openrouter.js`); `parsePostFrontmatter` (`./backfillIngredientLinks.js`).
- Produces: `runWeeklyTrendsCycle(pool, repoRoot): Promise<CategoryCycleResult[]>` (`./sourceWeeklyTrends.js`), consumed only by the thin script wrapper and its own test.

- [ ] **Step 1: Create the test fixture repo root**

`mcp-server/tests/fixtures/trendsRepoRoot/docs/CONSTITUTION.md`:

```
# Test Constitution

1. A post never goes live without the author's explicit confirmation.
```

`mcp-server/tests/fixtures/trendsRepoRoot/src/content/posts/sample-recipe.mdx`:

```
---
title: Air Fryer Chicken Thighs
type: recipe
date: 2026-08-01
coverPhoto: https://example.com/photo.jpg
coverPhotoAlt: chicken thighs
ingredients:
  - item: chicken thighs
steps:
  - Preheat the air fryer.
---

Body content.
```

- [ ] **Step 2: Write the failing integration test**

`mcp-server/tests/integration/sourceWeeklyTrends.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepoRoot = path.join(dirname, '../fixtures/trendsRepoRoot');

const dbMock = {
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  getCuratedTopics: vi.fn(),
  upsertSuggestedTopic: vi.fn(),
  promoteEligibleCandidates: vi.fn().mockResolvedValue([]),
  insertTrendsReport: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = {
  fetchInterestAndRelatedQueries: vi.fn(),
  fetchTrendingNow: vi.fn(),
};
vi.mock('../../src/serpapiTrends', () => serpapiMock);

const openrouterMock = { callOpenRouter: vi.fn() };
vi.mock('../../src/openrouter', () => openrouterMock);

const { runWeeklyTrendsCycle } = await import('../../src/sourceWeeklyTrends');

const pool = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.getCuratedTopics.mockResolvedValue([]);
  dbMock.upsertSuggestedTopic.mockImplementation(async (_pool, category, topic) => ({
    id: 1, category, topic, status: 'candidate', timesSeen: 1,
    firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: null,
  }));
  dbMock.insertTrendsReport.mockImplementation(async (_pool, report) => ({ id: 1, ...report, generatedAt: new Date() }));
  openrouterMock.callOpenRouter.mockImplementation(async (messages: { content: string }[]) => {
    const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
    return isSuggestionCall ? '["sourdough starter"]' : 'This week: sourdough interest is rising.';
  });
  serpapiMock.fetchInterestAndRelatedQueries.mockResolvedValue({
    direction: 'rising', topQueries: [], risingQueries: [{ query: 'sourdough starter jar', value: '80' }],
  });
  serpapiMock.fetchTrendingNow.mockResolvedValue([{ query: 'meal prep', searchVolume: 100, increasePercentage: 10 }]);
});

describe('runWeeklyTrendsCycle', () => {
  it('writes one trends_reports row per category', async () => {
    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);
    expect(dbMock.insertTrendsReport).toHaveBeenCalledTimes(3);
    const categories = dbMock.insertTrendsReport.mock.calls.map((c) => c[1].category);
    expect(categories.sort()).toEqual(['cooking', 'nutrition', 'web-design']);
  });

  it('still writes a partial report when one topic fails SerpApi', async () => {
    dbMock.getCuratedTopics.mockImplementation(async (_pool, category) =>
      category === 'cooking'
        ? [{ id: 1, category, topic: 'air fryer recipes', status: 'curated', timesSeen: 3, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() }]
        : [],
    );
    openrouterMock.callOpenRouter.mockImplementation(async () => '[]');
    serpapiMock.fetchInterestAndRelatedQueries.mockRejectedValueOnce(new Error('rate limited'));

    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);

    const cookingCall = dbMock.insertTrendsReport.mock.calls.find((c) => c[1].category === 'cooking');
    expect(cookingCall).toBeDefined();
    expect(cookingCall![1].topicsUsed).toEqual([]);
  });

  it('writes the placeholder summary when the synthesis LLM call fails', async () => {
    openrouterMock.callOpenRouter.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      if (isSuggestionCall) return '[]';
      throw new Error('OpenRouter down');
    });

    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);

    for (const call of dbMock.insertTrendsReport.mock.calls) {
      expect(call[1].summary).toBe('[Summary generation failed this cycle]');
    }
  });

  it('upserts each suggested topic and runs promotion once per category', async () => {
    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);
    expect(dbMock.upsertSuggestedTopic).toHaveBeenCalledWith(pool, expect.any(String), 'sourdough starter');
    expect(dbMock.promoteEligibleCandidates).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd mcp-server && npx vitest run tests/integration/sourceWeeklyTrends.test.ts
```

Expected: FAIL — `../../src/sourceWeeklyTrends` does not exist yet.

- [ ] **Step 4: Implement `sourceWeeklyTrends.ts`**

`mcp-server/src/sourceWeeklyTrends.ts`:

```ts
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  TREND_CATEGORIES,
  type TrendCategory,
  getCuratedTopics,
  upsertSuggestedTopic,
  promoteEligibleCandidates,
  insertTrendsReport,
  type TopicUsed,
} from '@lhr/db';
import { fetchInterestAndRelatedQueries, fetchTrendingNow, type InterestAndRelatedQueries, type TrendingNowItem } from './serpapiTrends.js';
import { callOpenRouter } from './openrouter.js';
import { parsePostFrontmatter } from './backfillIngredientLinks.js';

const SUGGESTIONS_PER_CATEGORY = 2;
const RECENT_POST_LIMIT = 15;
const SUMMARY_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';

interface TopicFinding {
  topic: string;
  source: 'curated' | 'suggested';
  interest: InterestAndRelatedQueries;
}

export interface CategoryCycleResult {
  category: TrendCategory;
  topicsUsed: TopicUsed[];
  callCount: number;
}

function readConstitution(repoRoot: string): string {
  return readFileSync(path.join(repoRoot, 'docs/CONSTITUTION.md'), 'utf-8');
}

function readRecentPostTitles(repoRoot: string, limit: number): string[] {
  const postsDir = path.join(repoRoot, 'src/content/posts');
  const files = readdirSync(postsDir).filter((f) => f.endsWith('.mdx'));
  const titles: string[] = [];
  for (const file of files.slice(0, limit)) {
    try {
      const content = readFileSync(path.join(postsDir, file), 'utf-8');
      const frontmatter = parsePostFrontmatter(content);
      if (typeof frontmatter.title === 'string') titles.push(frontmatter.title);
    } catch {
      // Skip a post whose frontmatter doesn't parse rather than fail the whole cycle.
    }
  }
  return titles;
}

async function suggestAdjacentTopics(category: TrendCategory, curated: string[]): Promise<string[]> {
  const reply = await callOpenRouter([
    {
      role: 'system',
      content:
        'You suggest search topics for a Google Trends watch list. Reply with a JSON array of ' +
        `up to ${SUGGESTIONS_PER_CATEGORY} short topic strings, nothing else.`,
    },
    {
      role: 'user',
      content:
        `Category: ${category}\nCurrent curated topics: ${curated.length ? curated.join(', ') : '(none yet)'}\n` +
        `Suggest up to ${SUGGESTIONS_PER_CATEGORY} adjacent topics worth trying this cycle.`,
    },
  ]);
  try {
    const parsed = JSON.parse(reply) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string').slice(0, SUGGESTIONS_PER_CATEGORY);
  } catch {
    return [];
  }
}

async function synthesizeSummary(params: {
  category: TrendCategory;
  findings: TopicFinding[];
  trendingNow: TrendingNowItem[];
  constitution: string;
  recentPostTitles: string[];
}): Promise<string> {
  const findingsText =
    params.findings
      .map(
        (f) =>
          `- ${f.topic} (${f.source}): direction=${f.interest.direction}, rising queries: ` +
          `${f.interest.risingQueries.map((q) => q.query).join(', ') || 'none'}`,
      )
      .join('\n') || '(no topic data succeeded this cycle)';
  const trendingText = params.trendingNow.map((t) => `- ${t.query}`).join('\n') || '(none)';

  try {
    return await callOpenRouter([
      {
        role: 'system',
        content:
          'You write a short "what is worth knowing this week" summary for a recipe site owner, given ' +
          'raw Google Trends signal for one category. Flag both what already aligns with her existing ' +
          'content and what she does not cover yet. Two to four sentences.',
      },
      {
        role: 'user',
        content:
          `Category: ${params.category}\n\nSite principles:\n${params.constitution}\n\n` +
          `Recent post titles:\n${params.recentPostTitles.join('\n') || '(none)'}\n\n` +
          `This cycle's topic findings:\n${findingsText}\n\nWildcard trending-now items:\n${trendingText}`,
      },
    ]);
  } catch {
    return SUMMARY_FAILURE_PLACEHOLDER;
  }
}

export async function runWeeklyTrendsCycle(pool: Pool, repoRoot: string): Promise<CategoryCycleResult[]> {
  const cycleId = new Date().toISOString().slice(0, 10);
  const constitution = readConstitution(repoRoot);
  const recentPostTitles = readRecentPostTitles(repoRoot, RECENT_POST_LIMIT);

  const results: CategoryCycleResult[] = [];

  for (const category of TREND_CATEGORIES) {
    let callCount = 0;

    const curated = await getCuratedTopics(pool, category);
    const curatedTopics = curated.map((t) => t.topic);
    const suggested = await suggestAdjacentTopics(category, curatedTopics);

    const candidateTopics: TopicUsed[] = [
      ...curatedTopics.map((topic) => ({ topic, source: 'curated' as const })),
      ...suggested.map((topic) => ({ topic, source: 'suggested' as const })),
    ];

    const findings: TopicFinding[] = [];
    const topicsUsed: TopicUsed[] = [];
    for (const { topic, source } of candidateTopics) {
      callCount += 1;
      try {
        const interest = await fetchInterestAndRelatedQueries(topic);
        findings.push({ topic, source, interest });
        topicsUsed.push({ topic, source });
      } catch (err) {
        console.error(
          `[trends] fetchInterestAndRelatedQueries failed for "${topic}" (${category}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    callCount += 1;
    let trendingNow: TrendingNowItem[] = [];
    try {
      trendingNow = await fetchTrendingNow(category);
    } catch (err) {
      console.error(`[trends] fetchTrendingNow failed for ${category}: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const topic of suggested) {
      await upsertSuggestedTopic(pool, category, topic);
    }
    await promoteEligibleCandidates(pool);

    const summary = await synthesizeSummary({ category, findings, trendingNow, constitution, recentPostTitles });

    await insertTrendsReport(pool, {
      cycleId,
      category,
      topicsUsed,
      rawFindings: { topics: findings, trendingNow },
      summary,
    });

    console.log(`[trends] ${category}: ${callCount} SerpApi call(s) this cycle`);
    results.push({ category, topicsUsed, callCount });
  }

  return results;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd mcp-server && npx vitest run tests/integration/sourceWeeklyTrends.test.ts
```

Expected: PASS.

- [ ] **Step 6: Implement the thin script wrapper**

Add to `mcp-server/package.json` `scripts`:

```json
    "source:weekly-trends": "tsx scripts/source-weekly-trends.ts"
```

`mcp-server/scripts/source-weekly-trends.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { runWeeklyTrendsCycle } from '../src/sourceWeeklyTrends.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL env var is required.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });

  const results = await runWeeklyTrendsCycle(pool, repoRoot);
  for (const result of results) {
    console.log(`Wrote a trends report for ${result.category} (${result.topicsUsed.length} topic(s) used).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Verify the whole mcp-server test suite still passes**

```bash
cd mcp-server && npx vitest run
```

Expected: PASS.

- [ ] **Step 8: Manual verification with real credentials**

This needs real `DATABASE_URL`, `OPENROUTER_API_KEY`, and `SERPAPI_KEY` — run by hand once:

```bash
cd packages/db && npm run db:migrate
cd ../../mcp-server && npm run source:weekly-trends
```

Expected: logs `Wrote a trends report for web-design (...)`, `... cooking (...)`, `... nutrition (...)`. Confirm via `psql "$DATABASE_URL" -c "SELECT category, cycle_id, summary FROM trends_reports;"`.

- [ ] **Step 9: Commit**

```bash
git add mcp-server/src/sourceWeeklyTrends.ts mcp-server/scripts/source-weekly-trends.ts mcp-server/tests/fixtures/trendsRepoRoot mcp-server/tests/integration/sourceWeeklyTrends.test.ts mcp-server/package.json
git commit -m "Add weekly trends-sourcing cron script"
```

---

### Task 11: `/trends` report page

**Files:**
- Create: `apps/lhr-office/src/pages/trends/index.astro`

**Interfaces:**
- Consumes: `requireAdminSession` (`../../lib/auth.js`); `getPool` (`../../lib/db.js`); `TREND_CATEGORIES`, `type TrendCategory`, `listRecentReports`, `type TrendsReport` (`@lhr/db`).

- [ ] **Step 1: Implement the page**

`apps/lhr-office/src/pages/trends/index.astro`:

```astro
---
import { requireAdminSession } from '../../lib/auth.js';
import { getPool } from '../../lib/db.js';
import { TREND_CATEGORIES, listRecentReports, type TrendCategory, type TrendsReport } from '@lhr/db';

const authResult = await requireAdminSession(Astro);
if ('response' in authResult) {
  return authResult.response;
}

const pool = getPool();
const reportsByCategory = new Map<TrendCategory, TrendsReport[]>();
for (const category of TREND_CATEGORIES) {
  reportsByCategory.set(category, await listRecentReports(pool, category));
}

function categoryLabel(category: TrendCategory): string {
  return { 'web-design': 'Web Design', cooking: 'Cooking', nutrition: 'Nutrition' }[category];
}
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Trends — LHR Office</title>
    <style>
      body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
      h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; margin-top: 2.5rem; }
      .report { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
      .report .date { font-size: 0.85rem; color: #666; }
      .summary { margin: 0.75rem 0; }
      details { margin-top: 0.5rem; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f7f7f7; padding: 0.75rem; border-radius: 4px; font-size: 0.8rem; }
    </style>
  </head>
  <body>
    <p><a href="/">&larr; Office home</a></p>
    <h1>Trends</h1>
    {TREND_CATEGORIES.map((category) => (
      <section>
        <h2>{categoryLabel(category)}</h2>
        {(reportsByCategory.get(category) ?? []).length === 0 && <p>No reports yet.</p>}
        {(reportsByCategory.get(category) ?? []).map((report) => (
          <article class="report">
            <p class="date">{report.generatedAt.toISOString().slice(0, 10)} &middot; cycle {report.cycleId}</p>
            <p class="summary">{report.summary}</p>
            <details>
              <summary>Raw findings ({report.topicsUsed.length} topic(s) used)</summary>
              <pre>{JSON.stringify(report.rawFindings, null, 2)}</pre>
            </details>
          </article>
        ))}
      </section>
    ))}
  </body>
</html>
```

- [ ] **Step 2: Manual verification with seeded data**

`.astro` pages aren't covered by this repo's Vitest setup — the only precedent (`apps/lhr-office/src/pages/affiliate-review/index.astro`, from the sibling plan) is verified by hand too. Do the same here:

```bash
psql "$DATABASE_URL" -c "INSERT INTO trends_reports (cycle_id, category, topics_used, raw_findings, summary) VALUES ('test-cycle', 'cooking', '[{\"topic\":\"air fryer recipes\",\"source\":\"curated\"}]', '{\"topics\":[],\"trendingNow\":[]}', 'Air fryer content is rising; you already cover it well.');"
```

```bash
cd apps/lhr-office && npm run dev
```

Log in at `/login`, then visit `/trends/` and confirm: the "Cooking" section shows the seeded report with its summary and an expandable raw-findings block; "Web Design" and "Nutrition" show "No reports yet."; visiting `/trends/` without a session redirects to `/login`.

- [ ] **Step 3: Commit**

```bash
git add apps/lhr-office/src/pages/trends/index.astro
git commit -m "Add /trends report viewer page"
```

---

### Task 12: `/admin` page — admin account management

**Files:**
- Create: `apps/lhr-office/src/pages/admin/index.astro`
- Create: `apps/lhr-office/src/pages/api/admin/create-admin.ts`
- Create: `apps/lhr-office/tests/createAdmin.test.ts`

**Interfaces:**
- Consumes: `requireAdminSession` (`../../lib/auth.js`); `getPool` (`../../lib/db.js`); `listAdmins`, `createAdmin` (`@lhr/db`).
- Produces: `/admin/` page (admin-accounts section), `POST /api/admin/create-admin`.

- [ ] **Step 1: Write the failing API test**

`apps/lhr-office/tests/createAdmin.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { createAdmin: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/admin/create-admin');

const loggedInAdmin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(username: string, password: string) {
  const form = new FormData();
  form.set('username', username);
  form.set('password', password);
  const redirectResponse = new Response(null, { status: 302 });
  return {
    request: new Request('http://localhost/api/admin/create-admin', { method: 'POST', body: form }),
    cookies: {},
    redirect: vi.fn(() => redirectResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin: loggedInAdmin });
});

describe('POST /api/admin/create-admin', () => {
  it('creates a new admin attributed to the logged-in admin and redirects back to /admin', async () => {
    dbMock.createAdmin.mockResolvedValue({ id: 2, username: 'newperson', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: 1 });
    const context = makeContext('newperson', 'a-strong-password');

    const res = await POST(context as never);

    expect(dbMock.createAdmin).toHaveBeenCalledWith(mockPool, 'newperson', 'a-strong-password', 1);
    expect(context.redirect).toHaveBeenCalledWith('/admin/');
    expect(res.status).toBe(302);
  });

  it('redirects to /login instead of creating an admin when not authenticated', async () => {
    const loginRedirect = new Response(null, { status: 302 });
    authMock.requireAdminSession.mockResolvedValue({ response: loginRedirect });
    const context = makeContext('newperson', 'a-strong-password');

    const res = await POST(context as never);

    expect(res).toBe(loginRedirect);
    expect(dbMock.createAdmin).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/lhr-office && npx vitest run tests/createAdmin.test.ts
```

Expected: FAIL — route module does not exist yet.

- [ ] **Step 3: Implement the API route**

`apps/lhr-office/src/pages/api/admin/create-admin.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/auth.js';
import { createAdmin } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context);
  if ('response' in authResult) return authResult.response;

  const form = await context.request.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');

  await createAdmin(getPool(), username, password, authResult.admin.id);

  return context.redirect('/admin/');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/lhr-office && npx vitest run tests/createAdmin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement the `/admin` page's account-management section**

`apps/lhr-office/src/pages/admin/index.astro`:

```astro
---
import { requireAdminSession } from '../../lib/auth.js';
import { getPool } from '../../lib/db.js';
import { listAdmins } from '@lhr/db';

const authResult = await requireAdminSession(Astro);
if ('response' in authResult) {
  return authResult.response;
}

const pool = getPool();
const admins = await listAdmins(pool);
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin — LHR Office</title>
    <style>
      body { font-family: sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
      h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; margin-top: 2.5rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { text-align: left; padding: 0.4rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }
      form.inline { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
      input { padding: 0.4rem; }
      button { padding: 0.4rem 0.8rem; cursor: pointer; }
    </style>
  </head>
  <body>
    <p><a href="/">&larr; Office home</a></p>
    <h1>Admin</h1>

    <h2>Admin accounts</h2>
    <table>
      <thead><tr><th>Username</th><th>Created</th><th>Locked?</th></tr></thead>
      <tbody>
        {admins.map((a) => (
          <tr>
            <td>{a.username}</td>
            <td>{a.createdAt.toISOString().slice(0, 10)}</td>
            <td>{a.lockedUntil && a.lockedUntil.getTime() > Date.now() ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <form class="inline" method="POST" action="/api/admin/create-admin">
      <input type="text" name="username" placeholder="Username" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Add admin</button>
    </form>
  </body>
</html>
```

- [ ] **Step 6: Manual verification**

```bash
cd apps/lhr-office && npm run dev
```

Log in, visit `/admin/`, confirm the logged-in admin appears in the table, submit the "Add admin" form with a new username/password, confirm the page reloads with the new admin listed. Confirm visiting `/admin/` without a session redirects to `/login`.

- [ ] **Step 7: Commit**

```bash
git add apps/lhr-office/src/pages/admin/index.astro apps/lhr-office/src/pages/api/admin/create-admin.ts apps/lhr-office/tests/createAdmin.test.ts
git commit -m "Add /admin page and create-admin route"
```

---

### Task 13: `/admin` page — seed topic management

**Files:**
- Modify: `apps/lhr-office/src/pages/admin/index.astro` (add the seed-topics section)
- Create: `apps/lhr-office/src/pages/api/admin/topics/[id]/status.ts`
- Create: `apps/lhr-office/src/pages/api/admin/topics/add.ts`
- Create: `apps/lhr-office/tests/topicStatus.test.ts`
- Create: `apps/lhr-office/tests/topicAdd.test.ts`

**Interfaces:**
- Consumes: `requireAdminSession` (`../../../../../lib/auth.js` from `topics/[id]/status.ts`, `../../../../lib/auth.js` from `topics/add.ts`); `getPool` (same relative paths, `lib/db.js`); `getAllTopics`, `setTopicStatus`, `addCuratedTopic`, `TREND_CATEGORIES`, `type TrendCategory` (`@lhr/db`).
- Produces: `POST /api/admin/topics/:id/status`, `POST /api/admin/topics/add`.

- [ ] **Step 1: Write the failing API tests**

`apps/lhr-office/tests/topicStatus.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { setTopicStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/admin/topics/[id]/status');

const loggedInAdmin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(id: string, status: string) {
  const form = new FormData();
  form.set('status', status);
  const redirectResponse = new Response(null, { status: 302 });
  return {
    params: { id },
    request: new Request('http://localhost/x', { method: 'POST', body: form }),
    cookies: {},
    redirect: vi.fn(() => redirectResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin: loggedInAdmin });
});

describe('POST /api/admin/topics/[id]/status', () => {
  it('sets the topic status and redirects back to /admin', async () => {
    const context = makeContext('4', 'curated');
    const res = await POST(context as never);
    expect(dbMock.setTopicStatus).toHaveBeenCalledWith(mockPool, 4, 'curated');
    expect(context.redirect).toHaveBeenCalledWith('/admin/');
    expect(res.status).toBe(302);
  });

  it('rejects an invalid status value', async () => {
    const context = makeContext('4', 'not-a-real-status');
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    expect(dbMock.setTopicStatus).not.toHaveBeenCalled();
  });

  it('redirects to /login instead of updating when not authenticated', async () => {
    const loginRedirect = new Response(null, { status: 302 });
    authMock.requireAdminSession.mockResolvedValue({ response: loginRedirect });
    const context = makeContext('4', 'curated');
    const res = await POST(context as never);
    expect(res).toBe(loginRedirect);
    expect(dbMock.setTopicStatus).not.toHaveBeenCalled();
  });
});
```

`apps/lhr-office/tests/topicAdd.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { addCuratedTopic: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/admin/topics/add');

const loggedInAdmin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(category: string, topic: string) {
  const form = new FormData();
  form.set('category', category);
  form.set('topic', topic);
  const redirectResponse = new Response(null, { status: 302 });
  return {
    request: new Request('http://localhost/x', { method: 'POST', body: form }),
    cookies: {},
    redirect: vi.fn(() => redirectResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin: loggedInAdmin });
});

describe('POST /api/admin/topics/add', () => {
  it('adds a curated topic directly and redirects back to /admin', async () => {
    dbMock.addCuratedTopic.mockResolvedValue({ id: 9, category: 'cooking', topic: 'sourdough', status: 'curated', timesSeen: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() });
    const context = makeContext('cooking', 'Sourdough');
    const res = await POST(context as never);
    expect(dbMock.addCuratedTopic).toHaveBeenCalledWith(mockPool, 'cooking', 'Sourdough');
    expect(context.redirect).toHaveBeenCalledWith('/admin/');
    expect(res.status).toBe(302);
  });

  it('rejects an unknown category', async () => {
    const context = makeContext('not-a-category', 'Sourdough');
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    expect(dbMock.addCuratedTopic).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/topicStatus.test.ts tests/topicAdd.test.ts
```

Expected: FAIL — route modules don't exist yet.

- [ ] **Step 3: Implement the API routes**

`apps/lhr-office/src/pages/api/admin/topics/[id]/status.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../../../lib/db.js';
import { requireAdminSession } from '../../../../../lib/auth.js';
import { setTopicStatus } from '@lhr/db';

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context);
  if ('response' in authResult) return authResult.response;

  const form = await context.request.formData();
  const status = String(form.get('status') ?? '');
  if (status !== 'curated' && status !== 'candidate') {
    return new Response('Invalid status', { status: 400 });
  }

  const id = Number(context.params.id);
  await setTopicStatus(getPool(), id, status);

  return context.redirect('/admin/');
}
```

`apps/lhr-office/src/pages/api/admin/topics/add.ts`:

```ts
import type { APIContext } from 'astro';
import { getPool } from '../../../../lib/db.js';
import { requireAdminSession } from '../../../../lib/auth.js';
import { addCuratedTopic, TREND_CATEGORIES, type TrendCategory } from '@lhr/db';

function isTrendCategory(value: string): value is TrendCategory {
  return (TREND_CATEGORIES as readonly string[]).includes(value);
}

export async function POST(context: APIContext): Promise<Response> {
  const authResult = await requireAdminSession(context);
  if ('response' in authResult) return authResult.response;

  const form = await context.request.formData();
  const category = String(form.get('category') ?? '');
  const topic = String(form.get('topic') ?? '');
  if (!isTrendCategory(category)) {
    return new Response('Invalid category', { status: 400 });
  }

  await addCuratedTopic(getPool(), category, topic);

  return context.redirect('/admin/');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/topicStatus.test.ts tests/topicAdd.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend the `/admin` page with the seed-topics section**

In `apps/lhr-office/src/pages/admin/index.astro`, add to the frontmatter (after the existing `admins` fetch):

```astro
import { getAllTopics, TREND_CATEGORIES } from '@lhr/db';
```

```astro
const topics = await getAllTopics(pool);
```

And add this section to the body, after the existing admin-accounts section:

```astro
    <h2>Seed topics</h2>
    <table>
      <thead><tr><th>Category</th><th>Topic</th><th>Status</th><th>Times seen</th><th></th></tr></thead>
      <tbody>
        {topics.map((t) => (
          <tr>
            <td>{t.category}</td>
            <td>{t.topic}</td>
            <td>{t.status}</td>
            <td>{t.timesSeen}</td>
            <td>
              <form method="POST" action={`/api/admin/topics/${t.id}/status`}>
                <input type="hidden" name="status" value={t.status === 'curated' ? 'candidate' : 'curated'} />
                <button type="submit">{t.status === 'curated' ? 'Demote' : 'Promote'}</button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <form class="inline" method="POST" action="/api/admin/topics/add">
      <select name="category" required>
        {TREND_CATEGORIES.map((c) => <option value={c}>{c}</option>)}
      </select>
      <input type="text" name="topic" placeholder="New curated topic" required />
      <button type="submit">Add curated topic</button>
    </form>
```

- [ ] **Step 6: Manual verification**

```bash
psql "$DATABASE_URL" -c "INSERT INTO trend_seed_topics (category, topic, status, times_seen) VALUES ('cooking', 'air fryer recipes', 'candidate', 2);"
```

```bash
cd apps/lhr-office && npm run dev
```

Visit `/admin/`, confirm the seeded topic appears with a "Promote" button; click it, confirm the page reloads with status now `curated` and the button now reads "Demote"; use the "Add curated topic" form to add a new one directly and confirm it appears as `curated` with `times_seen` of 1.

- [ ] **Step 7: Full app test run**

```bash
cd apps/lhr-office && npx vitest run
```

Expected: PASS (every test in the app).

- [ ] **Step 8: Commit**

```bash
git add apps/lhr-office/src/pages/admin/index.astro apps/lhr-office/src/pages/api/admin/topics apps/lhr-office/tests/topicStatus.test.ts apps/lhr-office/tests/topicAdd.test.ts
git commit -m "Add seed-topic management to the /admin page"
```
