import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { signUploadLink } from '../src/uploadLink';

// Unlike server.test.ts, this file does NOT mock ../src/blob (or storeImageBuffer),
// so the real content-type/size validation in storeImageBuffer runs against these
// requests. Only the R2 network call (via @aws-sdk/client-s3) is faked, following
// the pattern in tests/blob.test.ts.

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'test-author');
vi.stubEnv('GITHUB_CLIENT_ID', 'gh-client-id');
vi.stubEnv('GITHUB_CLIENT_SECRET', 'gh-client-secret');
vi.stubEnv('MCP_SERVER_URL', 'https://lhr-authoring.vercel.app');
vi.stubEnv('UPLOAD_LINK_SECRET', 'test-upload-secret');
vi.stubEnv('AUTHOR_GITHUB_TOKEN', 'test-author-token');
vi.stubEnv('R2_ACCOUNT_ID', 'test-account');
vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
vi.stubEnv('R2_BUCKET_NAME', 'test-bucket');
vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.example.com');

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

const mockSend = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

const { default: app } = await import('../src/server');

describe('POST /upload/:draftId/photo (real storeImageBuffer validation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('rejects a non-image content type with a 400 and an image-related error', async () => {
    const { token, expiresAt } = signUploadLink('abc1');

    const res = await request(app)
      .post(`/upload/abc1/photo?exp=${expiresAt}&token=${token}`)
      .set('Content-Type', 'text/html')
      .send(Buffer.from('<html></html>'));

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/image/);
    expect(mockSend).not.toHaveBeenCalled();
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });

  it('rejects a body larger than the 25MB cap with a 400', async () => {
    const { token, expiresAt } = signUploadLink('abc1');
    // Must stay under the route's express.raw({ limit: '26mb' }) ceiling
    // (27,262,976 bytes) but over storeImageBuffer's own 25MB cap
    // (26,214,400 bytes), so this exercises storeImageBuffer's validation
    // rather than body-parser's 413.
    const big = Buffer.alloc(Math.floor(25.5 * 1024 * 1024));

    const res = await request(app)
      .post(`/upload/abc1/photo?exp=${expiresAt}&token=${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(big);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/too large/);
    expect(mockSend).not.toHaveBeenCalled();
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });
});
