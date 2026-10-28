import { createHmac, timingSafeEqual } from 'node:crypto';

function previewSecret(): string {
  const value = process.env.PREVIEW_TOKEN_SECRET;
  if (!value) throw new Error('PREVIEW_TOKEN_SECRET is not set');
  return value;
}

function computeToken(draftId: string, expiresAt: number): string {
  return createHmac('sha256', previewSecret()).update(`${draftId}.${expiresAt}`).digest('hex');
}

export function verifyPreviewToken(draftId: string, expiresAt: number, token: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(computeToken(draftId, expiresAt), 'hex');
  const actual = Buffer.from(token, 'hex');
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}
