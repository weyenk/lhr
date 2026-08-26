import express from 'express';
import type { Queryable } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from '@lhr/jobs';
import { runDueJob } from './orchestrate.js';

export function createApp(db: Queryable, registry: JobRegistration[] = defaultRegistry): express.Express {
  const app = express();
  app.set('trust proxy', 1);

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
    const outcome = await runDueJob(db, registry);
    res.status(200).json(outcome);
  };

  // Vercel Cron always issues a GET request to the configured path; POST is
  // kept too so the endpoint can be triggered manually (e.g. via curl)
  // during setup and debugging.
  app.get('/api/cron/orchestrator', handleCron);
  app.post('/api/cron/orchestrator', handleCron);

  return app;
}
