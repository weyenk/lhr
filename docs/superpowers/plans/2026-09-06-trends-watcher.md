# Trends Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly Google Trends report (web design, cooking, nutrition) as the fourth entry in `apps/lhr-office`'s `@lhr/jobs` registry, rendered on the existing `/status` page, with automatic + manual seed-topic curation — while extracting a reusable `@lhr/llm` package so this (and future) non-authoring jobs never need to import `mcp-server` as if it were a generic library.

**Architecture:** `apps/lhr-office/src/trendsWatcher.ts` exports `sourceWeeklyTrends(): Promise<JobResult>`, registered in `apps/lhr-office/src/registry.ts` (relocated there from `packages/jobs` in this plan, since it's app-specific wiring, not shared logic). It reads curated seed topics from `@lhr/db`, asks `@lhr/llm`'s `callLLM` for adjacent topic suggestions, calls SerpApi via a new app-local `serpapiTrends.ts` client, updates seed-topic promotion state, synthesizes a per-category summary, and writes report rows — all through the same `Queryable`/`getPool()` pattern every other `@lhr/db` module already uses. `/status` gets two new sections (trends summary, seed-topic management) and three new routes, matching the page's existing unstyled, semantic-HTML convention exactly.

**Tech Stack:** TypeScript (strict), `pg` via `@lhr/db`'s `Queryable`/`getPool()`, native `fetch` (SerpApi + the extracted LLM client — no new HTTP dependency), Express (`apps/lhr-office`'s existing app), Vitest, `supertest` (existing `server.test.ts` convention).

**Spec:** [docs/superpowers/specs/active/2026-09-06-trends-watcher-design.md](../specs/active/2026-09-06-trends-watcher-design.md)

## Global Constraints

- **Promotion threshold:** a candidate topic crossing `times_seen >= 3` (three separate cycles' suggestion passes, not three mentions within one cycle) auto-promotes to `status='curated'` and sets `promoted_at` (spec §5).
- **Suggested-topic dedup:** before the promotion-tracking upsert runs, suggested topics are deduped against both the curated list and themselves (case/whitespace-normalized) — a topic the LLM re-suggests that's already curated must never be fetched from SerpApi twice in one cycle, and must never have `times_seen` incremented more than once per cycle (spec §5).
- **Partial reports, never a lost week:** a SerpApi failure for one topic is logged (`console.warn`, naming the topic) and that topic is excluded from that category's report — the cycle still writes a report from whatever topics succeeded, even zero. An LLM synthesis failure still writes the report row, with `summary` set to the exact literal `"[Summary generation failed this cycle]"` (spec §9).
- **SerpApi response-shape logging:** a numeric `value` field on a related-query item is coerced to a string, not dropped; a `console.warn` (including the raw shape) fires whenever a non-empty SerpApi response yields zero usable items, so a shape mismatch is visible in logs rather than silently reading as "a flat, uneventful week" (spec §4).
- **`JobResult` mapping:** all three categories wrote a report with no per-topic issues → `status: 'success'`. Any category had a partial (a skipped topic or a fallback summary) → `status: 'partial'`. Nothing could be written at all (e.g. `SERPAPI_KEY` missing) → `status: 'failure'`, thrown before any category is attempted (spec §9).
- **Budget cap:** SerpApi's real free tier is 250 searches/month (confirmed by the author, not the ~100 figure an earlier draft assumed). Curated seeds are expected to settle ~4-5/category; log the per-cycle call count so growth is visible before it threatens the cap (spec §6).
- **`/status` sections stay unstyled**, plain semantic HTML — no `<style>` tag, no classes, matching every existing section on that page exactly (spec §1, §8).
- **No injectable ops interface** for the three new seed-topic routes — unlike affiliate-candidates' approve/deny (which need to fake out a real GitHub commit in tests), promote/demote/add-topic are pure Postgres writes and call `@lhr/db` functions directly against the `db: Queryable` already passed into `createApp` (spec §8).
- **Row types in new `@lhr/db` modules are `type X = {...}`, never `interface`** — `Queryable.query<T extends Record<string, unknown>>` needs an implicit index signature that only a type alias satisfies (see `packages/db/src/candidates.ts`/`orchestratorRuns.ts` for the existing convention).
- **`@lhr/llm`'s interface is backend-agnostic** (`callLLM`, `LlmMessage` — not named after OpenRouter), with exactly one backend (OpenRouter) implemented now. A local-model backend and availability-based routing are explicitly out of scope for this plan (spec §1, §2).
- **Reading repo content at runtime uses the GitHub API, never local `fs`** — `apps/lhr-office` is a separately-deployed Vercel project (Root Directory `apps/lhr-office`); a serverless function's deployed bundle does not include the rest of the monorepo checkout. `generateWeeklyVariantRecipe.ts`'s `loadExistingSourceMealDbIds` already establishes this pattern (`createGitHubClient` + `getFile`/`listFiles` from `lhr-authoring-mcp-server/dist-lib/github.js`) for exactly this reason — the trends synthesis step's read of `docs/CONSTITUTION.md` and recent post titles follows the same pattern, not a local `readFileSync`.

---

### Task 1: Extract `@lhr/llm` package (OpenRouter backend)

**Files:**
- Create: `packages/llm/package.json`
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/src/index.ts`
- Create: `packages/llm/tests/index.test.ts`
- Modify: `package.json` (root — add `packages/llm` to `workspaces` and its build to `postinstall`, first in build order since it has no internal dependencies)

**Interfaces:**
- Produces: `LlmMessage` (`{role: 'system'|'user', content: string}`), `callLLM(messages: LlmMessage[], options?: {deadline?: number}): Promise<string>` from `@lhr/llm`. Consumed by Task 2 (mcp-server's two callers) and Task 7 (trends synthesis).

- [ ] **Step 1: Create the package**

`packages/llm/package.json`:

```json
{
  "name": "@lhr/llm",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/llm/tsconfig.json`:

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

- [ ] **Step 2: Write the failing tests**

`packages/llm/tests/index.test.ts` (ported from `mcp-server/tests/openrouter.test.ts`, `callOpenRouter` renamed `callLLM`, `import` path updated):

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callLLM } from '../src/index';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_MODEL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('callLLM', () => {
  it('posts the messages to OpenRouter and returns the reply content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'roasted beet slices' } }] }),
    }) as unknown as typeof fetch;

    const result = await callLLM([{ role: 'user', content: 'Substitute: bacon' }]);

    expect(result).toBe('roasted beet slices');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBeUndefined();
    expect(body.models).toEqual([
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'z-ai/glm-5.2:free',
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: 'Substitute: bacon' }]);
  });

  it('uses OPENROUTER_MODEL as the sole model when set, bypassing the default fallback chain', async () => {
    process.env.OPENROUTER_MODEL = 'some/other-model:free';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    }) as unknown as typeof fetch;

    await callLLM([{ role: 'user', content: 'hi' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.models).toEqual(['some/other-model:free']);
  });

  it('throws when OPENROUTER_API_KEY is not set', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws immediately when the request fails with a non-429 status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }) as unknown as typeof fetch;
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/500/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('includes the response body in the thrown error, so the real reason is visible', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => '{"error":{"message":"Insufficient credits for this request","code":402}}',
    }) as unknown as typeof fetch;
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Insufficient credits/);
  });

  it('does not crash when the error response has no body/text() available', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/500/);
  });

  it('retries a 429 (honoring Retry-After) and succeeds on a later attempt', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        return { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }) };
      }
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ choices: [{ message: { content: 'ok after retry' } }] }),
      };
    }) as unknown as typeof fetch;

    const result = await callLLM([{ role: 'user', content: 'hi' }]);

    expect(result).toBe('ok after retry');
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries when persistently rate limited, with the body in the error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '0' }),
      text: async () => '{"error":{"message":"Rate limit exceeded","code":429}}',
    }) as unknown as typeof fetch;

    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/429.*Rate limit exceeded/s);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('throws when the response has no message content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    }) as unknown as typeof fetch;
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no message content/);
  });

  it('bounds the request with an abort signal, so a hung model cannot stall the pipeline forever', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as unknown as typeof fetch;

    await callLLM([{ role: 'user', content: 'hi' }]);

    const options = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips the request and throws immediately once the given deadline has already passed', async () => {
    global.fetch = vi.fn();
    await expect(callLLM([{ role: 'user', content: 'hi' }], { deadline: Date.now() - 1 })).rejects.toThrow(
      /ran out of time/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still calls the model when the deadline has not passed yet', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }) as unknown as typeof fetch;

    const result = await callLLM([{ role: 'user', content: 'hi' }], { deadline: Date.now() + 60_000 });

    expect(result).toBe('ok');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
```

Note the one deliberate signature change from the ported original: `deadline` moves from a positional second argument (`callOpenRouter(messages, deadline?)`) into an `options` object (`callLLM(messages, options?: {deadline?: number})`) — this leaves room for a future backend-selection option (e.g. `{deadline?, backend?}`) without another positional-argument migration.

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/llm && npx vitest run
```

Expected: FAIL — `../src/index` does not exist yet, and `packages/llm` isn't installed as a workspace yet either. (If `npm` can't resolve the workspace at all, that's expected too — Step 5 fixes it.)

- [ ] **Step 4: Implement the package**

`packages/llm/src/index.ts` (moved from `mcp-server/src/openrouter.ts`, with its own local `requireEnv` — matching the established convention of every shared package keeping a private copy rather than depending on `mcp-server` for it, see `packages/db/src/client.ts`):

```ts
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Each of these free models routes through a different upstream provider's own shared free
// pool (Google AI Studio, NVIDIA, Z.ai respectively). OpenRouter tries them in order server-side
// within a single request/response cycle and falls through automatically on an error (including
// rate limiting) - see https://openrouter.ai/docs/guides/routing/model-fallbacks. This matters
// because a single free model's shared pool getting saturated is common and NOT something our
// own request pacing can fix (it's rate-limited upstream, shared across every OpenRouter user on
// that model, regardless of how slowly we call it) - spreading the fallback chain across
// different providers means one saturated pool doesn't take down the whole run.
const DEFAULT_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'z-ai/glm-5.2:free',
];
const MAX_RATE_LIMIT_ATTEMPTS = 4;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5000;
// A hung free-tier model never throws on its own — without a hard cap a single stuck call can
// eat the whole pipeline's time budget. Bounding every request lets a stuck model fail over
// (or fail fast) instead of hanging indefinitely.
const REQUEST_TIMEOUT_MS = 25_000;

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CallLlmOptions {
  // An epoch-ms cutoff for a whole multi-call pipeline, not just this single request. Once it's
  // passed, skip the network call entirely rather than spending another REQUEST_TIMEOUT_MS
  // finding out something already knows: the pipeline is out of time.
  deadline?: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response): number {
  const header = response.headers?.get?.('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export async function callLLM(messages: LlmMessage[], options?: CallLlmOptions): Promise<string> {
  const deadline = options?.deadline;
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new Error('OpenRouter call skipped: ran out of time for this pipeline run');
  }

  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const models = process.env.OPENROUTER_MODEL ? [process.env.OPENROUTER_MODEL] : DEFAULT_MODELS;

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

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter response had no message content');
  }
  return content;
}
```

- [ ] **Step 5: Wire the workspace into the root**

In root `package.json`, add `"packages/llm"` to `workspaces` (order doesn't matter for `workspaces` itself, but list it) and add its build as the *first* step of `postinstall` (it has zero internal dependencies, so nothing needs to build before it):

```json
  "workspaces": [
    "mcp-server",
    "packages/schemas",
    "packages/jobs",
    "packages/db",
    "packages/llm",
    "apps/lhr-office"
  ],
