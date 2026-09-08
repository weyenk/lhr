import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { requireSupabaseAuth } from '../src/authMiddleware';

const originalEnv = { ...process.env };
const JWKS_KID = 'test-kid';

// Supabase's session tokens are signed with ES256 (asymmetric JWT signing keys), verified here
// via the project's JWKS endpoint rather than a shared secret. These tests generate a real key
// pair and stub global fetch to serve it at that endpoint, exactly as jose's createRemoteJWKSet
// would fetch it from Supabase in production.
const { publicKey, privateKey } = await generateKeyPair('ES256');
const publicJwk = { ...(await exportJWK(publicKey)), kid: JWKS_KID, alg: 'ES256', use: 'sig' };
const { privateKey: wrongPrivateKey } = await generateKeyPair('ES256');

function buildApp() {
  const app = express();
  app.get('/protected', requireSupabaseAuth, (_req, res) => res.json({ ok: true }));
  return app;
}

function signToken(
  payload: Record<string, unknown>,
  { key = privateKey, kid = JWKS_KID, expiresIn = '1h' }: { key?: typeof privateKey; kid?: string; expiresIn?: string } = {},
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url) === 'https://test.supabase.co/auth/v1/.well-known/jwks.json') {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch to ${String(url)}`);
    }),
  );
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('requireSupabaseAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with a key not published at the JWKS endpoint', async () => {
    const token = await signToken({ sub: 'user-1', role: 'authenticated' }, { key: wrongPrivateKey });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ sub: 'user-1', role: 'authenticated' }, { expiresIn: '-10s' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects every request when SUPABASE_URL is unset, even with a well-formed token', async () => {
    const token = await signToken({ sub: 'user-1', role: 'authenticated' });
    delete process.env.SUPABASE_URL;
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects a validly-signed token with role "anon" (Supabase public anon key)', async () => {
    const token = await signToken({ role: 'anon', iss: 'supabase' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a token with role "authenticated" but no sub claim', async () => {
    const token = await signToken({ role: 'authenticated' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('calls next() and allows the request through for a valid token', async () => {
    const token = await signToken({ sub: 'user-1', role: 'authenticated' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
