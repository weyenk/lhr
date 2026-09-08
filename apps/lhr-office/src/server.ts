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
import { clientAssets as defaultClientAssets, type ClientAsset } from './clientAssets.generated.js';

export type { CandidateOps, AffiliateCandidateOps };
export type { ClientAsset };

export function createApp(
  db: Queryable,
  registry: JobRegistration[] = defaultRegistry,
  candidates: CandidateOps = defaultCandidateOps(),
  affiliateCandidates: AffiliateCandidateOps = defaultAffiliateCandidateOps(db),
  clientAssets: Record<string, ClientAsset> = defaultClientAssets,
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

  // Client assets are inlined into this bundle at build time (scripts/bundle.mjs
  // generates clientAssets.generated.ts from the Vite build's output) rather than
  // read from disk at runtime. Vercel's file-tracing did not reliably package
  // client/dist into the deployed function — verified in production: the
  // directory was missing from /var/task at runtime despite the build producing
  // it, so every page load 404'd. Serving from an in-memory map that esbuild
  // bundled directly into this same file has no such dependency on Vercel's
  // packaging heuristics.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    const exactMatch = clientAssets[req.path];
    const asset = exactMatch ?? clientAssets['/index.html'];
    if (!asset) {
      res.status(404).send('Not found');
      return;
    }
    if (exactMatch && req.path !== '/index.html') {
      // Vite content-hashes these filenames, so they're safe to cache indefinitely.
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.type(asset.contentType).send(Buffer.from(asset.base64, 'base64'));
  });

  return app;
}
