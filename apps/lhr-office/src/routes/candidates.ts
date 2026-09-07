import express from 'express';
import type { Candidate, Queryable } from '@lhr/db';
import { getLatestPendingCycleId, getPendingCandidates } from '@lhr/db';
import { createGitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import {
  getPendingCandidate,
  approveCandidate,
  rerollCandidate,
  type CandidateSummary,
  type ApprovedCandidate,
} from 'lhr-authoring-mcp-server/dist-lib/recipeCandidates.js';
import {
  approveAffiliateCandidate,
  denyAffiliateCandidate,
  type ApprovedAffiliateCandidate,
  type DeniedAffiliateCandidate,
} from 'lhr-authoring-mcp-server/dist-lib/affiliateCandidateOps.js';

export interface CandidateOps {
  getPending: () => Promise<CandidateSummary | null>;
  approve: (id: string) => Promise<ApprovedCandidate>;
  reroll: (id: string) => Promise<CandidateSummary | null>;
}

export interface AffiliateCandidateOps {
  getPending: () => Promise<Candidate[]>;
  approve: (id: number) => Promise<ApprovedAffiliateCandidate>;
  deny: (id: number) => Promise<DeniedAffiliateCandidate>;
}

function requireGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return token;
}

function requireAssociatesTag(): string {
  const tag = process.env.AMAZON_ASSOCIATES_TAG;
  if (!tag) throw new Error('AMAZON_ASSOCIATES_TAG is not set');
  return tag;
}

export function defaultCandidateOps(): CandidateOps {
  return {
    getPending: () => getPendingCandidate(createGitHubClient(requireGitHubToken())),
    approve: (id) => approveCandidate(createGitHubClient(requireGitHubToken()), id),
    reroll: (id) => rerollCandidate(createGitHubClient(requireGitHubToken()), id),
  };
}

export function defaultAffiliateCandidateOps(db: Queryable): AffiliateCandidateOps {
  return {
    getPending: async () => {
      const cycleId = await getLatestPendingCycleId(db);
      return cycleId ? getPendingCandidates(db, cycleId) : [];
    },
    approve: (id) => approveAffiliateCandidate(db, requireGitHubToken(), requireAssociatesTag(), id),
    deny: (id) => denyAffiliateCandidate(db, id),
  };
}

export function createCandidatesRouter(candidates: CandidateOps, affiliateCandidates: AffiliateCandidateOps): express.Router {
  const router = express.Router();

  router.get('/recipe', async (_req, res) => {
    try {
      res.json(await candidates.getPending());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/recipe/:id/approve', async (req, res) => {
    try {
      res.json(await candidates.approve(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/recipe/:id/reroll', async (req, res) => {
    try {
      res.json(await candidates.reroll(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/affiliate', async (_req, res) => {
    try {
      res.json(await affiliateCandidates.getPending());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/affiliate/:id/approve', async (req, res) => {
    try {
      res.json(await affiliateCandidates.approve(Number(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/affiliate/:id/deny', async (req, res) => {
    try {
      res.json(await affiliateCandidates.deny(Number(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
