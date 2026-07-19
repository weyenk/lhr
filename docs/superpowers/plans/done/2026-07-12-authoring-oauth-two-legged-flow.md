# Authoring MCP Server: Two-Legged GitHub OAuth Implementation Plan

**Status:** Done — `mcp-server/src/auth/githubOAuth.ts` exists on `main` (later patched: "replace sunset Vercel KV with Blob-backed OAuth client store").

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authoring MCP server's transparent GitHub OAuth proxy (which cannot work — GitHub rejects both the mismatched client_id and the mismatched redirect_uri domain) with a real two-legged OAuth flow, so `docs/AUTHORING-SETUP.md` step 6 (connecting claude.ai to the server via GitHub login) actually succeeds end-to-end.

**Architecture:** The server becomes the actual OAuth authorization server for claude.ai (mints its own authorization codes and opaque access tokens against a fixed `/callback` URL), and separately performs a server-to-server exchange with GitHub in the background using the GitHub OAuth App's real Client ID/Secret, storing the resulting GitHub access token keyed by its own opaque token. `verifyAccessToken` re-verifies the stored GitHub token against `GET /user` on every call (so revoking GitHub access takes effect immediately) and hands the *real* GitHub token back as `AuthInfo.token`, since `src/server.ts` passes that value straight to Octokit for repo writes — tool code does not change.

**Tech Stack:** `@modelcontextprotocol/sdk`'s `OAuthServerProvider` interface (implemented directly, not via `ProxyOAuthServerProvider`), `@vercel/blob` for storage (reusing the existing pattern from `clientStore.ts`), Express, Vitest.

## Global Constraints

