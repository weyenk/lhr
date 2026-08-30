import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { Queryable } from '@lhr/db';
import { getRunHistory } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from '@lhr/jobs';
import { createGitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import {
  getPendingCandidate,
  approveCandidate,
  rerollCandidate,
  type CandidateSummary,
  type ApprovedCandidate,
} from 'lhr-authoring-mcp-server/dist-lib/recipeCandidates.js';
import { runDueJob, runJobNow } from './orchestrate.js';
import { renderStatusPage, escapeHtml } from './statusPage.js';

// Reads the pending recipe candidate (if any) and lets the author approve or reroll it — see the
// 2026-08-30 "pick/approve" amendment in
// docs/superpowers/specs/active/2026-08-24-recipe-variant-generator-design.md. Injectable so
// tests never need a real GITHUB_TOKEN or GitHub API access.
export interface CandidateOps {
  getPending: () => Promise<CandidateSummary | null>;
  approve: (id: string) => Promise<ApprovedCandidate>;
  reroll: (id: string) => Promise<CandidateSummary | null>;
}

function requireGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return token;
}

function defaultCandidateOps(): CandidateOps {
  return {
    getPending: () => getPendingCandidate(createGitHubClient(requireGitHubToken())),
    approve: (id) => approveCandidate(createGitHubClient(requireGitHubToken()), id),
    reroll: (id) => rerollCandidate(createGitHubClient(requireGitHubToken()), id),
  };
}

// Constant-time string comparison: guards against timing attacks on the
// Basic Auth credential check below. Buffers of unequal length are rejected
// up front (without ever passing them to timingSafeEqual, which throws on a
// length mismatch) rather than padded, since the comparison is already
// happening well after the (also unpadded) length check on both the header
// parse and the request itself — this isn't meant to hide length, just to
// avoid a naive `===` on secret values.
function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// Protects the /status and /status/run/:jobName routes with HTTP Basic Auth.
// These routes are unauthenticated by default (Express doesn't gate them),
// and /status/run/:jobName triggers arbitrary job execution — bypassing the
// due-check and overlap-guard entirely — so unlike /health and the
// separately-secreted /api/cron/orchestrator, they must never be reachable
// without a credential check. Mirrors handleCron's pattern below: if either
// env var is unset, every request is treated as unauthorized rather than
// silently open.
function requireStatusAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const expectedUser = process.env.STATUS_AUTH_USER;
  const expectedPassword = process.env.STATUS_AUTH_PASSWORD;

  const reject = () => {
    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="lhr-office status"')
      .type('text')
      .send('Unauthorized');
  };

  if (!expectedUser || !expectedPassword) {
    reject();
    return;
  }

  const authHeader = req.header('authorization') ?? '';
  const match = /^Basic (.+)$/.exec(authHeader);
  if (!match) {
    reject();
    return;
  }

  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    reject();
    return;
  }

  const providedUser = decoded.slice(0, separatorIndex);
  const providedPassword = decoded.slice(separatorIndex + 1);

  if (!safeCompare(providedUser, expectedUser) || !safeCompare(providedPassword, expectedPassword)) {
    reject();
    return;
  }

  next();
}

export function createApp(
  db: Queryable,
  registry: JobRegistration[] = defaultRegistry,
  candidates: CandidateOps = defaultCandidateOps(),
): express.Express {
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

  app.get('/status', requireStatusAuth, async (_req, res) => {
    try {
      const rows = await Promise.all(
        registry.map(async (job) => ({
          name: job.name,
          cadenceDays: job.cadenceDays,
          history: await getRunHistory(db, job.name, 5),
        })),
      );
      const candidate = await candidates.getPending();
      res.type('html').send(renderStatusPage(rows, candidate));
    } catch (err) {
      // getRunHistory/candidates.getPending can throw (e.g. a DB or GitHub
      // connectivity failure). Express 4 does not catch rejections from async
      // handlers, so without this catch the request would hang instead of
      // getting a response — the same failure mode handleCron above was
      // hardened against.
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(500)
        .type('html')
        .send(`<!doctype html><html><body><h1>Orchestrator status</h1><p>Error loading status: ${escapeHtml(message)}</p></body></html>`);
    }
  });

  app.post('/status/run/:jobName', requireStatusAuth, async (req, res) => {
    try {
      const outcome = await runJobNow(db, registry, req.params.jobName);
      if (outcome === null) {
        res.status(404).send('Unknown job');
        return;
      }
      res.redirect(303, '/status');
    } catch (err) {
      // runJobNow can throw despite its own internal guarding (see
      // orchestrate.ts) if something above that layer fails unexpectedly.
      // Same rationale as the /status catch above: never let this hang.
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to run job: ${escapeHtml(message)}`);
    }
  });

  app.post('/status/candidate/:id/approve', requireStatusAuth, async (req, res) => {
    try {
      await candidates.approve(req.params.id);
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to approve candidate: ${escapeHtml(message)}`);
    }
  });

  app.post('/status/candidate/:id/reroll', requireStatusAuth, async (req, res) => {
    try {
      await candidates.reroll(req.params.id);
      res.redirect(303, '/status');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Failed to reroll candidate: ${escapeHtml(message)}`);
    }
  });

  return app;
}
