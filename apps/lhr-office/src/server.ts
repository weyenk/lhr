import express from 'express';
import type { Queryable } from '@lhr/db';
import { getRunHistory } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from '@lhr/jobs';
import { runDueJob, runJobNow } from './orchestrate.js';
import { renderStatusPage } from './statusPage.js';

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
    try {
      const outcome = await runDueJob(db, registry);
      res.status(200).json(outcome);
    } catch (err) {
      // runDueJob's own job.run() is already guarded (see orchestrate.ts), but
      // the due-check / overlap-guard / record-keeping calls around it can
      // still throw (e.g. a DB connectivity failure). Express 4 does not
      // catch rejections from async handlers, so without this catch such an
      // error becomes an unhandled rejection: the request never gets a
      // response, and the process can be torn down. The cron endpoint must
      // always respond with 200, never crash or hang.
      const message = err instanceof Error ? err.message : String(err);
      res.status(200).json({ outcome: 'error', error: message });
    }
  };

  // Vercel Cron always issues a GET request to the configured path; POST is
  // kept too so the endpoint can be triggered manually (e.g. via curl)
  // during setup and debugging.
  app.get('/api/cron/orchestrator', handleCron);
  app.post('/api/cron/orchestrator', handleCron);

  app.get('/status', async (_req, res) => {
    const rows = await Promise.all(
      registry.map(async (job) => ({
        name: job.name,
        cadenceDays: job.cadenceDays,
        history: await getRunHistory(db, job.name, 5),
      })),
    );
    res.type('html').send(renderStatusPage(rows));
  });

  app.post('/status/run/:jobName', async (req, res) => {
    const outcome = await runJobNow(db, registry, req.params.jobName);
    if (outcome === null) {
      res.status(404).send('Unknown job');
      return;
    }
    res.redirect(303, '/status');
  });

  return app;
}
