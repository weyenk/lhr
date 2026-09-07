import jwt from 'jsonwebtoken';
import type express from 'express';

// If the secret env var is unset, every request is treated as unauthorized
// rather than silently open.
export function requireSupabaseAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const reject = () => res.status(401).json({ error: 'unauthorized' });

  if (!secret) {
    reject();
    return;
  }

  const authHeader = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) {
    reject();
    return;
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
  } catch {
    reject();
    return;
  }

  // Supabase's public anon key is itself a validly-signed HS256 JWT using
  // this same secret (role: "anon", no sub claim) and ships in the client
  // bundle, so signature/expiry alone aren't enough — only accept real user
  // session tokens (role: "authenticated" with a sub claim).
  if (typeof payload === 'string' || payload.role !== 'authenticated' || !payload.sub) {
    reject();
    return;
  }

  next();
}
