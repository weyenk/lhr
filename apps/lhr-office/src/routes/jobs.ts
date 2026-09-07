import express from 'express';
import type { Queryable } from '@lhr/db';
import { getRunHistory } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { runJobNow } from '../orchestrate.js';

export function createJobsRouter(db: Queryable, registry: JobRegistration[]): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const rows = await Promise.all(
        registry.map(async (job) => ({
          name: job.name,
          cadenceDays: job.cadenceDays,
          history: await getRunHistory(db, job.name, 5),
        })),
      );
      res.json(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/:jobName/run', async (req, res) => {
    try {
      const outcome = await runJobNow(db, registry, req.params.jobName);
      if (outcome === null) {
        res.status(404).json({ error: 'Unknown job' });
        return;
      }
      res.json(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
