import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const kvStore = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      kvStore.set(key, value);
    }),
  },
}));

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'weyenk');

const { createGitHubOAuthProvider } = await import('../../src/auth/githubOAuth');

const originalFetch = global.fetch;

beforeEach(() => {
  kvStore.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('createGitHubOAuthProvider', () => {
  it('proxies to GitHub OAuth endpoints', () => {
    const provider = createGitHubOAuthProvider();
    expect(provider).toBeDefined();
  });

  it('throws immediately if AUTHOR_GITHUB_USERNAME is unset', () => {
    vi.stubEnv('AUTHOR_GITHUB_USERNAME', '');
    expect(() => createGitHubOAuthProvider()).toThrow(/AUTHOR_GITHUB_USERNAME is not set/);
    vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'weyenk');
  });

  it('accepts a token belonging to the allowlisted author', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'weyenk' }),
    }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    const result = await provider.verifyAccessToken('gh-token-123');
    expect(result.clientId).toBe('lhr-authoring');
    expect(result.token).toBe('gh-token-123');
  });

  it('rejects a token belonging to a different GitHub user', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'someone-else' }),
    }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('gh-token-456')).rejects.toThrow(/not the authorized author/);
  });

  it('rejects an invalid token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('bad-token')).rejects.toThrow(/401/);
  });

  it('registers and remembers a dynamically-registered client', async () => {
    const provider = createGitHubOAuthProvider();
    const first = await provider.clientsStore.getClient('client-abc');
    expect(first).toBeUndefined();

    await provider.clientsStore.registerClient?.({
      client_id: 'client-abc',
      redirect_uris: ['https://claude.ai/api/mcp/callback'],
    });

    const second = await provider.clientsStore.getClient('client-abc');
    expect(second?.client_id).toBe('client-abc');
  });
});
