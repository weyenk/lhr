import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function previewSecret(): string {
  const value = process.env.PREVIEW_TOKEN_SECRET;
  if (!value) throw new Error('PREVIEW_TOKEN_SECRET is not set');
  return value;
}

function computeToken(draftId: string, expiresAt: number): string {
  return createHmac('sha256', previewSecret()).update(`${draftId}.${expiresAt}`).digest('hex');
}

export function signPreviewToken(draftId: string, ttlMs = DEFAULT_TTL_MS): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ttlMs;
  return { token: computeToken(draftId, expiresAt), expiresAt };
}

export function verifyPreviewToken(draftId: string, expiresAt: number, token: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(computeToken(draftId, expiresAt), 'hex');
  const actual = Buffer.from(token, 'hex');
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
