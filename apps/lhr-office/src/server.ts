import path from 'node:path';
import express from 'express';
import type { Queryable } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from './registry.js';
import { runDueJob } from './orchestrate.js';
import { requireSupabaseAuth } from './authMiddleware.js';
import { createJobsRouter } from './routes/jobs.js';
import {
  createCandidatesRouter,
  defaultCandidateOps,
  defaultAffiliateCandidateOps,
  type CandidateOps,
  type AffiliateCandidateOps,
} from './routes/candidates.js';
import { createTrendsRouter } from './routes/trends.js';
import { createCompetitorsRouter } from './routes/competitors.js';

export type { CandidateOps, AffiliateCandidateOps };

// Resolved from process.cwd() (apps/lhr-office both locally — see scripts/dev.ts's cwd-relative
// env file path — and on Vercel, where this project's root directory is apps/lhr-office) rather
// than import.meta.url: esbuild bundles this file into a single dist/api/index.js or
// dist/src/server.js output, at which point import.meta.url resolves to that bundle's own
// location, not this source file's — a relative URL computed from it would point outside the
// package entirely.
const defaultClientDistDir = path.resolve(process.cwd(), 'client/dist');

export function createApp(
  db: Queryable,
  registry: JobRegistration[] = defaultRegistry,
  candidates: CandidateOps = defaultCandidateOps(),
  affiliateCandidates: AffiliateCandidateOps = defaultAffiliateCandidateOps(db),
  clientDistDir: string = defaultClientDistDir,
): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const handleCron = async (req: express.Request, res: express.Response) => {
    const secret = process.env.CRON_SECRET;
    const authHeader = req.header('authorization') ?? '';
    if (!secret || authHeader !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const outcome = await runDueJob(db, registry);
      res.status(200).json(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(200).json({ outcome: 'error', error: message });
    }
  };
  app.get('/api/cron/orchestrator', handleCron);
  app.post('/api/cron/orchestrator', handleCron);

  app.use('/api/jobs', requireSupabaseAuth, createJobsRouter(db, registry));
  app.use('/api/candidates', requireSupabaseAuth, createCandidatesRouter(candidates, affiliateCandidates));
  app.use('/api/trends', requireSupabaseAuth, createTrendsRouter(db));
  app.use('/api/competitors', requireSupabaseAuth, createCompetitorsRouter(db));

  app.use(express.static(clientDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    // A callback here means Express will NOT auto-respond on error (that only
    // happens when sendFile is called with no callback at all) — so failing to
    // call next(err) ourselves leaves the request hanging with no response
    // until the platform's function timeout. next(err) restores Express's
    // default error-response behavior (respects err.status, e.g. 404 for a
    // missing file) while still getting the error logged.
    res.sendFile(path.join(clientDistDir, 'index.html'), (err) => {
      if (err) {
        console.error('[server] failed to send SPA index.html:', err);
        next(err);
      }
    });
  });

  return app;
}
