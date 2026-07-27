import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signUploadLink } from '../src/uploadLink';

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'test-author');
vi.stubEnv('GITHUB_CLIENT_ID', 'gh-client-id');
vi.stubEnv('GITHUB_CLIENT_SECRET', 'gh-client-secret');
vi.stubEnv('MCP_SERVER_URL', 'https://lhr-authoring.vercel.app');
vi.stubEnv('UPLOAD_LINK_SECRET', 'test-upload-secret');
vi.stubEnv('AUTHOR_GITHUB_TOKEN', 'test-author-token');

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

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../src/drafts')>('../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const mockStoreImageBuffer = vi.fn();
vi.mock('../src/blob', async () => {
  const actual = await vi.importActual<typeof import('../src/blob')>('../src/blob');
  return { ...actual, storeImageBuffer: (...args: unknown[]) => mockStoreImageBuffer(...args) };
});

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

const baseDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
};

describe('GET /upload/:draftId', () => {
  it('serves the upload page for a valid link', async () => {
    const { token, expiresAt } = signUploadLink('abc1');
    const res = await request(app).get(`/upload/abc1?exp=${expiresAt}&token=${token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('type="file"');
  });

  it('rejects an expired or tampered link', async () => {
    const res = await request(app).get('/upload/abc1?exp=123&token=deadbeef');
    expect(res.status).toBe(403);
  });
});

describe('POST /upload/:draftId/photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores the photo and appends it to the draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    draftsMock.writeDraft.mockResolvedValue(undefined);
    mockStoreImageBuffer.mockResolvedValue('https://cdn.example.com/posts/new.jpeg');
    const { token, expiresAt } = signUploadLink('abc1');

    const res = await request(app)
      .post(`/upload/abc1/photo?exp=${expiresAt}&token=${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([1, 2, 3]));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, url: 'https://cdn.example.com/posts/new.jpeg' });
    expect(mockStoreImageBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ photos: [{ url: 'https://cdn.example.com/posts/new.jpeg' }] }),
      expect.any(String),
    );
  });

  it('rejects an expired or tampered link without touching R2 or the draft', async () => {
    const res = await request(app)
      .post('/upload/abc1/photo?exp=123&token=deadbeef')
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([1, 2, 3]));

    expect(res.status).toBe(403);
    expect(mockStoreImageBuffer).not.toHaveBeenCalled();
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });

  it('reports a storage failure without writing the draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    mockStoreImageBuffer.mockRejectedValue(new Error('Photo is too large (30000000 bytes, max 26214400)'));
    const { token, expiresAt } = signUploadLink('abc1');

    const res = await request(app)
      .post(`/upload/abc1/photo?exp=${expiresAt}&token=${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([1, 2, 3]));

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/too large/);
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });
});
