import express from 'express';
import type { Queryable } from '@lhr/db';
import { getRunHistory, upsertJobTuning } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { runJobNow } from '../orchestrate.js';
import { effectiveCadence, resolveProseCatalog } from '../resolveJobTuning.js';
import { JOB_PROSE_CATALOG } from '../jobProseCatalog.js';

export function createJobsRouter(db: Queryable, registry: JobRegistration[]): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const cadences = await effectiveCadence(db, registry);
      const rows = await Promise.all(
        registry.map(async (job) => ({
          name: job.name,
          defaultCadenceDays: job.cadenceDays,
          cadenceDays: cadences.get(job.name) ?? job.cadenceDays,
          prose: await resolveProseCatalog(db, job.name),
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

  router.patch('/:jobName/tuning', async (req, res) => {
    try {
      const job = registry.find((candidate) => candidate.name === req.params.jobName);
      if (!job) {
        res.status(404).json({ error: 'Unknown job' });
        return;
      }

      const body = (req.body ?? {}) as { cadenceDays?: unknown; prose?: unknown };

      let cadenceDays: number | undefined;
      if (body.cadenceDays !== undefined) {
        if (typeof body.cadenceDays !== 'number' || !Number.isFinite(body.cadenceDays) || body.cadenceDays < 1) {
          res.status(400).json({ error: 'cadenceDays must be a positive number' });
          return;
        }
        cadenceDays = body.cadenceDays;
      }

      let prose: Record<string, string> = {};
      if (body.prose !== undefined) {
        if (typeof body.prose !== 'object' || body.prose === null || Array.isArray(body.prose)) {
          res.status(400).json({ error: 'prose must be an object' });
          return;
        }
        const catalog = JOB_PROSE_CATALOG[job.name] ?? [];
        const editableIds = new Set(catalog.filter((entry) => entry.editable).map((entry) => entry.id));
        for (const [key, value] of Object.entries(body.prose as Record<string, unknown>)) {
          if (!editableIds.has(key) || typeof value !== 'string') continue;
          prose[key] = value;
        }
      }

      const tuning = await upsertJobTuning(db, job.name, { cadenceDays, prose });
      res.json({ jobName: tuning.jobName, cadenceDays: tuning.cadenceDays, proseOverrides: tuning.proseOverrides });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
