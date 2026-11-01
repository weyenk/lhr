import express from 'express';
import type { Queryable, SourcedProductCandidate, SourcedProductCandidateStatus, SourcedProductCycle } from '@lhr/db';
import {
  approveCycleCriteria,
  closeSourcedProductCycle,
  decideSourcedProductCandidate,
  getOpenSourcedProductCycle,
  getSourcedProductCycle,
  listSourcedProductCandidates,
  setCandidateStatus,
  setCycleCriteria,
  setCycleStatus,
} from '@lhr/db';

/** Thrown inside handlers to short-circuit with a specific HTTP status. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function idList(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every((v) => Number.isInteger(v))) {
    throw new HttpError(400, `${field} must be an array of integer ids`);
  }
  return value as number[];
}

async function requireCycle(db: Queryable, rawId: string): Promise<SourcedProductCycle> {
  const cycle = await getSourcedProductCycle(db, Number(rawId));
  if (!cycle) throw new HttpError(404, 'cycle not found');
  return cycle;
}

function requireCycleStatus(cycle: SourcedProductCycle, expected: SourcedProductCycle['status']): void {
  if (cycle.status !== expected) {
    throw new HttpError(409, `cycle is ${cycle.status}, expected ${expected}`);
  }
}

/** Every id must belong to the cycle and currently have the expected status. */
function requireCandidatesInStatus(
  candidates: SourcedProductCandidate[],
  ids: number[],
  status: SourcedProductCandidateStatus,
): void {
  const eligible = new Set(candidates.filter((c) => c.status === status).map((c) => c.id));
  const bad = ids.filter((id) => !eligible.has(id));
  if (bad.length > 0) throw new HttpError(400, `candidates not in status ${status}: ${bad.join(', ')}`);
}

export function createSourcedProductsRouter(db: Queryable): express.Router {
  const router = express.Router();

  const handle =
    (fn: (req: express.Request, res: express.Response) => Promise<void>): express.RequestHandler =>
    async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    };

  router.get(
    '/cycle',
    handle(async (_req, res) => {
      const cycle = await getOpenSourcedProductCycle(db);
      const candidates = cycle ? await listSourcedProductCandidates(db, cycle.id) : [];
      res.json({ cycle, candidates });
    }),
  );

  router.post(
    '/cycle/:id/criteria/approve',
    handle(async (req, res) => {
      const cycle = await requireCycle(db, req.params.id);
      requireCycleStatus(cycle, 'awaiting_criteria_approval');
      if (req.body?.criteriaJson !== undefined) {
        await setCycleCriteria(db, cycle.id, req.body.criteriaJson);
      }
      await approveCycleCriteria(db, cycle.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/cycle/:id/candidates/pick',
    handle(async (req, res) => {
      const pickIds = idList(req.body?.pickIds, 'pickIds');
      const skipIds = idList(req.body?.skipIds ?? [], 'skipIds');
      const cycle = await requireCycle(db, req.params.id);
      requireCycleStatus(cycle, 'awaiting_product_picks');
      requireCandidatesInStatus(await listSourcedProductCandidates(db, cycle.id), [...pickIds, ...skipIds], 'sourced');
      for (const id of pickIds) await setCandidateStatus(db, id, 'picked');
      for (const id of skipIds) await setCandidateStatus(db, id, 'skipped');
      await setCycleStatus(db, cycle.id, 'monetizing');
      res.json({ ok: true });
    }),
  );

  router.post(
    '/cycle/:id/monetize/confirm',
    handle(async (req, res) => {
      const confirmIds = idList(req.body?.confirmIds, 'confirmIds');
      const dropIds = idList(req.body?.dropIds ?? [], 'dropIds');
      const cycle = await requireCycle(db, req.params.id);
      requireCycleStatus(cycle, 'awaiting_monetize_approval');
      requireCandidatesInStatus(
        await listSourcedProductCandidates(db, cycle.id),
        [...confirmIds, ...dropIds],
        'monetize_pass',
      );
      for (const id of confirmIds) await setCandidateStatus(db, id, 'monetize_confirmed');
      for (const id of dropIds) await setCandidateStatus(db, id, 'dropped');
      await setCycleStatus(db, cycle.id, 'branding');
      res.json({ ok: true });
    }),
  );

  const decide = (decision: 'approved' | 'denied') =>
    handle(async (req, res) => {
      const id = Number(req.params.id);
      const cycle = await getOpenSourcedProductCycle(db);
      if (!cycle) throw new HttpError(404, 'no open cycle');
      const candidate = (await listSourcedProductCandidates(db, cycle.id)).find((c) => c.id === id);
      if (!candidate) throw new HttpError(404, 'candidate not found');
      if (candidate.status !== 'pending_final') {
        throw new HttpError(409, `candidate is ${candidate.status}, expected pending_final`);
      }
      await decideSourcedProductCandidate(db, id, decision);
      const remaining = (await listSourcedProductCandidates(db, cycle.id)).some((c) => c.status === 'pending_final');
      if (!remaining) await closeSourcedProductCycle(db, cycle.id);
      res.json({ ok: true });
    });

  router.post('/candidates/:id/approve', decide('approved'));
  router.post('/candidates/:id/deny', decide('denied'));

  router.post(
    '/cycle/:id/close',
    handle(async (req, res) => {
      const cycle = await requireCycle(db, req.params.id);
      if (cycle.status === 'closed') throw new HttpError(409, 'cycle already closed');
      await closeSourcedProductCycle(db, cycle.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