```

```json
    "postinstall": "npm run build --workspace=@lhr/llm && npm run build --workspace=@lhr/schemas && npm run build --workspace=mcp-server && npm run build --workspace=@lhr/jobs && npm run build --workspace=@lhr/db",
```

- [ ] **Step 6: Install and run tests**

```bash
npm install
cd packages/llm && npx vitest run
```

Expected: PASS (all 13 cases).

- [ ] **Step 7: Commit**

```bash
git add packages/llm package.json package-lock.json
git commit -m "Extract @lhr/llm package with an OpenRouter backend"
```

---

### Task 2: Switch mcp-server's LLM callers to `@lhr/llm`

**Files:**
- Delete: `mcp-server/src/openrouter.ts`
- Delete: `mcp-server/tests/openrouter.test.ts`
- Modify: `mcp-server/src/dietSubstitutions.ts`
- Modify: `mcp-server/src/narrative.ts`
- Modify: `mcp-server/tests/dietSubstitutions.test.ts`
- Modify: `mcp-server/tests/narrative.test.ts`
- Modify: `mcp-server/package.json` (add `@lhr/llm` dependency, add its build to the `build`/`dev` scripts)

**Interfaces:**
- Consumes: `callLLM`, `type LlmMessage` (`@lhr/llm`, from Task 1).

- [ ] **Step 1: Add the dependency and build-order entry**

In `mcp-server/package.json`, add to `dependencies`:

```json
    "@lhr/llm": "*",
```

and update `build` (add `@lhr/llm` before the typecheck, alongside the existing `@lhr/schemas`/`@lhr/db` builds):

```json
    "build": "npm run build --workspace=@lhr/schemas && npm run build --workspace=@lhr/llm && npm run build --workspace=@lhr/db && tsc --noEmit -p tsconfig.json && tsc -p tsconfig.lib.json && node scripts/bundle.mjs",
