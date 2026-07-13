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
