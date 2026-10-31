import express from 'express';
import type { CompetitorReport, Queryable } from '@lhr/db';
import {
  listCompetitorsByStatus,
  setCompetitorStatus,
  listRecentCompetitorReports,
  listKeywords,
  addKeyword,
  removeKeyword,
  listDiscoveryQueries,
  addDiscoveryQuery,
  removeDiscoveryQuery,
  upsertTrackedCompetitor,
} from '@lhr/db';

export function createCompetitorsRouter(db: Queryable): express.Router {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const domain = typeof req.body?.domain === 'string' ? req.body.domain : '';
      const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;
      const competitor = await upsertTrackedCompetitor(db, domain, name);
      res.status(201).json(competitor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /valid domain/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.get('/', async (_req, res) => {
    try {
      const tracked = await listCompetitorsByStatus(db, 'tracked');
      const candidates = await listCompetitorsByStatus(db, 'candidate');
      const latestReportEntries = await Promise.all(
        tracked.map(async (c): Promise<readonly [number, CompetitorReport] | null> => {
          const [latest] = await listRecentCompetitorReports(db, c.id, 1);
          return latest ? ([c.id, latest] as const) : null;
        }),
      );
      const latestReportsByCompetitorId = Object.fromEntries(
        latestReportEntries.filter((entry): entry is readonly [number, CompetitorReport] => entry !== null),
      );
      res.json({ tracked, candidates, latestReportsByCompetitorId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/:id/approve', async (req, res) => {
    try {
      await setCompetitorStatus(db, Number(req.params.id), 'tracked');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/:id/reject', async (req, res) => {
    try {
      await setCompetitorStatus(db, Number(req.params.id), 'rejected');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/keywords', async (_req, res) => {
    try {
      res.json(await listKeywords(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/keywords', async (req, res) => {
    try {
      res.json(await addKeyword(db, req.body.keyword));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/keywords/:id', async (req, res) => {
    try {
      await removeKeyword(db, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/discovery-queries', async (_req, res) => {
    try {
      res.json(await listDiscoveryQueries(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/discovery-queries', async (req, res) => {
    try {
      res.status(201).json(await addDiscoveryQuery(db, req.body.query));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /empty/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.delete('/discovery-queries/:id', async (req, res) => {
    try {
      await removeDiscoveryQuery(db, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
