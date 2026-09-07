import express from 'express';
import type { Queryable } from '@lhr/db';
import { TREND_CATEGORIES, listRecentReports, getAllTopics, setTopicStatus, addCuratedTopic } from '@lhr/db';

export function createTrendsRouter(db: Queryable): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const reports = (await Promise.all(TREND_CATEGORIES.map((category) => listRecentReports(db, category)))).flat();
      const topics = await getAllTopics(db);
      res.json({ reports, topics });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/topics', async (req, res) => {
    try {
      res.json(await addCuratedTopic(db, req.body.category, req.body.topic));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/topics/:id/promote', async (req, res) => {
    try {
      await setTopicStatus(db, Number(req.params.id), 'curated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/topics/:id/demote', async (req, res) => {
    try {
      await setTopicStatus(db, Number(req.params.id), 'candidate');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
