import express from 'express';
import { loadBridgeConfig } from '../bridge/config.js';
import { createHubClient, HubClientError, type HubClient } from '../bridge/hubClient.js';

const ALLOWED_REPO_KEYS = new Set(['lhr', 'ecff']);

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createBridgeRouter(
  getClient: () => HubClient = () => createHubClient(loadBridgeConfig()),
): express.Router {
  const router = express.Router();

  router.post('/jobs', async (req, res) => {
    const sub = req.authorSub;
    if (!sub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : '';
    if (!goal) {
      res.status(400).json({ error: 'goal is required' });
      return;
    }
    const repoKey = req.body?.repo_key;
    if (repoKey !== undefined && !ALLOWED_REPO_KEYS.has(repoKey)) {
      res.status(400).json({ error: 'repo_key must be lhr or ecff' });
      return;
    }
    try {
      const job = await getClient().enqueueStudio(sub, {
        goal,
        repo_key: repoKey,
      });
      res.status(201).json({ job });
    } catch (err) {
      respondHub(res, err);
    }
  });

  router.get('/jobs', async (req, res) => {
    const sub = req.authorSub;
    if (!sub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const jobs = await getClient().listJobs(sub);
      res.json({ jobs });
    } catch (err) {
      respondHub(res, err);
    }
  });

  router.get('/jobs/:id', async (req, res) => {
    const sub = req.authorSub;
    if (!sub) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const id = req.params.id;
    if (!JOB_ID_RE.test(id)) {
      res.status(400).json({ error: 'invalid job id' });
      return;
    }
    try {
      const job = await getClient().getJob(sub, id);
      res.json({ job });
    } catch (err) {
      respondHub(res, err);
    }
  });

  return router;
}

function respondHub(res: express.Response, err: unknown): void {
  if (err instanceof HubClientError) {
    if (err.status === 404) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // Hub 401 = bad tenant key / hub auth — not the user's Supabase session.
    res.status(502).json({ error: 'job bus unavailable' });
    return;
  }
  res.status(500).json({ error: 'internal error' });
}