- Node/TS: existing `mcp-server/tsconfig.json` (`strict: true`, ESNext modules) — no relaxations.
- No new runtime dependencies — everything is buildable from `@modelcontextprotocol/sdk`, `@vercel/blob`, and `node:crypto`, already present.
- `requireBearerAuth` (from the SDK) throws `InvalidTokenError('Token has no expiration time')` unless `AuthInfo.expiresAt` is a **numeric seconds-since-epoch** value — every `verifyAccessToken` implementation in this plan must set it.
- Access tokens are opaque (`crypto.randomUUID()`), one-time authorization codes are opaque, PKCE validation is left to the SDK (`skipLocalPkceValidation` stays unset/false) via `challengeForAuthorizationCode`.
- No refresh-token support (GitHub OAuth Apps don't need it for this single-author tool) — `exchangeRefreshToken` throws, forcing re-authorization when the 8-hour access token expires.
- Follow existing test conventions: mock at the nearest module boundary (`vi.mock` for sibling modules), `vi.stubEnv` for env vars, no real network/blob calls in unit tests.

---

## File Structure

- `mcp-server/src/auth/blobStore.ts` (new) — generic `putJson`/`getJson`/`deleteJson` over `@vercel/blob`. Extracted so the three new OAuth-session stores don't reimplement the list/fetch dance already in `clientStore.ts`.
- `mcp-server/src/auth/clientStore.ts` (modify) — same public API, now built on `blobStore.ts`.
- `mcp-server/src/auth/oauthStore.ts` (new) — three tiny stores sharing the blob-JSON shape: pending downstream authorization requests, one-time issued codes, issued access tokens.
- `mcp-server/src/auth/githubOAuth.ts` (rewrite) — the two-legged `OAuthServerProvider` implementation.
- `mcp-server/src/server.ts` (modify) — fix `issuerUrl`, add the fixed `/callback` route GitHub redirects to.
- `docs/AUTHORING-SETUP.md` (rewrite) — accurate setup steps and an explanation of why the two-legged flow exists.
- Tests mirror each new/changed source file 1:1 under `mcp-server/tests/`.

---

### Task 1: Generic blob-backed JSON store

**Files:**
- Create: `mcp-server/src/auth/blobStore.ts`
- Test: `mcp-server/tests/auth/blobStore.test.ts`

**Interfaces:**
- Produces: `putJson<T>(path: string, value: T): Promise<void>`, `getJson<T>(path: string): Promise<T | null>`, `deleteJson(path: string): Promise<void>` — used by Task 2 and Task 3.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/auth/blobStore.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

const blobStore = new Map<string, string>();
const mockPut = vi.fn(async (pathname: string, body: string) => {
  blobStore.set(pathname, body);
  return { url: `https://example.public.blob.vercel-storage.com/${pathname}` };
});
const mockList = vi.fn(async ({ prefix }: { prefix: string }) => ({
  blobs: blobStore.has(prefix)
    ? [{ pathname: prefix, url: `https://example.public.blob.vercel-storage.com/${prefix}` }]
    : [],
}));
const mockDel = vi.fn(async (pathname: string) => {
  blobStore.delete(pathname);
});
vi.mock('@vercel/blob', () => ({
  put: (...args: [string, string]) => mockPut(...args),
  list: (...args: [{ prefix: string }]) => mockList(...args),
  del: (...args: [string]) => mockDel(...args),
}));

const { deleteJson, getJson, putJson } = await import('../../src/auth/blobStore');

const originalFetch = global.fetch;

beforeEach(() => {
  blobStore.clear();
  vi.clearAllMocks();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const pathname = url.replace('https://example.public.blob.vercel-storage.com/', '');
    const body = blobStore.get(pathname);
    return body
      ? ({ ok: true, json: async () => JSON.parse(body) } as Response)
      : ({ ok: false, status: 404 } as Response);
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('blobStore', () => {
  it('round-trips a value through Blob storage', async () => {
    await putJson('some/path.json', { hello: 'world' });
    expect(mockPut).toHaveBeenCalledWith(
      'some/path.json',
      JSON.stringify({ hello: 'world' }),
      expect.objectContaining({ access: 'public', addRandomSuffix: false }),
    );
    const loaded = await getJson('some/path.json');
    expect(loaded).toEqual({ hello: 'world' });
  });

  it('returns null for a missing path', async () => {
    const loaded = await getJson('missing/path.json');
    expect(loaded).toBeNull();
  });

  it('removes a value so it can no longer be loaded', async () => {
    await putJson('some/path.json', { hello: 'world' });
    await deleteJson('some/path.json');
    expect(mockDel).toHaveBeenCalledWith('some/path.json');
    const loaded = await getJson('some/path.json');
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mcp-server/`): `npx vitest run tests/auth/blobStore.test.ts`
Expected: FAIL — `src/auth/blobStore` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `mcp-server/src/auth/blobStore.ts`:

```ts
import { del, list, put } from '@vercel/blob';

export async function putJson<T>(path: string, value: T): Promise<void> {
  await put(path, JSON.stringify(value), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export async function getJson<T>(path: string): Promise<T | null> {
  const { blobs } = await list({ prefix: path });
  const match = blobs.find((blob) => blob.pathname === path);
  if (!match) {
    return null;
  }
  const response = await fetch(match.url);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

export async function deleteJson(path: string): Promise<void> {
  await del(path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth/blobStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/auth/blobStore.ts mcp-server/tests/auth/blobStore.test.ts
git commit -m "feat: add generic blob-backed JSON store for OAuth data"
```

---

### Task 2: Build clientStore on the shared blob JSON store

**Files:**
- Modify: `mcp-server/src/auth/clientStore.ts`
- Test: `mcp-server/tests/auth/clientStore.test.ts` (existing — verify unchanged behavior, no edits needed)

**Interfaces:**
- Consumes: `putJson`, `getJson` from Task 1 (`./blobStore`).
- Produces: unchanged public API — `saveClient(client: RegisteredClient): Promise<void>`, `loadClient(clientId: string): Promise<RegisteredClient | null>`. Task 4 consumes these.

- [ ] **Step 1: Confirm the existing test still describes the desired behavior**

Read `mcp-server/tests/auth/clientStore.test.ts` (already exists, mocks `@vercel/blob` directly). No changes needed — it mocks at the `@vercel/blob` boundary, and `blobStore.ts` still calls `@vercel/blob` under the hood, so the mock keeps working transitively through the refactor.

- [ ] **Step 2: Run the existing test to confirm current baseline passes**

Run: `npx vitest run tests/auth/clientStore.test.ts`
Expected: PASS (2 tests, against the current pre-refactor implementation).

- [ ] **Step 3: Refactor the implementation**

Replace the contents of `mcp-server/src/auth/clientStore.ts`:

```ts
import { getJson, putJson } from './blobStore';

export interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
}

function blobPath(clientId: string): string {
  return `oauth-clients/${clientId}.json`;
}

export async function saveClient(client: RegisteredClient): Promise<void> {
  await putJson(blobPath(client.client_id), client);
}

export async function loadClient(clientId: string): Promise<RegisteredClient | null> {
  return getJson<RegisteredClient>(blobPath(clientId));
}
```

- [ ] **Step 4: Run test to verify it still passes**

Run: `npx vitest run tests/auth/clientStore.test.ts`
Expected: PASS (2 tests, unchanged).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/auth/clientStore.ts
git commit -m "refactor: build clientStore on the shared blob JSON store"
```

---

### Task 3: OAuth session/code/token stores

**Files:**
- Create: `mcp-server/src/auth/oauthStore.ts`
- Test: `mcp-server/tests/auth/oauthStore.test.ts`

**Interfaces:**
- Consumes: `putJson`, `getJson`, `deleteJson` from Task 1 (`./blobStore`).
- Produces (consumed by Task 4's `githubOAuth.ts`):
  - `interface PendingAuthorization { clientId: string; redirectUri: string; codeChallenge: string; state?: string; createdAt: number }`
  - `savePendingAuthorization(sessionId: string, value: PendingAuthorization): Promise<void>`
  - `loadPendingAuthorization(sessionId: string): Promise<PendingAuthorization | null>`
  - `deletePendingAuthorization(sessionId: string): Promise<void>`
  - `interface IssuedCode { clientId: string; redirectUri: string; codeChallenge: string; githubAccessToken: string }`
  - `saveIssuedCode(code: string, value: IssuedCode): Promise<void>`
  - `loadIssuedCode(code: string): Promise<IssuedCode | null>`
  - `deleteIssuedCode(code: string): Promise<void>`
  - `interface IssuedToken { clientId: string; githubAccessToken: string; expiresAt: number }` (`expiresAt` is epoch **milliseconds** here; Task 4 converts to seconds for `AuthInfo`)
  - `saveIssuedToken(token: string, value: IssuedToken): Promise<void>`
  - `loadIssuedToken(token: string): Promise<IssuedToken | null>`

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/auth/oauthStore.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
const putJson = vi.fn(async (path: string, value: unknown) => {
  store.set(path, value);
});
const getJson = vi.fn(async (path: string) => store.get(path) ?? null);
const deleteJson = vi.fn(async (path: string) => {
  store.delete(path);
});
vi.mock('../../src/auth/blobStore', () => ({ putJson, getJson, deleteJson }));

const {
  savePendingAuthorization,
  loadPendingAuthorization,
  deletePendingAuthorization,
  saveIssuedCode,
  loadIssuedCode,
  deleteIssuedCode,
  saveIssuedToken,
  loadIssuedToken,
} = await import('../../src/auth/oauthStore');

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('oauthStore', () => {
  it('round-trips a pending authorization and deletes it', async () => {
    await savePendingAuthorization('session-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      state: 'state-1',
      createdAt: 1000,
    });
    expect(await loadPendingAuthorization('session-1')).toEqual({
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      state: 'state-1',
      createdAt: 1000,
    });
    await deletePendingAuthorization('session-1');
    expect(await loadPendingAuthorization('session-1')).toBeNull();
  });

  it('round-trips an issued code and deletes it', async () => {
    await saveIssuedCode('code-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      githubAccessToken: 'gh-token-1',
    });
    expect(await loadIssuedCode('code-1')).toMatchObject({ githubAccessToken: 'gh-token-1' });
    await deleteIssuedCode('code-1');
    expect(await loadIssuedCode('code-1')).toBeNull();
  });

  it('round-trips an issued token', async () => {
    await saveIssuedToken('token-1', {
      clientId: 'client-abc',
      githubAccessToken: 'gh-token-1',
      expiresAt: 123456,
    });
    expect(await loadIssuedToken('token-1')).toEqual({
      clientId: 'client-abc',
      githubAccessToken: 'gh-token-1',
      expiresAt: 123456,
    });
  });

  it('returns null for records that were never saved', async () => {
    expect(await loadPendingAuthorization('missing')).toBeNull();
    expect(await loadIssuedCode('missing')).toBeNull();
    expect(await loadIssuedToken('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/oauthStore.test.ts`
Expected: FAIL — `src/auth/oauthStore` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `mcp-server/src/auth/oauthStore.ts`:

```ts
import { deleteJson, getJson, putJson } from './blobStore';

export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  createdAt: number;
}

export interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  githubAccessToken: string;
}

export interface IssuedToken {
  clientId: string;
  githubAccessToken: string;
  expiresAt: number;
}

function pendingPath(sessionId: string): string {
  return `oauth-pending/${sessionId}.json`;
}

function codePath(code: string): string {
  return `oauth-codes/${code}.json`;
}

function tokenPath(token: string): string {
  return `oauth-tokens/${token}.json`;
}

export async function savePendingAuthorization(sessionId: string, value: PendingAuthorization): Promise<void> {
  await putJson(pendingPath(sessionId), value);
}

export async function loadPendingAuthorization(sessionId: string): Promise<PendingAuthorization | null> {
  return getJson<PendingAuthorization>(pendingPath(sessionId));
}

export async function deletePendingAuthorization(sessionId: string): Promise<void> {
  await deleteJson(pendingPath(sessionId));
}

export async function saveIssuedCode(code: string, value: IssuedCode): Promise<void> {
  await putJson(codePath(code), value);
}

export async function loadIssuedCode(code: string): Promise<IssuedCode | null> {
  return getJson<IssuedCode>(codePath(code));
}

export async function deleteIssuedCode(code: string): Promise<void> {
  await deleteJson(codePath(code));
}

export async function saveIssuedToken(token: string, value: IssuedToken): Promise<void> {
  await putJson(tokenPath(token), value);
}

export async function loadIssuedToken(token: string): Promise<IssuedToken | null> {
  return getJson<IssuedToken>(tokenPath(token));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth/oauthStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/auth/oauthStore.ts mcp-server/tests/auth/oauthStore.test.ts
git commit -m "feat: add blob-backed session/code/token stores for OAuth"
```

---

### Task 4: Two-legged GitHub OAuth provider

**Files:**
- Modify (rewrite): `mcp-server/src/auth/githubOAuth.ts`
- Modify (rewrite): `mcp-server/tests/auth/githubOAuth.test.ts`

**Interfaces:**
- Consumes: `loadClient`, `saveClient` (Task 2); `savePendingAuthorization`, `loadPendingAuthorization`, `deletePendingAuthorization`, `saveIssuedCode`, `loadIssuedCode`, `deleteIssuedCode`, `saveIssuedToken`, `loadIssuedToken` (Task 3).
- Produces: `createGitHubOAuthProvider(): GitHubOAuthServerProvider` where `GitHubOAuthServerProvider` implements the SDK's `OAuthServerProvider` interface **plus** `handleGitHubCallback(code: string, sessionId: string): Promise<{ redirectTo: string }>`. Task 5 (`server.ts`) calls both the standard interface (via `mcpAuthRouter`/`requireBearerAuth`) and `handleGitHubCallback` directly from the new `/callback` route.
- Required env vars (all throw a descriptive error at `createGitHubOAuthProvider()` call time if missing): `AUTHOR_GITHUB_USERNAME`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `MCP_SERVER_URL`.

- [ ] **Step 1: Write the failing test**

Replace the contents of `mcp-server/tests/auth/githubOAuth.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const clients = new Map<string, unknown>();
vi.mock('../../src/auth/clientStore', () => ({
  saveClient: vi.fn(async (client: { client_id: string }) => {
    clients.set(client.client_id, client);
  }),
  loadClient: vi.fn(async (clientId: string) => clients.get(clientId) ?? null),
}));

const pending = new Map<string, unknown>();
const codes = new Map<string, unknown>();
const tokens = new Map<string, unknown>();
vi.mock('../../src/auth/oauthStore', () => ({
  savePendingAuthorization: vi.fn(async (id: string, value: unknown) => {
    pending.set(id, value);
  }),
  loadPendingAuthorization: vi.fn(async (id: string) => pending.get(id) ?? null),
  deletePendingAuthorization: vi.fn(async (id: string) => {
    pending.delete(id);
  }),
  saveIssuedCode: vi.fn(async (code: string, value: unknown) => {
    codes.set(code, value);
  }),
  loadIssuedCode: vi.fn(async (code: string) => codes.get(code) ?? null),
  deleteIssuedCode: vi.fn(async (code: string) => {
    codes.delete(code);
  }),
  saveIssuedToken: vi.fn(async (token: string, value: unknown) => {
    tokens.set(token, value);
  }),
  loadIssuedToken: vi.fn(async (token: string) => tokens.get(token) ?? null),
}));

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'weyenk');
vi.stubEnv('GITHUB_CLIENT_ID', 'gh-client-id');
vi.stubEnv('GITHUB_CLIENT_SECRET', 'gh-client-secret');
vi.stubEnv('MCP_SERVER_URL', 'https://lhr-authoring.vercel.app');

const { createGitHubOAuthProvider } = await import('../../src/auth/githubOAuth');

const originalFetch = global.fetch;

function fakeResponse() {
  const res = { redirectedTo: undefined as string | undefined };
  return Object.assign(res, {
    redirect: (url: string) => {
      res.redirectedTo = url;
    },
  });
}

beforeEach(() => {
  clients.clear();
  pending.clear();
  codes.clear();
  tokens.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('createGitHubOAuthProvider', () => {
  it('throws if AUTHOR_GITHUB_USERNAME is unset', () => {
    vi.stubEnv('AUTHOR_GITHUB_USERNAME', '');
    expect(() => createGitHubOAuthProvider()).toThrow(/AUTHOR_GITHUB_USERNAME is not set/);
    vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'weyenk');
  });

  it('throws if GITHUB_CLIENT_ID is unset', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    expect(() => createGitHubOAuthProvider()).toThrow(/GITHUB_CLIENT_ID is not set/);
    vi.stubEnv('GITHUB_CLIENT_ID', 'gh-client-id');
  });

  it('throws if GITHUB_CLIENT_SECRET is unset', () => {
    vi.stubEnv('GITHUB_CLIENT_SECRET', '');
    expect(() => createGitHubOAuthProvider()).toThrow(/GITHUB_CLIENT_SECRET is not set/);
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'gh-client-secret');
  });

  it('throws if MCP_SERVER_URL is unset', () => {
    vi.stubEnv('MCP_SERVER_URL', '');
    expect(() => createGitHubOAuthProvider()).toThrow(/MCP_SERVER_URL is not set/);
    vi.stubEnv('MCP_SERVER_URL', 'https://lhr-authoring.vercel.app');
  });

  it('registers and remembers a dynamically-registered client', async () => {
    const provider = createGitHubOAuthProvider();
    expect(await provider.clientsStore.getClient('client-abc')).toBeUndefined();

    await provider.clientsStore.registerClient?.({
      client_id: 'client-abc',
      redirect_uris: ['https://claude.ai/api/mcp/callback'],
    });

    const stored = await provider.clientsStore.getClient('client-abc');
    expect(stored?.client_id).toBe('client-abc');
  });

  it('authorize() redirects to GitHub with the fixed server callback and stashes the downstream request', async () => {
    const provider = createGitHubOAuthProvider();
    const res = fakeResponse();

    await provider.authorize(
      { client_id: 'client-abc', redirect_uris: ['https://claude.ai/api/mcp/callback'] } as never,
      { codeChallenge: 'challenge-1', redirectUri: 'https://claude.ai/api/mcp/callback', state: 'downstream-state' },
      res as never,
    );

    expect(res.redirectedTo).toBeDefined();
    const redirectUrl = new URL(res.redirectedTo!);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(redirectUrl.searchParams.get('client_id')).toBe('gh-client-id');
    expect(redirectUrl.searchParams.get('redirect_uri')).toBe('https://lhr-authoring.vercel.app/callback');
    const sessionId = redirectUrl.searchParams.get('state');
    expect(sessionId).toBeTruthy();
    expect(pending.get(sessionId!)).toMatchObject({
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      state: 'downstream-state',
    });
  });

  it('handleGitHubCallback() exchanges the code, verifies the allowlisted author, and redirects to the downstream client with a fresh code', async () => {
    pending.set('session-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      state: 'downstream-state',
      createdAt: Date.now(),
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return { ok: true, json: async () => ({ access_token: 'gh-token-123' }) } as Response;
      }
      if (url === 'https://api.github.com/user') {
        return { ok: true, json: async () => ({ login: 'weyenk' }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    const { redirectTo } = await provider.handleGitHubCallback('gh-code-1', 'session-1');

    expect(pending.has('session-1')).toBe(false);
    const redirectUrl = new URL(redirectTo);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe('https://claude.ai/api/mcp/callback');
    expect(redirectUrl.searchParams.get('state')).toBe('downstream-state');
    const issuedCode = redirectUrl.searchParams.get('code');
    expect(codes.get(issuedCode!)).toMatchObject({ clientId: 'client-abc', githubAccessToken: 'gh-token-123' });
  });

  it('handleGitHubCallback() rejects an unknown session', async () => {
    const provider = createGitHubOAuthProvider();
    await expect(provider.handleGitHubCallback('gh-code-1', 'missing-session')).rejects.toThrow(
      /Unknown or expired authorization session/,
    );
  });

  it('handleGitHubCallback() rejects a non-allowlisted GitHub user', async () => {
    pending.set('session-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      createdAt: Date.now(),
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return { ok: true, json: async () => ({ access_token: 'gh-token-123' }) } as Response;
      }
      return { ok: true, json: async () => ({ login: 'someone-else' }) } as Response;
    }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    await expect(provider.handleGitHubCallback('gh-code-1', 'session-1')).rejects.toThrow(/not the authorized author/);
  });

  it('challengeForAuthorizationCode() returns the stored PKCE challenge for a matching client', async () => {
    codes.set('code-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      githubAccessToken: 'gh-token-123',
    });
    const provider = createGitHubOAuthProvider();
    const challenge = await provider.challengeForAuthorizationCode(
      { client_id: 'client-abc', redirect_uris: [] } as never,
      'code-1',
    );
    expect(challenge).toBe('challenge-1');
  });

  it('challengeForAuthorizationCode() rejects a code issued to a different client', async () => {
    codes.set('code-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      githubAccessToken: 'gh-token-123',
    });
    const provider = createGitHubOAuthProvider();
    await expect(
      provider.challengeForAuthorizationCode({ client_id: 'someone-else', redirect_uris: [] } as never, 'code-1'),
    ).rejects.toThrow(/Invalid authorization code/);
  });

  it('exchangeAuthorizationCode() mints a one-time-use opaque token mapped to the GitHub token', async () => {
    codes.set('code-1', {
      clientId: 'client-abc',
      redirectUri: 'https://claude.ai/api/mcp/callback',
      codeChallenge: 'challenge-1',
      githubAccessToken: 'gh-token-123',
    });
    const provider = createGitHubOAuthProvider();
    const result = await provider.exchangeAuthorizationCode(
      { client_id: 'client-abc', redirect_uris: [] } as never,
      'code-1',
    );

    expect(result.token_type).toBe('bearer');
    expect(codes.has('code-1')).toBe(false);
    expect(tokens.get(result.access_token)).toMatchObject({ clientId: 'client-abc', githubAccessToken: 'gh-token-123' });
  });

  it('exchangeRefreshToken() is not supported', async () => {
    const provider = createGitHubOAuthProvider();
    await expect(provider.exchangeRefreshToken({} as never, 'refresh-1')).rejects.toThrow(/not supported/);
  });

  it('verifyAccessToken() accepts a live token for the allowlisted author and returns the underlying GitHub token', async () => {
    tokens.set('opaque-1', {
      clientId: 'client-abc',
      githubAccessToken: 'gh-token-123',
      expiresAt: Date.now() + 1000 * 60,
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ login: 'weyenk' }) }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    const result = await provider.verifyAccessToken('opaque-1');
    expect(result.token).toBe('gh-token-123');
    expect(result.clientId).toBe('client-abc');
    expect(result.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('verifyAccessToken() rejects an unknown token', async () => {
    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('bogus')).rejects.toThrow(/Unknown access token/);
  });

  it('verifyAccessToken() rejects an expired token', async () => {
    tokens.set('opaque-1', { clientId: 'client-abc', githubAccessToken: 'gh-token-123', expiresAt: Date.now() - 1000 });
    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('opaque-1')).rejects.toThrow(/expired/);
  });

  it('verifyAccessToken() rejects a token whose GitHub user is no longer the allowlisted author', async () => {
    tokens.set('opaque-1', { clientId: 'client-abc', githubAccessToken: 'gh-token-123', expiresAt: Date.now() + 1000 * 60 });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ login: 'someone-else' }) }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('opaque-1')).rejects.toThrow(/not the authorized author/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth/githubOAuth.test.ts`
Expected: FAIL — old `githubOAuth.ts` doesn't expose `handleGitHubCallback`, `authorize` signature differs, etc. (multiple failures/type errors).

- [ ] **Step 3: Write the implementation**

Replace the contents of `mcp-server/src/auth/githubOAuth.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { loadClient, saveClient } from './clientStore';
import {
  deleteIssuedCode,
  deletePendingAuthorization,
  loadIssuedCode,
  loadIssuedToken,
  loadPendingAuthorization,
  saveIssuedCode,
  saveIssuedToken,
  savePendingAuthorization,
} from './oauthStore';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

async function fetchGitHubUser(githubAccessToken: string): Promise<{ login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${githubAccessToken}`, 'User-Agent': 'lhr-authoring-mcp-server' },
  });
  if (!res.ok) {
    throw new Error(`GitHub token verification failed: ${res.status}`);
  }
  return res.json();
}

/**
 * GitHub OAuth Apps have exactly one registered callback URL and require their
 * own fixed client_id/client_secret at the token endpoint — they cannot be
 * proxied transparently for a dynamically-registered downstream client (e.g.
 * claude.ai's DCR-issued client_id/redirect_uri): GitHub rejects both the
 * mismatched client_id and the mismatched redirect_uri domain. So this
 * provider runs a real two-legged flow: it is the actual OAuth authorization
 * server for downstream clients (minting its own codes and opaque access
 * tokens against the fixed `serverCallbackUrl`), and separately performs a
 * server-to-server exchange with GitHub in the background, storing the
 * resulting GitHub token keyed by its own opaque token.
 */
class GitHubOAuthServerProvider implements OAuthServerProvider {
  constructor(
    private readonly githubClientId: string,
    private readonly githubClientSecret: string,
    private readonly serverCallbackUrl: string,
    private readonly authorGitHubUsername: string,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => (await loadClient(clientId)) ?? undefined,
      registerClient: async (client) => {
        const providedClientId = (client as Partial<OAuthClientInformationFull>).client_id;
        const clientId = typeof providedClientId === 'string' ? providedClientId : randomUUID();
        const fullClient = { ...client, client_id: clientId };
        await saveClient(fullClient);
        return fullClient;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const sessionId = randomUUID();
    await savePendingAuthorization(sessionId, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      createdAt: Date.now(),
    });

    const target = new URL(GITHUB_AUTHORIZE_URL);
    target.searchParams.set('client_id', this.githubClientId);
    target.searchParams.set('redirect_uri', this.serverCallbackUrl);
    target.searchParams.set('scope', 'repo');
    target.searchParams.set('state', sessionId);
    res.redirect(target.toString());
  }

  /** Invoked by the fixed `/callback` route in server.ts, which GitHub redirects back to. */
  async handleGitHubCallback(code: string, sessionId: string): Promise<{ redirectTo: string }> {
    const pending = await loadPendingAuthorization(sessionId);
    if (!pending) {
      throw new Error('Unknown or expired authorization session');
    }
    await deletePendingAuthorization(sessionId);

    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.githubClientId,
        client_secret: this.githubClientSecret,
        code,
        redirect_uri: this.serverCallbackUrl,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      throw new Error(`GitHub token exchange failed: ${tokenData.error ?? 'no access_token in response'}`);
    }

    const user = await fetchGitHubUser(tokenData.access_token);
    if (user.login !== this.authorGitHubUsername) {
      throw new Error(`GitHub user ${user.login} is not the authorized author`);
    }

    const authorizationCode = randomUUID();
    await saveIssuedCode(authorizationCode, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      githubAccessToken: tokenData.access_token,
    });

    const redirectTo = new URL(pending.redirectUri);
    redirectTo.searchParams.set('code', authorizationCode);
    if (pending.state) {
      redirectTo.searchParams.set('state', pending.state);
    }
    return { redirectTo: redirectTo.toString() };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const issued = await loadIssuedCode(authorizationCode);
    if (!issued || issued.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    return issued.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const issued = await loadIssuedCode(authorizationCode);
    if (!issued || issued.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    await deleteIssuedCode(authorizationCode);

    const accessToken = randomUUID();
    await saveIssuedToken(accessToken, {
      clientId: client.client_id,
      githubAccessToken: issued.githubAccessToken,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    });

    return { access_token: accessToken, token_type: 'bearer', scope: 'repo' };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error('Refresh tokens are not supported; re-run the authorization flow to get a new access token.');
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const issued = await loadIssuedToken(token);
    if (!issued) {
      throw new Error('Unknown access token');
    }
    if (issued.expiresAt < Date.now()) {
      throw new Error('Access token has expired');
    }
    const user = await fetchGitHubUser(issued.githubAccessToken);
    if (user.login !== this.authorGitHubUsername) {
      throw new Error(`GitHub user ${user.login} is not the authorized author`);
    }
    return {
      token: issued.githubAccessToken,
      clientId: issued.clientId,
      scopes: ['repo'],
      expiresAt: Math.floor(issued.expiresAt / 1000),
    };
  }
}

export function createGitHubOAuthProvider(): GitHubOAuthServerProvider {
  const authorGitHubUsername = process.env.AUTHOR_GITHUB_USERNAME;
  if (!authorGitHubUsername) {
    throw new Error(
      'AUTHOR_GITHUB_USERNAME is not set — the server cannot verify who is authorized to authenticate. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  if (!githubClientId) {
    throw new Error(
      'GITHUB_CLIENT_ID is not set — required to complete the GitHub OAuth handshake. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!githubClientSecret) {
    throw new Error(
      'GITHUB_CLIENT_SECRET is not set — required to complete the GitHub OAuth handshake. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const mcpServerUrl = process.env.MCP_SERVER_URL;
  if (!mcpServerUrl) {
    throw new Error(
      'MCP_SERVER_URL is not set — required to build the fixed GitHub OAuth callback URL. Set it in the deployment environment (see docs/AUTHORING-SETUP.md).',
    );
  }
  const serverCallbackUrl = new URL('/callback', mcpServerUrl).toString();

  return new GitHubOAuthServerProvider(githubClientId, githubClientSecret, serverCallbackUrl, authorGitHubUsername);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth/githubOAuth.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Type-check**

Run (from `mcp-server/`): `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/auth/githubOAuth.ts mcp-server/tests/auth/githubOAuth.test.ts
git commit -m "fix: replace transparent GitHub OAuth proxy with a real two-legged flow"
```

---

### Task 5: Wire the `/callback` route into the MCP server

**Files:**
- Modify: `mcp-server/src/server.ts:18-23` (the `mcpAuthRouter` block)
- Modify: `mcp-server/tests/server.test.ts`

**Interfaces:**
- Consumes: `createGitHubOAuthProvider()` and `.handleGitHubCallback(code, state)` from Task 4.

- [ ] **Step 1: Write the failing test**

Replace the contents of `mcp-server/tests/server.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'test-author');
vi.stubEnv('GITHUB_CLIENT_ID', 'gh-client-id');
vi.stubEnv('GITHUB_CLIENT_SECRET', 'gh-client-secret');
vi.stubEnv('MCP_SERVER_URL', 'https://lhr-authoring.vercel.app');

vi.mock('../src/auth/oauthStore', () => ({
  savePendingAuthorization: vi.fn(),
  loadPendingAuthorization: vi.fn(async () => null),
  deletePendingAuthorization: vi.fn(),
  saveIssuedCode: vi.fn(),
  loadIssuedCode: vi.fn(async () => null),
  deleteIssuedCode: vi.fn(),
  saveIssuedToken: vi.fn(),
  loadIssuedToken: vi.fn(async () => null),
}));
vi.mock('../src/auth/clientStore', () => ({
  saveClient: vi.fn(),
  loadClient: vi.fn(async () => null),
}));

const { default: app } = await import('../src/server');

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /callback', () => {
  it('rejects a callback missing code or state', async () => {
    const res = await request(app).get('/callback');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Missing code or state/);
  });

  it('surfaces a GitHub-reported error directly', async () => {
    const res = await request(app).get('/callback').query({ error: 'access_denied' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/access_denied/);
  });

  it('returns 400 for an unknown session state', async () => {
    const res = await request(app).get('/callback').query({ code: 'gh-code', state: 'unknown-session' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Unknown or expired authorization session/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL — no `/callback` route exists yet (404s), and `mcpAuthRouter`'s `issuerUrl` still points at GitHub.

- [ ] **Step 3: Implement the route**

In `mcp-server/src/server.ts`, replace lines 18-23:

```ts
const provider = createGitHubOAuthProvider();

if (process.env.MCP_SERVER_URL) {
  const baseUrl = new URL(process.env.MCP_SERVER_URL);
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL('https://github.com/login/oauth/'), baseUrl }));
}
```

with:

```ts
const provider = createGitHubOAuthProvider();

if (process.env.MCP_SERVER_URL) {
  const baseUrl = new URL(process.env.MCP_SERVER_URL);
  app.use(mcpAuthRouter({ provider, issuerUrl: baseUrl, baseUrl }));
}

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (typeof error === 'string') {
    res.status(400).send(`GitHub authorization failed: ${error}`);
    return;
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).send('Missing code or state from GitHub callback');
    return;
  }
  try {
    const { redirectTo } = await provider.handleGitHubCallback(code, state);
    res.redirect(redirectTo);
  } catch (err) {
    res.status(400).send(err instanceof Error ? err.message : 'GitHub authorization failed');
  }
});
```

(`issuerUrl` changes from GitHub's URL to our own `baseUrl` because the server is now the real authorization server issuing its own codes/tokens, not a transparent proxy to GitHub.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full mcp-server test suite**

Run (from `mcp-server/`): `npm test`
Expected: all test files PASS.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/server.ts mcp-server/tests/server.test.ts
git commit -m "fix: wire the GitHub OAuth callback route into the MCP server"
```

---

### Task 6: Rewrite the setup doc

**Files:**
- Modify: `docs/AUTHORING-SETUP.md`
- Test: `mcp-server/tests/docs/authoringSetup.test.ts` (existing — do not edit; the rewrite must keep it passing)

**Interfaces:** None (docs only).

- [ ] **Step 1: Confirm the existing doc test's required substrings**

Read `mcp-server/tests/docs/authoringSetup.test.ts` — it asserts the doc contains: `'GitHub OAuth App'`, `'AUTHOR_GITHUB_USERNAME'`, `'Vercel Blob'`, `'custom MCP connector'`, `'Claude.ai Project'`. The rewrite in Step 2 must keep all five.

- [ ] **Step 2: Rewrite the doc**

Replace the contents of `docs/AUTHORING-SETUP.md`:

```markdown
# Authoring MCP Server Setup

Manual, one-time setup for the authoring MCP server (outside this repo's automated tasks).

## How auth works

Claude.ai (the downstream OAuth client) and GitHub (the upstream identity provider) can't be bridged with a transparent proxy: GitHub OAuth Apps have exactly one registered callback URL and require their own fixed Client ID/Secret at the token endpoint, but claude.ai registers itself dynamically with its own client_id and redirect_uri. So `mcp-server/src/auth/githubOAuth.ts` runs a real two-legged flow:

1. **Downstream leg** — the server is claude.ai's actual OAuth authorization server. It mints its own authorization codes and opaque access tokens against a fixed callback URL (`/callback`) that never changes.
2. **Upstream leg** — separately, server-to-server, the server exchanges a GitHub authorization code for a GitHub access token using the GitHub OAuth App's real Client ID/Secret, verifies the resulting user is the allowlisted author, and stores the GitHub token keyed by its own opaque token so tools can call the GitHub API with it.

## Setup steps

1. **Register a GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App) for the MCP server. Set its callback URL to `https://<your-mcp-server-domain>/callback`. Note the generated **Client ID** and **Client Secret** — both are required (see "How auth works" above).
2. **Create a new Vercel project** for `mcp-server/` (import this repo, set the project's root directory to `mcp-server/`).
3. **Provision Vercel Blob** for the project (if not already shared with the main site project) and note its read/write token. `mcp-server/src/auth/clientStore.ts` and `mcp-server/src/auth/oauthStore.ts` store OAuth client registrations, in-flight authorization sessions, and issued tokens as JSON blobs in this same store, so no separate database is needed.
4. **Set project environment variables** on the new Vercel project:
   - `AUTHOR_GITHUB_USERNAME` — the author's GitHub username (the single allowlisted author).
   - `MCP_SERVER_URL` — the deployed project's URL (e.g. `https://lhr-authoring.vercel.app`). Also used to build the fixed `/callback` URL from step 1.
   - `GITHUB_CLIENT_ID` — the GitHub OAuth App's Client ID from step 1.
   - `GITHUB_CLIENT_SECRET` — the GitHub OAuth App's Client Secret from step 1.
   - `BLOB_READ_WRITE_TOKEN` — from step 3.
5. **Deploy** the `mcp-server/` project.
6. In the **Claude.ai app**, add a **custom MCP connector** pointing at the deployed project's `/mcp` URL, and complete the GitHub OAuth login when prompted — logging in as the same GitHub account named in `AUTHOR_GITHUB_USERNAME`. A login from any other GitHub account will be rejected by the server's allowlist check.
7. Create a **Claude.ai Project**, attach the connector, and paste in the scripted authoring-flow instructions (pick post type → title → content → photos → kitchenware → affiliate links → preview → confirm).

**Note on step 3's Blob-backed stores:** they write with `access: 'public'` (Vercel Blob's only read-via-URL access mode), at paths derived from an internal id (`oauth-clients/<client_id>.json`, `oauth-pending/<session_id>.json`, `oauth-codes/<code>.json`, `oauth-tokens/<token>.json`) with `addRandomSuffix: false` so records can be found again deterministically. This means anyone who can guess or obtain one of these ids can fetch its stored contents — for `oauth-tokens/`, that's a live GitHub access token. IDs are `crypto.randomUUID()` values (not guessable), and issued access tokens expire after 8 hours with no refresh support, but treat this as a low-security-margin pattern worth revisiting before storing anything more sensitive here.

**Resolved — step 2's project root and the shared schemas:** the first real deploy confirmed the risk flagged here previously: `confirmAndPublish.ts`'s original `../../../src/content/schemas` import (reaching outside `mcp-server/`) broke the build, not just the runtime bundle. It widened TypeScript's inferred `rootDir` to the repo root, which shifted the compiled output down an extra directory level and made Vercel's entrypoint search (`app.js`/`index.js`/`server.js`/`src/...`) come up empty. The fix: the schemas now live in `packages/schemas` (an `@lhr/schemas` npm workspace package), depended on normally by both the site and `mcp-server/`; `src/content/schemas.ts` is now a one-line re-export so the site's own imports were untouched. `mcp-server/package.json`'s `build` script builds `@lhr/schemas` first.

**Update — explicit bundling replaces relying on Vercel's entrypoint search:** rather than continuing to depend on Vercel auto-discovering a compiled entrypoint under `dist/`, `mcp-server/package.json`'s `build` script now runs `tsc --noEmit` for type-checking only and then `node scripts/bundle.mjs`, which uses esbuild to bundle `api/index.ts` and `src/server.ts` (dependencies left external, i.e. resolved from `node_modules` at runtime) directly into `dist/api/index.js` and `dist/src/server.js`. `vercel.json` rewrites all requests to `/api`, which Vercel's zero-config Node function detection picks up from `api/index.ts` — the explicit bundle output gives that a known, single-file artifact to run instead of depending on tsc's mirrored directory layout.
```

- [ ] **Step 3: Run the doc test to verify it still passes**

Run (from `mcp-server/`): `npx vitest run tests/docs/authoringSetup.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/AUTHORING-SETUP.md
git commit -m "docs: rewrite AUTHORING-SETUP.md for the two-legged OAuth flow"
```

---

## Final Verification

- [ ] Run the full suite once more from `mcp-server/`: `npm test`
- [ ] Run `npx tsc --noEmit -p tsconfig.json` from `mcp-server/`
- [ ] Run `npm run build --workspace=mcp-server` from the repo root to confirm the esbuild bundle step still succeeds with the new files
