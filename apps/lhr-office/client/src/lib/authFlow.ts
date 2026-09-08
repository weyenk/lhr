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
