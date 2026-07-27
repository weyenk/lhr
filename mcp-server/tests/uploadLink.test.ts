import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

const { signUploadLink, verifyUploadLink } = await import('../src/uploadLink');

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.UPLOAD_LINK_SECRET = 'test-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('signUploadLink / verifyUploadLink', () => {
  it('produces a token that verifies for the same draftId and expiry', () => {
    const { token, expiresAt } = signUploadLink('draft123');
    expect(verifyUploadLink('draft123', expiresAt, token)).toBe(true);
  });

  it('defaults to a 1 hour expiry', () => {
    const before = Date.now();
    const { expiresAt } = signUploadLink('draft123');
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + 3_600_000 + 1000);
  });

  it('rejects a tampered token', () => {
    const { expiresAt } = signUploadLink('draft123');
    expect(verifyUploadLink('draft123', expiresAt, 'deadbeef')).toBe(false);
  });

  it('rejects an expired link', () => {
    const { token } = signUploadLink('draft123', -1000);
    expect(verifyUploadLink('draft123', Date.now() - 1000, token)).toBe(false);
  });

  it('rejects a token signed for a different draftId', () => {
    const { token, expiresAt } = signUploadLink('draft123');
    expect(verifyUploadLink('other-draft', expiresAt, token)).toBe(false);
  });

  it('rejects a non-hex token without throwing', () => {
    const { expiresAt } = signUploadLink('draft123');
    expect(verifyUploadLink('draft123', expiresAt, 'not-hex!!')).toBe(false);
  });
});
