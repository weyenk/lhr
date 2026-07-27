import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireEnv } from './blob.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function computeToken(draftId: string, expiresAt: number): string {
  return createHmac('sha256', requireEnv('UPLOAD_LINK_SECRET')).update(`${draftId}.${expiresAt}`).digest('hex');
}

export function signUploadLink(draftId: string, ttlMs = DEFAULT_TTL_MS): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ttlMs;
  return { token: computeToken(draftId, expiresAt), expiresAt };
}

export function verifyUploadLink(draftId: string, expiresAt: number, token: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(computeToken(draftId, expiresAt), 'hex');
  const actual = Buffer.from(token, 'hex');
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
