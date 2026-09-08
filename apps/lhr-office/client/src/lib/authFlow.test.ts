import { describe, expect, it } from 'vitest';
import { getAuthFlowTypeFromHash } from './authFlow';

describe('getAuthFlowTypeFromHash', () => {
  it('returns "recovery" for a password-recovery redirect hash', () => {
    expect(getAuthFlowTypeFromHash('#access_token=abc&refresh_token=def&type=recovery')).toBe('recovery');
  });

  it('returns "invite" for an invite redirect hash', () => {
    expect(getAuthFlowTypeFromHash('#access_token=abc&refresh_token=def&type=invite')).toBe('invite');
  });

  it('returns null for a plain sign-in with no hash', () => {
    expect(getAuthFlowTypeFromHash('')).toBeNull();
  });

  it('returns null for an unrelated hash type (e.g. magiclink)', () => {
    expect(getAuthFlowTypeFromHash('#access_token=abc&type=magiclink')).toBeNull();
  });
});
