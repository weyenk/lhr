import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

// detectSessionInUrl is disabled: its automatic recovery/invite session detection swallows
// failures silently (see authFlow.ts's getAuthTokensFromHash doc comment). App.tsx parses the
// captured hash itself and calls setSession() directly so errors are visible.
export const supabase = createClient(url, anonKey, {
  auth: { detectSessionInUrl: false },
});
