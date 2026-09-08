import { describe, expect, it, afterEach } from 'vitest';
import { getAuthFlowTypeFromHash, getAuthErrorFromHash, getInitialAuthHash } from './authFlow';

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

describe('getAuthErrorFromHash', () => {
  it('returns the decoded error_description for an expired/used recovery link', () => {
    const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=';
    expect(getAuthErrorFromHash(hash)).toBe('Email link is invalid or has expired');
  });

  it('falls back to the error_code when error_description is missing', () => {
    expect(getAuthErrorFromHash('#error=access_denied&error_code=otp_expired')).toBe('otp_expired');
  });

  it('returns null for a plain sign-in with no hash', () => {
    expect(getAuthErrorFromHash('')).toBeNull();
  });

  it('returns null for a successful recovery redirect (no error param)', () => {
    expect(getAuthErrorFromHash('#access_token=abc&refresh_token=def&type=recovery')).toBeNull();
  });
});

describe('getInitialAuthHash', () => {
  afterEach(() => {
    delete (window as { __initialAuthHash?: string }).__initialAuthHash;
    window.location.hash = '';
  });

  it('prefers window.__initialAuthHash when set, since supabase-js clears window.location.hash asynchronously as part of its own session setup — by the time app code reads location.hash directly, the recovery/invite params it needs may already be gone', () => {
    window.location.hash = '';
    (window as { __initialAuthHash?: string }).__initialAuthHash = '#access_token=abc&type=recovery';
    expect(getInitialAuthHash()).toBe('#access_token=abc&type=recovery');
  });

  it('falls back to window.location.hash when __initialAuthHash was never set (e.g. in tests, or if index.html\'s capture script did not run)', () => {
    window.location.hash = '#access_token=abc&type=invite';
    expect(getInitialAuthHash()).toBe('#access_token=abc&type=invite');
  });
});
