import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import type { Queryable } from '@lhr/db';
import type { DraftPost } from '@lhr/schemas';

const insertPostDraftMock = vi.fn();
const listPostDraftsByAuthorMock = vi.fn();
const getPostDraftForAuthorMock = vi.fn();
const updatePostDraftMock = vi.fn();
const upsertPostMock = vi.fn();
const getPostByIdMock = vi.fn();
const getPostBySlugMock = vi.fn();

vi.mock('@lhr/db', () => ({
  insertPostDraft: (...args: unknown[]) => insertPostDraftMock(...args),
  listPostDraftsByAuthor: (...args: unknown[]) => listPostDraftsByAuthorMock(...args),
  getPostDraftForAuthor: (...args: unknown[]) => getPostDraftForAuthorMock(...args),
  updatePostDraft: (...args: unknown[]) => updatePostDraftMock(...args),
  upsertPost: (...args: unknown[]) => upsertPostMock(...args),
  getPostById: (...args: unknown[]) => getPostByIdMock(...args),
  getPostBySlug: (...args: unknown[]) => getPostBySlugMock(...args),
}));

const storeImageBufferMock = vi.fn();
vi.mock('lhr-authoring-mcp-server/dist-lib/blob.js', () => ({
  storeImageBuffer: (...args: unknown[]) => storeImageBufferMock(...args),
}));

const revalidatePublishedPostMock = vi.fn();
vi.mock('../../src/revalidate.js', () => ({
  revalidatePublishedPost: (...args: unknown[]) => revalidatePublishedPostMock(...args),
}));

const { requireSupabaseAuth } = await import('../../src/authMiddleware');
const { createAuthoringRouter } = await import('../../src/routes/authoring');

const originalEnv = { ...process.env };
const JWKS_KID = 'test-kid';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const publicJwk = { ...(await exportJWK(publicKey)), kid: JWKS_KID, alg: 'ES256', use: 'sig' };

const fakeDb = {} as Queryable;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/authoring', requireSupabaseAuth, createAuthoringRouter(fakeDb));
  return app;
}

async function authHeader(sub = 'author-1') {
  const token = await new SignJWT({ sub, role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: JWKS_KID })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  return `Bearer ${token}`;
}

const baseDraft: DraftPost = {
  kind: 'post',
  postType: 'recipe',
  title: 'Weeknight Pasta',
  ingredients: [{ item: 'pasta' }],
  steps: ['Boil'],
  sections: [],
  photos: [{ url: 'https://cdn.example.com/posts/pasta.jpg', caption: 'A bowl of pasta' }],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
  pendingIngredientLinks: [],
  variants: [],
};

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.PREVIEW_TOKEN_SECRET = 'preview-secret';
  process.env.SITE_BASE_URL = 'https://loveheatrelationship.com';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url) === 'https://test.supabase.co/auth/v1/.well-known/jwks.json') {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 200 });
    }),
  );
  vi.clearAllMocks();
  getPostBySlugMock.mockResolvedValue(null);
  revalidatePublishedPostMock.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('authoring publish flow', () => {
  it('create→patch→publish returns slug and url', async () => {
    insertPostDraftMock.mockResolvedValue({
      id: 'draft-1',
      postId: null,
      authorSub: 'author-1',
      type: 'recipe',
      draft: { ...baseDraft, title: 'Weeknight Pasta', ingredients: [], steps: [], photos: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    getPostDraftForAuthorMock
      .mockResolvedValueOnce({
        id: 'draft-1',
        postId: null,
        authorSub: 'author-1',
        type: 'recipe',
        draft: { ...baseDraft, ingredients: [], steps: [], photos: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'draft-1',
        postId: null,
        authorSub: 'author-1',
        type: 'recipe',
        draft: baseDraft,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    updatePostDraftMock.mockImplementation(async (_db, id, authorSub, updates) => ({
      id,
      postId: null,
      authorSub,
      type: 'recipe',
      draft: updates.draft,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    upsertPostMock.mockResolvedValue({
      id: 'post-1',
      slug: 'weeknight-pasta',
      type: 'recipe',
      title: 'Weeknight Pasta',
      data: {},
      bodyHtml: null,
      status: 'published',
      publishedAt: new Date(),
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const app = buildApp();
    const authorization = await authHeader();

    const created = await request(app)
      .post('/api/authoring/drafts')
      .set('Authorization', authorization)
      .send({ type: 'recipe', title: 'Weeknight Pasta' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ draftId: 'draft-1' });

    const patched = await request(app)
      .patch('/api/authoring/drafts/draft-1')
      .set('Authorization', authorization)
      .send({
        ingredients: baseDraft.ingredients,
        steps: baseDraft.steps,
        photos: baseDraft.photos,
      });
    expect(patched.status).toBe(200);

    const published = await request(app)
      .post('/api/authoring/drafts/draft-1/publish')
      .set('Authorization', authorization);
    expect(published.status).toBe(200);
    expect(published.body).toEqual({
      slug: 'weeknight-pasta',
      url: 'https://loveheatrelationship.com/posts/weeknight-pasta/',
    });
    expect(revalidatePublishedPostMock).toHaveBeenCalledWith('weeknight-pasta');
    expect(upsertPostMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ status: 'published', slug: 'weeknight-pasta' }),
    );
  });

  it('returns 422 with field errors when publish validation fails', async () => {
    getPostDraftForAuthorMock.mockResolvedValue({
      id: 'draft-2',
      postId: null,
      authorSub: 'author-1',
      type: 'recipe',
      draft: {
        ...baseDraft,
        ingredients: [],
        steps: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/authoring/drafts/draft-2/publish')
      .set('Authorization', await authHeader());

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('validation_failed');
    expect(res.body.fieldErrors).toBeDefined();
    expect(Object.keys(res.body.fieldErrors).length).toBeGreaterThan(0);
    expect(upsertPostMock).not.toHaveBeenCalled();
  });
});

describe('authoring preview token', () => {
  it('returns a signed preview token for an owned draft', async () => {
    getPostDraftForAuthorMock.mockResolvedValue({
      id: 'draft-3',
      postId: null,
      authorSub: 'author-1',
      type: 'recipe',
      draft: baseDraft,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/authoring/drafts/draft-3/preview-token')
      .set('Authorization', await authHeader());

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[a-f0-9]+$/);
    expect(typeof res.body.expiresAt).toBe('number');
  });
});