```

- [ ] **Step 2: Switch `dietSubstitutions.ts`'s import**

In `mcp-server/src/dietSubstitutions.ts`, change:

```ts
import { callOpenRouter } from './openrouter.js';
```

to:

```ts
import { callLLM } from '@lhr/llm';
```

and replace both call sites (`substituteIngredient`'s and `rewriteSteps`'s `callOpenRouter(` calls) with `callLLM(`, changing the positional `deadline` argument into the options-object form:

```ts
  const content = await callLLM(
    [
      {
        role: 'system',
        content:
          'You substitute recipe ingredients for a specific diet. Reply with ONLY the substitute ' +
          'ingredient name, or the exact text "no substitution needed" if the ingredient is already ' +
          'fine for that diet. No punctuation, no explanation.',
      },
      { role: 'user', content: `Ingredient: "${normalized}"\nDiet: ${diet}` },
    ],
    { deadline },
  );
```

```ts
  const content = await callLLM(
    [
      {
        role: 'system',
        content:
          'You rewrite recipe steps so they reflect ingredient substitutions. Reply with ONLY a JSON ' +
          'array of strings, one per input step, in the same order, with no other text.',
      },
      {
        role: 'user',
        content: `Diet: ${diet}\nSubstitutions:\n${changeList}\n\nSteps:\n${JSON.stringify(originalSteps)}`,
      },
    ],
    { deadline },
  );
```

- [ ] **Step 3: Switch `narrative.ts`'s import**

In `mcp-server/src/narrative.ts`, change:

```ts
import { callOpenRouter } from './openrouter.js';
```

to:

```ts
import { callLLM } from '@lhr/llm';
```

and its one call site from `callOpenRouter([` to `callLLM([` (no `deadline` was passed here before, so no options object needed — leave that call bare).

- [ ] **Step 4: Update the two test files' mocks**

In `mcp-server/tests/dietSubstitutions.test.ts`, change:

```ts
const callOpenRouter = vi.fn();
vi.mock('../src/openrouter', () => ({
  callOpenRouter: (...args: unknown[]) => callOpenRouter(...args),
}));
```

to:

```ts
const callLLM = vi.fn();
vi.mock('@lhr/llm', () => ({
  callLLM: (...args: unknown[]) => callLLM(...args),
}));
```

and rename every other reference to the mock in that file from `callOpenRouter` to `callLLM` (the assertions like `expect(callOpenRouter).toHaveBeenCalledTimes(1)` become `expect(callLLM).toHaveBeenCalledTimes(1)`, etc. — a straightforward rename, no assertion logic changes).

Make the identical change in `mcp-server/tests/narrative.test.ts` (same `vi.mock` swap, same rename of the local `callOpenRouter` const/references to `callLLM`).

- [ ] **Step 5: Delete the old module and its test**

```bash
git rm mcp-server/src/openrouter.ts mcp-server/tests/openrouter.test.ts
```

- [ ] **Step 6: Run tests to verify everything still passes**

```bash
cd mcp-server && npx vitest run tests/dietSubstitutions.test.ts tests/narrative.test.ts
```

Expected: PASS (all cases, same count as before the rename).

```bash
npm install
cd mcp-server && npx vitest run
```

Expected: PASS (full mcp-server suite — confirms nothing else referenced the deleted module).

```bash
cd mcp-server && npm run build
```

Expected: succeeds (confirms `@lhr/llm` builds ahead of mcp-server's own typecheck/bundle and every import resolves).

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/dietSubstitutions.ts mcp-server/src/narrative.ts mcp-server/tests/dietSubstitutions.test.ts mcp-server/tests/narrative.test.ts mcp-server/package.json package-lock.json
git commit -m "Switch mcp-server's LLM callers from openrouter.ts to @lhr/llm"
```

---

### Task 3: Relocate the job registry from `packages/jobs` to `apps/lhr-office`

**Files:**
- Delete: `packages/jobs/src/registry.ts`
- Delete: `packages/jobs/tests/registry.test.ts`
- Modify: `packages/jobs/src/index.ts`
- Modify: `packages/jobs/package.json` (remove the now-unused `lhr-authoring-mcp-server` dependency)
- Create: `apps/lhr-office/src/registry.ts`
- Create: `apps/lhr-office/tests/registry.test.ts`
- Modify: `apps/lhr-office/src/server.ts`

**Interfaces:**
- Produces: `jobs: JobRegistration[]` from `apps/lhr-office/src/registry.ts` — consumed by `server.ts` (this task) and extended with a fourth entry in Task 7.

- [ ] **Step 1: Move the registry file's content**

`apps/lhr-office/src/registry.ts` (identical content to today's `packages/jobs/src/registry.ts`, only the import paths for the generic types/validator change):

```ts
import type { JobRegistration } from '@lhr/jobs';
import { validateJobRegistrations } from '@lhr/jobs';
import { generateWeeklyVariantRecipe } from 'lhr-authoring-mcp-server/dist-lib/generateWeeklyVariantRecipe.js';
import { finishPendingRecipeVariants } from 'lhr-authoring-mcp-server/dist-lib/finishRecipeVariants.js';
import { sourceAffiliateCandidates } from 'lhr-authoring-mcp-server/dist-lib/sourceAffiliateCandidates.js';

export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants },
  { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates },
];

validateJobRegistrations(jobs);
```

- [ ] **Step 2: Move the registry test's content**

`apps/lhr-office/tests/registry.test.ts` (identical to today's `packages/jobs/tests/registry.test.ts`, only the import path changes):

```ts
import { describe, expect, it } from 'vitest';
import { jobs } from '../src/registry';
import { validateJobRegistrations } from '@lhr/jobs';

describe('jobs registry', () => {
  it('registers the recipe-variant-generator job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'recipe-variant-generator');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });

  it('registers the recipe-variant-finisher job on a daily cadence', () => {
    const job = jobs.find((j) => j.name === 'recipe-variant-finisher');
    expect(job).toMatchObject({ cadenceDays: 1 });
    expect(job?.run).toBeTypeOf('function');
  });

  it('registers the affiliate-sourcing job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'affiliate-sourcing');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });

  it('is always shape-valid', () => {
    expect(() => validateJobRegistrations(jobs)).not.toThrow();
  });
});
```

- [ ] **Step 3: Delete the old files, shrink `packages/jobs`**

```bash
git rm packages/jobs/src/registry.ts packages/jobs/tests/registry.test.ts
```

In `packages/jobs/src/index.ts`, remove the line `export * from './registry.js';` — it should now read:

```ts
export * from './types.js';
export * from './dueCheck.js';
export * from './validateRegistry.js';
```

In `packages/jobs/package.json`, remove the now-unused dependency (nothing left in `packages/jobs/src/` imports it):

```json
  "dependencies": {},
```

(was `{"lhr-authoring-mcp-server": "*"}` — delete that key entirely, leaving an empty object, matching `@lhr/llm`'s `package.json` from Task 1.)

- [ ] **Step 4: Point `server.ts` at the relocated registry**

In `apps/lhr-office/src/server.ts`, change:

```ts
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from '@lhr/jobs';
```

to:

```ts
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from './registry.js';
```

- [ ] **Step 5: Run tests and build**

```bash
npm install
cd packages/jobs && npx vitest run
```

Expected: PASS — only `dueCheck.test.ts` and `validateRegistry.test.ts` remain here, both untouched and still green.

```bash
cd apps/lhr-office && npx vitest run tests/registry.test.ts tests/server.test.ts
```

Expected: PASS — same 3 registry cases as before, and `server.test.ts`'s existing suite unaffected (it already injects its own registry array via `createApp(fakeDb, [], ...)`, so `server.ts`'s *default* registry source doesn't change any existing test's behavior).

```bash
cd apps/lhr-office && npm run build
```

Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/src/registry.ts apps/lhr-office/tests/registry.test.ts apps/lhr-office/src/server.ts packages/jobs/src/registry.ts packages/jobs/tests/registry.test.ts packages/jobs/src/index.ts packages/jobs/package.json package-lock.json
git commit -m "Relocate the concrete job registry from @lhr/jobs into apps/lhr-office"
```

---

### Task 4: `trend_seed_topics` table and query module

**Files:**
- Modify: `packages/db/src/schema.sql`
- Create: `packages/db/src/trendSeedTopics.ts`
- Create: `packages/db/tests/trendSeedTopics.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Produces: `TREND_CATEGORIES` (`readonly ['web-design', 'cooking', 'nutrition']`), `type TrendCategory`, `type TrendSeedTopic`, `normalizeTopic(topic): string`, `getCuratedTopics(db, category): Promise<TrendSeedTopic[]>`, `getAllTopics(db): Promise<TrendSeedTopic[]>`, `upsertSuggestedTopic(db, category, topic): Promise<TrendSeedTopic>`, `promoteEligibleCandidates(db): Promise<TrendSeedTopic[]>`, `setTopicStatus(db, id, status: 'curated'|'candidate'): Promise<void>`, `addCuratedTopic(db, category, topic): Promise<TrendSeedTopic>`. Consumed by Task 6 (SerpApi trending_now category mapping doesn't need this, but Task 7's pipeline does), Task 7, and Task 8 (`/status`).

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

Expected: FAIL — `../src/trendSeedTopics` does not exist yet.

- [ ] **Step 3: Add the schema**

Append to `packages/db/src/schema.sql`:

```sql
CREATE TABLE trend_seed_topics (
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
```

- [ ] **Step 4: Implement `trendSeedTopics.ts`**

`packages/db/src/trendSeedTopics.ts`:

```ts
import type { Queryable } from './client.js';

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

type TrendSeedTopicRow = {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
  times_seen: number;
  first_seen_at: Date;
  last_seen_at: Date;
  promoted_at: Date | null;
};

const PROMOTION_THRESHOLD = 3;

function mapRow(row: TrendSeedTopicRow): TrendSeedTopic {
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

export async function getCuratedTopics(db: Queryable, category: TrendCategory): Promise<TrendSeedTopic[]> {
  const result = await db.query<TrendSeedTopicRow>(
    `SELECT * FROM trend_seed_topics WHERE category = $1 AND status = 'curated' ORDER BY topic ASC`,
    [category],
  );
  return result.rows.map(mapRow);
}

export async function getAllTopics(db: Queryable): Promise<TrendSeedTopic[]> {
  const result = await db.query<TrendSeedTopicRow>(
    `SELECT * FROM trend_seed_topics ORDER BY category ASC, status ASC, times_seen DESC`,
  );
  return result.rows.map(mapRow);
}

export async function upsertSuggestedTopic(
  db: Queryable,
  category: TrendCategory,
  topic: string,
): Promise<TrendSeedTopic> {
  const normalized = normalizeTopic(topic);
  const result = await db.query<TrendSeedTopicRow>(
    `INSERT INTO trend_seed_topics (category, topic)
     VALUES ($1, $2)
     ON CONFLICT (category, topic)
     DO UPDATE SET times_seen = trend_seed_topics.times_seen + 1, last_seen_at = now()
     RETURNING *`,
    [category, normalized],
  );
  return mapRow(result.rows[0]);
}

export async function promoteEligibleCandidates(db: Queryable): Promise<TrendSeedTopic[]> {
  const result = await db.query<TrendSeedTopicRow>(
    `UPDATE trend_seed_topics
     SET status = 'curated', promoted_at = now()
     WHERE status = 'candidate' AND times_seen >= $1
     RETURNING *`,
    [PROMOTION_THRESHOLD],
  );
  return result.rows.map(mapRow);
}

export async function setTopicStatus(db: Queryable, id: number, status: 'curated' | 'candidate'): Promise<void> {
  if (status === 'curated') {
    await db.query(`UPDATE trend_seed_topics SET status = 'curated', promoted_at = now() WHERE id = $1`, [id]);
  } else {
    await db.query(`UPDATE trend_seed_topics SET status = 'candidate', promoted_at = NULL WHERE id = $1`, [id]);
  }
}

export async function addCuratedTopic(db: Queryable, category: TrendCategory, topic: string): Promise<TrendSeedTopic> {
  const normalized = normalizeTopic(topic);
  const result = await db.query<TrendSeedTopicRow>(
    `INSERT INTO trend_seed_topics (category, topic, status, times_seen, promoted_at)
     VALUES ($1, $2, 'curated', 1, now())
     ON CONFLICT (category, topic)
     DO UPDATE SET status = 'curated', promoted_at = now()
     RETURNING *`,
    [category, normalized],
  );
  return mapRow(result.rows[0]);
}
```

- [ ] **Step 5: Wire the export**

In `packages/db/src/index.ts`, add:

```ts
export * from './trendSeedTopics.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS (all of `trendSeedTopics.test.ts` plus every pre-existing test in the package).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/trendSeedTopics.ts packages/db/src/index.ts packages/db/tests/trendSeedTopics.test.ts
git commit -m "Add trend_seed_topics table with normalize/upsert/promote logic"
```

---

### Task 5: `trends_reports` table and query module

**Files:**
- Modify: `packages/db/src/schema.sql`
- Create: `packages/db/src/trendsReports.ts`
- Create: `packages/db/tests/trendsReports.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `type TrendCategory` (`./trendSeedTopics.js`, from Task 4).
- Produces: `TopicUsed`, `TrendsReport`, `NewTrendsReport`, `insertTrendsReport(db, report): Promise<TrendsReport>`, `listRecentReports(db, category, limit?): Promise<TrendsReport[]>`. Consumed by Task 7, Task 8.

- [ ] **Step 1: Write the failing tests**

`packages/db/tests/trendsReports.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertTrendsReport, listRecentReports, type NewTrendsReport } from '../src/trendsReports';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewTrendsReport = {
  cycleId: '2026-09-06',
  category: 'cooking',
  topicsUsed: [{ topic: 'air fryer recipes', source: 'curated' }],
  rawFindings: { topics: [], trendingNow: [] },
  summary: 'Air fryer content is trending; we already cover it well.',
};

const reportRow = {
  id: 1, cycle_id: '2026-09-06', category: 'cooking', generated_at: new Date('2026-09-06T00:00:00Z'),
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
      ['2026-09-06', 'cooking', JSON.stringify(newReport.topicsUsed), JSON.stringify(newReport.rawFindings), newReport.summary],
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

Expected: FAIL — `../src/trendsReports` does not exist yet.

- [ ] **Step 3: Add the schema**

Append to `packages/db/src/schema.sql`:

```sql
CREATE TABLE trends_reports (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  category TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  topics_used JSONB NOT NULL,
  raw_findings JSONB NOT NULL,
  summary TEXT NOT NULL
);
```

- [ ] **Step 4: Implement `trendsReports.ts`**

`packages/db/src/trendsReports.ts`:

```ts
import type { Queryable } from './client.js';
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

type TrendsReportRow = {
  id: number;
  cycle_id: string;
  category: TrendCategory;
  generated_at: Date;
  topics_used: TopicUsed[];
  raw_findings: unknown;
  summary: string;
};

function mapRow(row: TrendsReportRow): TrendsReport {
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

export async function insertTrendsReport(db: Queryable, report: NewTrendsReport): Promise<TrendsReport> {
  const result = await db.query<TrendsReportRow>(
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
  );
  return mapRow(result.rows[0]);
}

export async function listRecentReports(db: Queryable, category: TrendCategory, limit = 10): Promise<TrendsReport[]> {
  const result = await db.query<TrendsReportRow>(
    `SELECT * FROM trends_reports WHERE category = $1 ORDER BY generated_at DESC LIMIT $2`,
    [category, limit],
  );
  return result.rows.map(mapRow);
}
```

- [ ] **Step 5: Wire the export**

In `packages/db/src/index.ts`, add:

```ts
export * from './trendsReports.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/db && npx vitest run
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.sql packages/db/src/trendsReports.ts packages/db/src/index.ts packages/db/tests/trendsReports.test.ts
git commit -m "Add trends_reports table for weekly cycle storage"
```

---

### Task 6: SerpApi client

**Files:**
- Create: `apps/lhr-office/src/serpapiTrends.ts`
- Create: `apps/lhr-office/tests/serpapiTrends.test.ts`
- Modify: `.env.example` (add `SERPAPI_KEY`)

**Interfaces:**
- Produces: `RelatedQuery`, `InterestAndRelatedQueries`, `TrendingNowItem`, `fetchInterestAndRelatedQueries(topic, geo?): Promise<InterestAndRelatedQueries>`, `fetchTrendingNow(category): Promise<TrendingNowItem[]>`. Consumed by Task 7.

**Verification note:** SerpApi's `RELATED_QUERIES` response's exact `related_queries.top`/`related_queries.rising` item field names weren't confirmed from published docs — only `interest_over_time.timeline_data[].values[].{query,value,extracted_value}` is documented with a sample. The `category_id` values for `trending_now` (`18`=Technology, `5`=Food and Drink, `7`=Health) *were* confirmed from SerpApi's own published category list. Since the author now has a real `SERPAPI_KEY` (spec's open question resolved — SerpApi's free tier is 250 searches/month), Step 6 below is a live-call check against the assumed `{query, value}` shape — adjust the types/parsing if the real response differs.

- [ ] **Step 1: Write the failing tests**

`apps/lhr-office/tests/serpapiTrends.test.ts`:

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

  it('coerces a numeric value field to a string rather than dropping the item', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return { ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) };
      }
      return { ok: true, json: async () => ({ related_queries: { top: [{ query: 'air fryer chicken', value: 87 }] } }) };
    }) as unknown as typeof fetch;

    const result = await fetchInterestAndRelatedQueries('air fryer recipes');
    expect(result.topQueries).toEqual([{ query: 'air fryer chicken', value: '87' }]);
  });

  it('warns when a non-empty related-queries response yields zero usable items', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = new URL(url as string);
      if (u.searchParams.get('data_type') === 'TIMESERIES') {
        return { ok: true, json: async () => ({ interest_over_time: { timeline_data: [] } }) };
      }
      return { ok: true, json: async () => ({ related_queries: { top: [{ someOtherShape: true }] } }) };
    }) as unknown as typeof fetch;

    await fetchInterestAndRelatedQueries('air fryer recipes');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('air fryer recipes'), expect.any(String));
    warnSpy.mockRestore();
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
cd apps/lhr-office && npx vitest run tests/serpapiTrends.test.ts
```

Expected: FAIL — `../src/serpapiTrends` does not exist yet.

- [ ] **Step 3: Implement `serpapiTrends.ts`**

`apps/lhr-office/src/serpapiTrends.ts`:

```ts
const SERPAPI_URL = 'https://serpapi.com/search.json';

// Confirmed from SerpApi's published Google Trends Trending Now category list.
const CATEGORY_ID_MAP: Record<string, string> = {
  'web-design': '18', // Technology
  cooking: '5', // Food and Drink
  nutrition: '7', // Health
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

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
  value?: string | number;
}

interface GoogleTrendsRelatedResponse {
  related_queries?: { top?: RelatedQueryItem[]; rising?: RelatedQueryItem[] };
}

interface TrendingNowResponse {
  trending_searches?: { query?: string; search_volume?: number; increase_percentage?: number }[];
}

const DIRECTION_THRESHOLD = 5;

function computeDirection(topic: string, points: TimelinePoint[]): 'rising' | 'falling' | 'flat' {
  const values = points
    .map((p) => p.values?.[0]?.extracted_value)
    .filter((v): v is number => typeof v === 'number');
  if (points.length > 0 && values.length < 2) {
    console.warn(`[serpapiTrends] "${topic}": interest_over_time had no usable extracted_value points`, JSON.stringify(points[0]));
  }
  if (values.length < 2) return 'flat';
  const delta = values[values.length - 1] - values[0];
  if (delta > DIRECTION_THRESHOLD) return 'rising';
  if (delta < -DIRECTION_THRESHOLD) return 'falling';
  return 'flat';
}

function toRelated(topic: string, items: RelatedQueryItem[] | undefined): RelatedQuery[] {
  const list = items ?? [];
  const mapped = list
    .filter((item): item is RelatedQueryItem & { query: string } => typeof item.query === 'string' && item.query.length > 0 && item.value !== undefined)
    .map((item) => ({ query: item.query, value: String(item.value) }));
  if (list.length > 0 && mapped.length === 0) {
    console.warn(`[serpapiTrends] "${topic}": related_queries had no usable {query,value} items`, JSON.stringify(list[0]));
  }
  return mapped;
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
    direction: computeDirection(topic, timelineData),
    topQueries: toRelated(topic, relatedData.related_queries?.top),
    risingQueries: toRelated(topic, relatedData.related_queries?.rising),
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
cd apps/lhr-office && npx vitest run tests/serpapiTrends.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the env var**

Append to `.env.example`:

```
SERPAPI_KEY=
```

- [ ] **Step 6: Live-call verification (the author already has a real key)**

```bash
curl -s "https://serpapi.com/search.json?engine=google_trends&q=air%20fryer%20recipes&geo=US&data_type=RELATED_QUERIES&api_key=$SERPAPI_KEY" | head -c 2000
```

Compare the actual `related_queries.top`/`related_queries.rising` item fields against `RelatedQueryItem` (`query`, `value`) above. If the real fields differ, update `RelatedQueryItem`/`toRelated`/the test fixtures to match, then re-run Step 4.

- [ ] **Step 7: Commit**

```bash
git add apps/lhr-office/src/serpapiTrends.ts apps/lhr-office/tests/serpapiTrends.test.ts .env.example
git commit -m "Add SerpApi client for Google Trends interest/related-queries and trending-now"
```

---

### Task 7: Weekly trends pipeline and registry wiring

**Files:**
- Create: `apps/lhr-office/src/trendsWatcher.ts`
- Create: `apps/lhr-office/tests/trendsWatcher.test.ts`
- Modify: `apps/lhr-office/src/registry.ts`
- Modify: `apps/lhr-office/tests/registry.test.ts`

**Interfaces:**
- Consumes: `TREND_CATEGORIES`, `type TrendCategory`, `getCuratedTopics`, `upsertSuggestedTopic`, `promoteEligibleCandidates`, `type TopicUsed`, `insertTrendsReport`, `getPool` (`@lhr/db`, Tasks 4-5); `fetchInterestAndRelatedQueries`, `fetchTrendingNow`, `type InterestAndRelatedQueries`, `type TrendingNowItem` (`./serpapiTrends.js`, Task 6); `callLLM` (`@lhr/llm`, Task 1); `getFile`, `listFiles`, `createGitHubClient`, `type GitHubClient` (`lhr-authoring-mcp-server/dist-lib/github.js`); `parsePostFrontmatter` (`lhr-authoring-mcp-server/dist-lib/backfillIngredientLinks.js`); `type JobResult` (`@lhr/jobs`).
- Produces: `sourceWeeklyTrends(): Promise<JobResult>` — registered as the 4th `apps/lhr-office/src/registry.ts` entry.

- [ ] **Step 1: Write the failing integration test**

`apps/lhr-office/tests/trendsWatcher.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const dbMock = {
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  getCuratedTopics: vi.fn(),
  upsertSuggestedTopic: vi.fn(),
  promoteEligibleCandidates: vi.fn().mockResolvedValue([]),
  insertTrendsReport: vi.fn(),
  getPool: vi.fn(() => ({})),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = {
  fetchInterestAndRelatedQueries: vi.fn(),
  fetchTrendingNow: vi.fn(),
};
vi.mock('../src/serpapiTrends', () => serpapiMock);

const llmMock = { callLLM: vi.fn() };
vi.mock('@lhr/llm', () => llmMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(),
  listFiles: vi.fn(),
};
vi.mock('lhr-authoring-mcp-server/dist-lib/github.js', () => githubMock);

const { sourceWeeklyTrends } = await import('../src/trendsWatcher');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  dbMock.getCuratedTopics.mockResolvedValue([]);
  dbMock.upsertSuggestedTopic.mockImplementation(async (_db, category, topic) => ({
    id: 1, category, topic, status: 'candidate', timesSeen: 1,
    firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: null,
  }));
  dbMock.insertTrendsReport.mockImplementation(async (_db, report) => ({ id: 1, ...report, generatedAt: new Date() }));
  githubMock.getFile.mockResolvedValue({ content: '# LHR Constitution\n\n1. Never auto-publish.', sha: 'x' });
  githubMock.listFiles.mockResolvedValue([]);
  llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
    const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
    return isSuggestionCall ? '["sourdough starter"]' : 'This week: sourdough interest is rising.';
  });
  serpapiMock.fetchInterestAndRelatedQueries.mockResolvedValue({
    direction: 'rising', topQueries: [], risingQueries: [{ query: 'sourdough starter jar', value: '80' }],
  });
  serpapiMock.fetchTrendingNow.mockResolvedValue([{ query: 'meal prep', searchVolume: 100, increasePercentage: 10 }]);
});

describe('sourceWeeklyTrends', () => {
  it('writes one trends_reports row per category and reports success', async () => {
    const result = await sourceWeeklyTrends();
    expect(dbMock.insertTrendsReport).toHaveBeenCalledTimes(3);
    const categories = dbMock.insertTrendsReport.mock.calls.map((c) => c[1].category);
    expect(categories.sort()).toEqual(['cooking', 'nutrition', 'web-design']);
    expect(result.status).toBe('success');
  });

  it('reports partial and still writes a report when one topic fails SerpApi', async () => {
    dbMock.getCuratedTopics.mockImplementation(async (_db, category) =>
      category === 'cooking'
        ? [{ id: 1, category, topic: 'air fryer recipes', status: 'curated', timesSeen: 3, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() }]
        : [],
    );
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      return isSuggestionCall ? '[]' : 'summary text';
    });
    serpapiMock.fetchInterestAndRelatedQueries.mockRejectedValueOnce(new Error('rate limited'));

    const result = await sourceWeeklyTrends();

    const cookingCall = dbMock.insertTrendsReport.mock.calls.find((c) => c[1].category === 'cooking');
    expect(cookingCall![1].topicsUsed).toEqual([]);
    expect(result.status).toBe('partial');
  });

  it('writes the placeholder summary when the synthesis LLM call fails', async () => {
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      if (isSuggestionCall) return '[]';
      throw new Error('OpenRouter down');
    });

    const result = await sourceWeeklyTrends();

    for (const call of dbMock.insertTrendsReport.mock.calls) {
      expect(call[1].summary).toBe('[Summary generation failed this cycle]');
    }
    expect(result.status).toBe('partial');
  });

  it('dedupes a suggested topic already in the curated list — no double SerpApi call, no upsert', async () => {
    dbMock.getCuratedTopics.mockImplementation(async (_db, category) =>
      category === 'cooking'
        ? [{ id: 1, category, topic: 'sourdough starter', status: 'curated', timesSeen: 3, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() }]
        : [],
    );
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      return isSuggestionCall ? '["Sourdough Starter"]' : 'summary text';
    });

    await sourceWeeklyTrends();

    const cookingFetchCalls = serpapiMock.fetchInterestAndRelatedQueries.mock.calls.filter((c) => c[0] === 'sourdough starter');
    expect(cookingFetchCalls).toHaveLength(1);
    expect(dbMock.upsertSuggestedTopic).not.toHaveBeenCalledWith(expect.anything(), 'cooking', expect.anything());
  });

  it('throws before any category is attempted when GITHUB_TOKEN is missing (fail-fast, surfaced as a failure by the caller)', async () => {
    // GITHUB_TOKEN is the actual fail-fast trigger this test exercises: sourceWeeklyTrends's first
    // statement is createGitHubClient(requireEnv('GITHUB_TOKEN')), needed before any category's
    // docs/CONSTITUTION.md read. SERPAPI_KEY's equivalent fail-fast is already covered by Task 6's
    // serpapiTrends.test.ts ("throws when SERPAPI_KEY is not set") since that check lives inside
    // fetchInterestAndRelatedQueries/fetchTrendingNow themselves, not in this orchestration layer.
    delete process.env.GITHUB_TOKEN;
    await expect(sourceWeeklyTrends()).rejects.toThrow(/GITHUB_TOKEN/);
    expect(dbMock.insertTrendsReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/lhr-office && npx vitest run tests/trendsWatcher.test.ts
```

Expected: FAIL — `../src/trendsWatcher` does not exist yet.

- [ ] **Step 3: Implement `trendsWatcher.ts`**

`apps/lhr-office/src/trendsWatcher.ts`:

```ts
import type { JobResult } from '@lhr/jobs';
import {
  TREND_CATEGORIES,
  type TrendCategory,
  getCuratedTopics,
  upsertSuggestedTopic,
  promoteEligibleCandidates,
  insertTrendsReport,
  getPool,
  type TopicUsed,
} from '@lhr/db';
import { fetchInterestAndRelatedQueries, fetchTrendingNow, type InterestAndRelatedQueries, type TrendingNowItem } from './serpapiTrends.js';
import { callLLM } from '@lhr/llm';
import { createGitHubClient, getFile, listFiles, type GitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import { parsePostFrontmatter } from 'lhr-authoring-mcp-server/dist-lib/backfillIngredientLinks.js';

const SUGGESTIONS_PER_CATEGORY = 2;
const RECENT_POST_LIMIT = 15;
const SUMMARY_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';

interface TopicFinding {
  topic: string;
  source: 'curated' | 'suggested';
  interest: InterestAndRelatedQueries;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function readConstitution(client: GitHubClient): Promise<string> {
  const file = await getFile(client, 'docs/CONSTITUTION.md', 'main');
  return file?.content ?? '';
}

async function readRecentPostTitles(client: GitHubClient, limit: number): Promise<string[]> {
  const filenames = await listFiles(client, 'src/content/posts', 'main');
  const titles: string[] = [];
  for (const filename of filenames.filter((f) => f.endsWith('.mdx')).slice(0, limit)) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;
    try {
      const frontmatter = parsePostFrontmatter(file.content);
      if (typeof frontmatter.title === 'string') titles.push(frontmatter.title);
    } catch {
      // Skip a post whose frontmatter doesn't parse rather than fail the whole cycle.
    }
  }
  return titles;
}

async function suggestAdjacentTopics(category: TrendCategory, curated: string[]): Promise<string[]> {
  const reply = await callLLM([
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
    return await callLLM([
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

export async function sourceWeeklyTrends(): Promise<JobResult> {
  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  const pool = getPool();

  const cycleId = new Date().toISOString().slice(0, 10);
  const constitution = await readConstitution(client);
  const recentPostTitles = await readRecentPostTitles(client, RECENT_POST_LIMIT);

  const partialCategories: string[] = [];

  for (const category of TREND_CATEGORIES) {
    let callCount = 0;

    const curated = await getCuratedTopics(pool, category);
    const curatedTopics = curated.map((t) => t.topic);
    const curatedNormalized = new Set(curatedTopics.map((t) => t.toLowerCase().trim()));

    const suggestedRaw = await suggestAdjacentTopics(category, curatedTopics);
    const seenNormalized = new Set<string>();
    const suggested: string[] = [];
    for (const topic of suggestedRaw) {
      const normalized = topic.toLowerCase().trim();
      if (curatedNormalized.has(normalized) || seenNormalized.has(normalized)) continue;
      seenNormalized.add(normalized);
      suggested.push(topic);
    }

    const candidateTopics: TopicUsed[] = [
      ...curatedTopics.map((topic) => ({ topic, source: 'curated' as const })),
      ...suggested.map((topic) => ({ topic, source: 'suggested' as const })),
    ];

    const findings: TopicFinding[] = [];
    const topicsUsed: TopicUsed[] = [];
    let hadTopicFailure = false;
    for (const { topic, source } of candidateTopics) {
      callCount += 1;
      try {
        const interest = await fetchInterestAndRelatedQueries(topic);
        findings.push({ topic, source, interest });
        topicsUsed.push({ topic, source });
      } catch (err) {
        hadTopicFailure = true;
        console.warn(
          `[trends] fetchInterestAndRelatedQueries failed for "${topic}" (${category}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    callCount += 1;
    let trendingNow: TrendingNowItem[] = [];
    try {
      trendingNow = await fetchTrendingNow(category);
    } catch (err) {
      console.warn(`[trends] fetchTrendingNow failed for ${category}: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const topic of suggested) {
      await upsertSuggestedTopic(pool, category, topic);
    }
    await promoteEligibleCandidates(pool);

    const summary = await synthesizeSummary({ category, findings, trendingNow, constitution, recentPostTitles });
    if (summary === SUMMARY_FAILURE_PLACEHOLDER || hadTopicFailure) {
      partialCategories.push(category);
    }

    await insertTrendsReport(pool, {
      cycleId,
      category,
      topicsUsed,
      rawFindings: { topics: findings, trendingNow },
      summary,
    });

    console.log(`[trends] ${category}: ${callCount} SerpApi call(s) this cycle`);
  }

  if (partialCategories.length > 0) {
    return {
      status: 'partial',
      summary: `Wrote reports for all 3 categories; ${partialCategories.join(', ')} had a partial cycle (skipped topic or fallback summary).`,
    };
  }
  return { status: 'success', summary: 'Wrote a trends report for all 3 categories.' };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/lhr-office && npx vitest run tests/trendsWatcher.test.ts
```

Expected: PASS (all 5 cases).

- [ ] **Step 5: Wire the 4th registry entry**

In `apps/lhr-office/src/registry.ts`, add the import and entry:

```ts
import { sourceWeeklyTrends } from './trendsWatcher.js';
```

```ts
export const jobs: JobRegistration[] = [
  { name: 'recipe-variant-generator', cadenceDays: 7, run: generateWeeklyVariantRecipe },
  { name: 'recipe-variant-finisher', cadenceDays: 1, run: finishPendingRecipeVariants },
  { name: 'affiliate-sourcing', cadenceDays: 7, run: sourceAffiliateCandidates },
  { name: 'trends-watcher', cadenceDays: 7, run: sourceWeeklyTrends },
];
```

In `apps/lhr-office/tests/registry.test.ts`, add a fourth case:

```ts
  it('registers the trends-watcher job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'trends-watcher');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });
```

- [ ] **Step 6: Run the whole `apps/lhr-office` suite and build**

```bash
cd apps/lhr-office && npx vitest run
```

Expected: PASS (every test file in the app, including the new registry case).

```bash
cd apps/lhr-office && npm run build
```

Expected: succeeds.

- [ ] **Step 7: Manual verification with real credentials**

This needs real `DATABASE_URL`, `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, and `SERPAPI_KEY` — run by hand once, after applying the schema (Tasks 4-5's SQL) to a real database:

```bash
psql "$DATABASE_URL" -f packages/db/src/schema.sql
```

Then, from `apps/lhr-office`, start the local dev server (`npm run dev`) and trigger the job directly rather than waiting for the due-check:

```bash
curl -u "$STATUS_AUTH_USER:$STATUS_AUTH_PASSWORD" -X POST http://localhost:3001/status/run/trends-watcher
```

Expected: redirects to `/status`; the server logs show `[trends] <category>: N SerpApi call(s) this cycle` for all 3 categories. Confirm via `psql "$DATABASE_URL" -c "SELECT category, cycle_id, summary FROM trends_reports;"`.

- [ ] **Step 8: Commit**

```bash
git add apps/lhr-office/src/trendsWatcher.ts apps/lhr-office/tests/trendsWatcher.test.ts apps/lhr-office/src/registry.ts apps/lhr-office/tests/registry.test.ts
git commit -m "Add weekly trends-sourcing job and register it"
```

---

### Task 8: `/status` page extensions — trends summary and seed-topic management

**Files:**
- Modify: `apps/lhr-office/src/statusPage.ts`
- Modify: `apps/lhr-office/tests/statusPage.test.ts`
- Modify: `apps/lhr-office/src/server.ts`
- Modify: `apps/lhr-office/tests/server.test.ts`

**Interfaces:**
- Consumes: `type TrendsReport`, `type TrendSeedTopic`, `TREND_CATEGORIES`, `getAllTopics`, `setTopicStatus`, `addCuratedTopic`, `listRecentReports` (`@lhr/db`, Tasks 4-5).
- Produces: `renderTrendsSection(reports)`, `renderTrendSeedTopicsSection(topics)` (`statusPage.ts`); `POST /status/trends/topics/:id/promote`, `POST /status/trends/topics/:id/demote`, `POST /status/trends/topics/add` (`server.ts`).

- [ ] **Step 1: Write the failing `statusPage.ts` tests**

Add to `apps/lhr-office/tests/statusPage.test.ts` (append; the file's existing imports/fixtures stay as they are):

```ts
import { renderTrendsSection, renderTrendSeedTopicsSection } from '../src/statusPage';
import type { TrendsReport, TrendSeedTopic } from '@lhr/db';

const trendsReport: TrendsReport = {
  id: 1,
  cycleId: '2026-09-06',
  category: 'cooking',
  generatedAt: new Date('2026-09-06T00:00:00Z'),
  topicsUsed: [{ topic: 'air fryer recipes', source: 'curated' }],
  rawFindings: { topics: [], trendingNow: [] },
  summary: 'Air fryer content is trending; you already cover it well.',
};

const seedTopic: TrendSeedTopic = {
  id: 1,
  category: 'cooking',
  topic: 'air fryer recipes',
  status: 'candidate',
  timesSeen: 2,
  firstSeenAt: new Date('2026-08-01T00:00:00Z'),
  lastSeenAt: new Date('2026-08-15T00:00:00Z'),
  promotedAt: null,
};

describe('renderTrendsSection', () => {
  it('renders the category, summary, and cycle date', () => {
    const html = renderTrendsSection([trendsReport]);
    expect(html).toContain('cooking');
    expect(html).toContain('Air fryer content is trending');
    expect(html).toContain('2026-09-06');
  });

  it('renders nothing when there are no reports', () => {
    expect(renderTrendsSection([])).toBe('');
  });

  it('escapes HTML in a summary', () => {
    const html = renderTrendsSection([{ ...trendsReport, summary: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderTrendSeedTopicsSection', () => {
  it('renders topic, category, status, times seen, and a Promote button for a candidate', () => {
    const html = renderTrendSeedTopicsSection([seedTopic]);
    expect(html).toContain('air fryer recipes');
    expect(html).toContain('cooking');
    expect(html).toContain('candidate');
    expect(html).toMatch(/action="\/status\/trends\/topics\/1\/promote"/);
  });

  it('renders a Demote button for a curated topic', () => {
    const html = renderTrendSeedTopicsSection([{ ...seedTopic, status: 'curated' }]);
    expect(html).toMatch(/action="\/status\/trends\/topics\/1\/demote"/);
  });

  it('always renders the add-curated-topic form, even with no topics yet', () => {
    const html = renderTrendSeedTopicsSection([]);
    expect(html).toMatch(/action="\/status\/trends\/topics\/add"/);
  });

  it('escapes HTML in a topic name', () => {
    const html = renderTrendSeedTopicsSection([{ ...seedTopic, topic: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/statusPage.test.ts
```

Expected: FAIL — `renderTrendsSection`/`renderTrendSeedTopicsSection` are not exported yet.

- [ ] **Step 3: Implement the two render functions**

In `apps/lhr-office/src/statusPage.ts`, add the import:

```ts
import type { TrendsReport, TrendSeedTopic, TrendCategory } from '@lhr/db';
import { TREND_CATEGORIES } from '@lhr/db';
```

Add these two functions (after `renderAffiliateCandidatesSection`, before `renderStatusPage`):

```ts
function renderTrendsReportRow(report: TrendsReport): string {
  return `
      <li>
        <p>${escapeHtml(report.cycleId)}: ${escapeHtml(report.summary)}</p>
      </li>`;
}

// One shared /status view of every category's trends reports, most recent first per category —
// the same "everything lives on this one Basic-Auth-gated page" posture as the candidate sections
// above.
export function renderTrendsSection(reports: TrendsReport[]): string {
  if (reports.length === 0) return '';
  const byCategory = new Map<TrendCategory, TrendsReport[]>();
  for (const category of TREND_CATEGORIES) byCategory.set(category, []);
  for (const report of reports) {
    byCategory.get(report.category)?.push(report);
  }
  const categoryBlocks = TREND_CATEGORIES.map((category) => {
    const categoryReports = byCategory.get(category) ?? [];
    if (categoryReports.length === 0) return '';
    return `
      <h3>${escapeHtml(category)}</h3>
      <ul>${categoryReports.map(renderTrendsReportRow).join('')}</ul>`;
  }).join('');
  return `
    <section>
      <h2>Trends</h2>
      ${categoryBlocks}
    </section>`;
}

function renderTrendSeedTopic(topic: TrendSeedTopic): string {
  const nextStatus = topic.status === 'curated' ? 'candidate' : 'curated';
  const label = topic.status === 'curated' ? 'Demote' : 'Promote';
  return `
      <li>
        <p>${escapeHtml(topic.category)} / ${escapeHtml(topic.topic)} — ${escapeHtml(topic.status)}, seen ${topic.timesSeen}×</p>
        <form method="post" action="/status/trends/topics/${topic.id}/${nextStatus === 'curated' ? 'promote' : 'demote'}" style="display:inline">
          <button type="submit">${label}</button>
        </form>
      </li>`;
}

// Manual override sits alongside the automatic promotion mechanism (trendSeedTopics.ts) rather
// than replacing it — the author can act immediately without waiting three cycles.
export function renderTrendSeedTopicsSection(topics: TrendSeedTopic[]): string {
  return `
    <section>
      <h2>Trend seed topics</h2>
      <ul>${topics.map(renderTrendSeedTopic).join('')}</ul>
      <form method="post" action="/status/trends/topics/add">
        <select name="category">
          ${TREND_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <input type="text" name="topic" placeholder="New curated topic" required />
        <button type="submit">Add curated topic</button>
      </form>
    </section>`;
}
```

Update `renderStatusPage`'s signature and body to accept and render both:

```ts
export function renderStatusPage(
  rows: JobStatusRow[],
  candidate: CandidateSummary | null = null,
  affiliateCandidates: Candidate[] = [],
  trendsReports: TrendsReport[] = [],
  trendSeedTopics: TrendSeedTopic[] = [],
): string {
```

and inside its returned template, add the two new sections after `renderAffiliateCandidatesSection(affiliateCandidates)`:

```ts
    ${renderAffiliateCandidatesSection(affiliateCandidates)}
    ${renderTrendsSection(trendsReports)}
    ${renderTrendSeedTopicsSection(trendSeedTopics)}
    ${sections || '<p>No jobs registered yet.</p>'}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run tests/statusPage.test.ts
```

Expected: PASS (all new cases, and the pre-existing `renderStatusPage`/`renderAffiliateCandidatesSection` cases unaffected — the two new parameters are optional with defaults, so every existing call site without them still works).

- [ ] **Step 5: Write the failing `server.ts` route tests**

Add to `apps/lhr-office/tests/server.test.ts` (append; extend the existing `vi.mock('@lhr/db', ...)` factory at the top of the file with the three new functions used below — `setTopicStatus`, `addCuratedTopic`, and `getAllTopics`/`listRecentReports` for the `/status` GET handler — alongside its existing `getRunHistory`/`getLatestPendingCycleId`/`getPendingCandidates`):

```ts
describe('trend seed topic routes', () => {
  it('promotes a topic and redirects to /status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/trends/topics/5/promote')
      .auth('test-user', 'test-password');
    expect(setTopicStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'curated');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/status');
  });

  it('demotes a topic and redirects to /status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/trends/topics/5/demote')
      .auth('test-user', 'test-password');
    expect(setTopicStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'candidate');
    expect(res.status).toBe(303);
  });

  it('adds a curated topic and redirects to /status', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/trends/topics/add')
      .auth('test-user', 'test-password')
      .send({ category: 'cooking', topic: 'sourdough' });
    expect(addCuratedTopicMock).toHaveBeenCalledWith(fakeDb, 'cooking', 'sourdough');
    expect(res.status).toBe(303);
  });

  it('rejects an unauthenticated promote request', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).post('/status/trends/topics/5/promote');
    expect(res.status).toBe(401);
    expect(setTopicStatusMock).not.toHaveBeenCalled();
  });

  it('returns 500 with an escaped error message when the DB call throws', async () => {
    setTopicStatusMock.mockRejectedValueOnce(new Error('<script>alert(1)</script>'));
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app)
      .post('/status/trends/topics/5/promote')
      .auth('test-user', 'test-password');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});
```

Add the corresponding mocks (`setTopicStatusMock`, `addCuratedTopicMock`, `getAllTopicsMock`, `listRecentReportsMock`) to the file's existing top-of-file `vi.mock('@lhr/db', ...)` block, alongside its current entries:

```ts
const setTopicStatusMock = vi.fn();
const addCuratedTopicMock = vi.fn();
const getAllTopicsMock = vi.fn();
const listRecentReportsMock = vi.fn();
vi.mock('@lhr/db', () => ({
  getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args),
  getLatestPendingCycleId: (...args: unknown[]) => getLatestPendingCycleIdMock(...args),
  getPendingCandidates: (...args: unknown[]) => getPendingCandidatesMock(...args),
  setTopicStatus: (...args: unknown[]) => setTopicStatusMock(...args),
  addCuratedTopic: (...args: unknown[]) => addCuratedTopicMock(...args),
  getAllTopics: (...args: unknown[]) => getAllTopicsMock(...args),
  listRecentReports: (...args: unknown[]) => listRecentReportsMock(...args),
}));
```

and default them to empty results in the existing `beforeEach`:

```ts
  getAllTopicsMock.mockResolvedValue([]);
  listRecentReportsMock.mockResolvedValue([]);
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
cd apps/lhr-office && npx vitest run tests/server.test.ts
```

Expected: FAIL — the three new routes don't exist yet (404s where the tests expect 303/401/500).

- [ ] **Step 7: Implement the three routes and extend the `/status` GET handler**

In `apps/lhr-office/src/server.ts`, add to the imports:

```ts
import { getRunHistory, getLatestPendingCycleId, getPendingCandidates, setTopicStatus, addCuratedTopic, getAllTopics, listRecentReports, TREND_CATEGORIES } from '@lhr/db';
```

(replacing the existing narrower `@lhr/db` import line with this extended one).

Update the `/status` GET handler's body to also fetch and pass trends data:

```ts
  app.get('/status', requireStatusAuth, async (_req, res) => {
    try {
      const rows = await Promise.all(
        registry.map(async (job) => ({
          name: job.name,
          cadenceDays: job.cadenceDays,
          history: await getRunHistory(db, job.name, 5),
        })),
      );
      const candidate = await candidates.getPending();
      const pendingAffiliateCandidates = await affiliateCandidates.getPending();
      const trendsReports = (
        await Promise.all(TREND_CATEGORIES.map((category) => listRecentReports(db, category)))
      ).flat();
      const trendSeedTopics = await getAllTopics(db);
      res.type('html').send(renderStatusPage(rows, candidate, pendingAffiliateCandidates, trendsReports, trendSeedTopics));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .type('html')
        .send(`<!doctype html><html><body><h1>Orchestrator status</h1><p>Error loading status: ${escapeHtml(message)}</p></body></html>`);
    }
  });
```

Add the three new routes after the existing `/status/affiliate-candidates/:id/deny` route:

```ts
  app.post('/status/trends/topics/:id/promote', requireStatusAuth, async (req, res) => {
    try {
      await setTopicStatus(db, Number(req.params.id), 'curated');
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to promote topic: ${escapeHtml(message)}`);
    }
  });

  app.post('/status/trends/topics/:id/demote', requireStatusAuth, async (req, res) => {
    try {
      await setTopicStatus(db, Number(req.params.id), 'candidate');
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to demote topic: ${escapeHtml(message)}`);
    }
  });

  app.post('/status/trends/topics/add', requireStatusAuth, express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await addCuratedTopic(db, req.body.category, req.body.topic);
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to add topic: ${escapeHtml(message)}`);
    }
  });
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd apps/lhr-office && npx vitest run
```

Expected: PASS (the whole `apps/lhr-office` suite, including all new cases from Tasks 6-8).

```bash
cd apps/lhr-office && npm run build
```

Expected: succeeds.

- [ ] **Step 9: Manual verification with real credentials**

```bash
cd apps/lhr-office && npm run dev
```

Visit `http://localhost:3001/status` (credentials logged by `dev.ts` on startup). Confirm: the "Trends" section shows any reports written by Task 7's manual run, grouped by category; the "Trend seed topics" section lists every row from `trend_seed_topics` with a Promote or Demote button and an add-topic form; clicking Promote/Demote reloads `/status` with the button now reading the opposite action; submitting the add-topic form adds a new `curated` row with `times_seen = 1`.

- [ ] **Step 10: Commit**

```bash
git add apps/lhr-office/src/statusPage.ts apps/lhr-office/tests/statusPage.test.ts apps/lhr-office/src/server.ts apps/lhr-office/tests/server.test.ts
git commit -m "Add trends and seed-topic sections to /status"
```
