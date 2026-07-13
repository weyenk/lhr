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
