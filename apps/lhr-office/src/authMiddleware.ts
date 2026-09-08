import { createRemoteJWKSet, jwtVerify } from 'jose';
import type express from 'express';

// Supabase signs session tokens (issued at login, and via recovery/invite links) with ES256
// using per-project asymmetric JWT signing keys, not a shared secret — verified here against
// the project's published JWKS rather than a static SUPABASE_JWT_SECRET.
let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedForUrl: string | undefined;

function getJWKS(supabaseUrl: string) {
  if (cachedJWKS && cachedForUrl === supabaseUrl) return cachedJWKS;
  cachedJWKS = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
  cachedForUrl = supabaseUrl;
  return cachedJWKS;
}

// If SUPABASE_URL is unset, every request is treated as unauthorized rather than silently open.
export async function requireSupabaseAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const reject = () => res.status(401).json({ error: 'unauthorized' });

  if (!supabaseUrl) {
    reject();
    return;
  }

  const authHeader = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) {
    reject();
    return;
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], getJWKS(supabaseUrl), { algorithms: ['ES256'] }));
  } catch {
    reject();
    return;
  }

  // Supabase's public anon key is itself a validly-signed JWT (role: "anon", no sub claim)
  // and ships in the client bundle, so signature/expiry alone aren't enough — only accept real
  // user session tokens (role: "authenticated" with a sub claim).
  if (payload.role !== 'authenticated' || !payload.sub) {
    reject();
    return;
  }

  next();
}
