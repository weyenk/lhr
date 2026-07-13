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

describe('POST /register', () => {
  it('succeeds when the request carries Vercel-style forwarded headers', async () => {
    // Vercel's edge always adds these on every request. Without `trust proxy`
    // set on the app, express-rate-limit throws on them instead of just
    // warning, and every /register (and /authorize) call 500s.
    const res = await request(app)
      .post('/register')
      .set('X-Forwarded-For', '203.0.113.1')
      .set('Forwarded', 'for=203.0.113.1')
      .send({ redirect_uris: ['https://client.example/callback'] });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeTruthy();
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
