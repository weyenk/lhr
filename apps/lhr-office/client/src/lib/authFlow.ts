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
