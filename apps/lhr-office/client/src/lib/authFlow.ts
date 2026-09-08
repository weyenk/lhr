export type AuthFlowType = 'recovery' | 'invite';

// Supabase's password-recovery and invite emails redirect back to the app with
// #access_token=...&refresh_token=...&type=recovery (or type=invite) in the URL
// hash. Reading it here — separately from supabase-js's own hash consumption —
// lets the app show a "set your password" screen instead of the normal
// dashboard whenever the user arrived via one of those links.
export function getAuthFlowTypeFromHash(hash: string): AuthFlowType | null {
  const type = new URLSearchParams(hash.replace(/^#/, '')).get('type');
  return type === 'recovery' || type === 'invite' ? type : null;
}

// An expired or already-used recovery/invite link redirects with
// #error=access_denied&error_code=otp_expired&error_description=... instead of
// a valid session. Surfacing error_description (falling back to error_code) lets
// the login screen explain what happened instead of failing silently.
export function getAuthErrorFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const error = params.get('error');
  if (!error) return null;
  return params.get('error_description') ?? params.get('error_code') ?? error;
}

// supabase-js's client parses and clears window.location.hash as part of its own
// session setup — by the time app code gets around to reading location.hash
// directly, the recovery/invite params it needs may already be gone (observed in
// production: a real recovery link redirected fine, but the app only ever saw a
// bare "#" with no content). client/index.html captures the raw hash into
// window.__initialAuthHash via an inline script that runs before any bundled JS
// (including the Supabase client) even starts, so nothing can consume it first.
// Falls back to window.location.hash directly when that capture never ran (e.g.
// in tests).
export function getInitialAuthHash(): string {
  return (window as { __initialAuthHash?: string }).__initialAuthHash ?? window.location.hash;
}

// The default automatic session detection (detectSessionInUrl) fails silently on any error —
// no #error= hash, no session, nothing the app can react to (traced into
// @supabase/auth-js's GoTrueClient: a failed internal /auth/v1/user call inside
// _getSessionFromURL() is swallowed with just a debug log). Parsing the tokens ourselves and
// calling supabase.auth.setSession() directly (see App.tsx) makes that failure visible instead.
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export function getAuthTokensFromHash(hash: string): AuthTokens | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}
