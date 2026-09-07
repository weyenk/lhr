import jwt from 'jsonwebtoken';
import type express from 'express';

// Mirrors requireStatusAuth's posture: if the secret env var is unset, every
// request is treated as unauthorized rather than silently open.
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

  try {
    jwt.verify(match[1], secret, { algorithms: ['HS256'] });
  } catch {
    reject();
    return;
  }

  next();
}
