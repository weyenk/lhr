import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireSupabaseAuth } from '../src/authMiddleware';

const originalEnv = { ...process.env };

function buildApp() {
  const app = express();
  app.get('/protected', requireSupabaseAuth, (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
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

  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'wrong-secret', { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'HS256', expiresIn: -10 });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects every request when SUPABASE_JWT_SECRET is unset, even with a well-formed token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'HS256' });
    delete process.env.SUPABASE_JWT_SECRET;
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('calls next() and allows the request through for a valid token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
