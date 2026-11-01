import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const getOpenCycleMock = vi.fn();
const getCycleMock = vi.fn();
const listCandidatesMock = vi.fn();
const setCycleCriteriaMock = vi.fn();
const approveCycleCriteriaMock = vi.fn();
const setCycleStatusMock = vi.fn();
const closeCycleMock = vi.fn();
const setCandidateStatusMock = vi.fn();
const decideCandidateMock = vi.fn();

vi.mock('@lhr/db', () => ({
  getOpenSourcedProductCycle: (...a: unknown[]) => getOpenCycleMock(...a),
  getSourcedProductCycle: (...a: unknown[]) => getCycleMock(...a),
  listSourcedProductCandidates: (...a: unknown[]) => listCandidatesMock(...a),
  setCycleCriteria: (...a: unknown[]) => setCycleCriteriaMock(...a),
  approveCycleCriteria: (...a: unknown[]) => approveCycleCriteriaMock(...a),
  setCycleStatus: (...a: unknown[]) => setCycleStatusMock(...a),
  closeSourcedProductCycle: (...a: unknown[]) => closeCycleMock(...a),
  setCandidateStatus: (...a: unknown[]) => setCandidateStatusMock(...a),
  decideSourcedProductCandidate: (...a: unknown[]) => decideCandidateMock(...a),
}));

const { createSourcedProductsRouter } = await import('../../src/routes/sourcedProducts');

const fakeDb = {} as Queryable;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sourced-products', createSourcedProductsRouter(fakeDb));
  return app;
}

const cycle = (status: string) => ({ id: 5, status, criteriaJson: { a: 1 } });
const cand = (id: number, status: string) => ({ id, cycleId: 5, status });

beforeEach(() => {
  vi.clearAllMocks();
  getOpenCycleMock.mockResolvedValue(null);
  getCycleMock.mockResolvedValue(null);
  listCandidatesMock.mockResolvedValue([]);
});

describe('GET /api/sourced-products/cycle', () => {
  it('returns null cycle and no candidates when none is open', async () => {
    const res = await request(buildApp()).get('/api/sourced-products/cycle');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cycle: null, candidates: [] });
  });

  it('returns the open cycle with its candidates', async () => {
    getOpenCycleMock.mockResolvedValue(cycle('awaiting_product_picks'));
    listCandidatesMock.mockResolvedValue([cand(1, 'sourced')]);
    const res = await request(buildApp()).get('/api/sourced-products/cycle');
    expect(res.body.cycle).toMatchObject({ id: 5, status: 'awaiting_product_picks' });
    expect(res.body.candidates).toHaveLength(1);
    expect(listCandidatesMock).toHaveBeenCalledWith(fakeDb, 5);
  });
});

describe('POST /cycle/:id/criteria/approve', () => {
  it('approves criteria without edits', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_criteria_approval'));
    const res = await request(buildApp()).post('/api/sourced-products/cycle/5/criteria/approve').send({});
    expect(res.status).toBe(200);
    expect(setCycleCriteriaMock).not.toHaveBeenCalled();
    expect(approveCycleCriteriaMock).toHaveBeenCalledWith(fakeDb, 5);
  });

  it('saves edited criteria before approving', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_criteria_approval'));
    const res = await request(buildApp())
      .post('/api/sourced-products/cycle/5/criteria/approve')
      .send({ criteriaJson: { budget: 10 } });
    expect(res.status).toBe(200);
    expect(setCycleCriteriaMock).toHaveBeenCalledWith(fakeDb, 5, { budget: 10 });
    expect(approveCycleCriteriaMock).toHaveBeenCalledWith(fakeDb, 5);
  });

  it('404s for an unknown cycle', async () => {
    const res = await request(buildApp()).post('/api/sourced-products/cycle/5/criteria/approve').send({});
    expect(res.status).toBe(404);
    expect(approveCycleCriteriaMock).not.toHaveBeenCalled();
  });

  it('409s when the cycle is not awaiting criteria approval', async () => {
    getCycleMock.mockResolvedValue(cycle('branding'));
    const res = await request(buildApp()).post('/api/sourced-products/cycle/5/criteria/approve').send({});
    expect(res.status).toBe(409);
    expect(approveCycleCriteriaMock).not.toHaveBeenCalled();
  });
});

describe('POST /cycle/:id/candidates/pick', () => {
  it('marks picks and skips then moves the cycle to monetizing', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_product_picks'));
    listCandidatesMock.mockResolvedValue([cand(1, 'sourced'), cand(2, 'sourced'), cand(3, 'sourced')]);
    const res = await request(buildApp())
      .post('/api/sourced-products/cycle/5/candidates/pick')
      .send({ pickIds: [1, 2], skipIds: [3] });
    expect(res.status).toBe(200);
    expect(setCandidateStatusMock).toHaveBeenCalledWith(fakeDb, 1, 'picked');
    expect(setCandidateStatusMock).toHaveBeenCalledWith(fakeDb, 2, 'picked');
    expect(setCandidateStatusMock).toHaveBeenCalledWith(fakeDb, 3, 'skipped');
    expect(setCycleStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'monetizing');
  });

  it('400s on invalid body or ids outside the cycle', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_product_picks'));
    listCandidatesMock.mockResolvedValue([cand(1, 'sourced')]);
    const bad = await request(buildApp()).post('/api/sourced-products/cycle/5/candidates/pick').send({ pickIds: 'x' });
    expect(bad.status).toBe(400);
    const foreign = await request(buildApp())
      .post('/api/sourced-products/cycle/5/candidates/pick')
      .send({ pickIds: [99], skipIds: [] });
    expect(foreign.status).toBe(400);
    expect(setCycleStatusMock).not.toHaveBeenCalled();
  });

  it('409s when the cycle is not awaiting picks', async () => {
    getCycleMock.mockResolvedValue(cycle('monetizing'));
    const res = await request(buildApp())
      .post('/api/sourced-products/cycle/5/candidates/pick')
      .send({ pickIds: [1], skipIds: [] });
    expect(res.status).toBe(409);
  });
});

describe('POST /cycle/:id/monetize/confirm', () => {
  it('confirms and drops monetize_pass candidates then moves to branding', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_monetize_approval'));
    listCandidatesMock.mockResolvedValue([cand(1, 'monetize_pass'), cand(2, 'monetize_pass')]);
    const res = await request(buildApp())
      .post('/api/sourced-products/cycle/5/monetize/confirm')
      .send({ confirmIds: [1], dropIds: [2] });
    expect(res.status).toBe(200);
    expect(setCandidateStatusMock).toHaveBeenCalledWith(fakeDb, 1, 'monetize_confirmed');
    expect(setCandidateStatusMock).toHaveBeenCalledWith(fakeDb, 2, 'dropped');
    expect(setCycleStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'branding');
  });

  it('400s when an id is not a monetize_pass candidate', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_monetize_approval'));
    listCandidatesMock.mockResolvedValue([cand(1, 'monetize_fail')]);
    const res = await request(buildApp())
      .post('/api/sourced-products/cycle/5/monetize/confirm')
      .send({ confirmIds: [1], dropIds: [] });
    expect(res.status).toBe(400);
    expect(setCandidateStatusMock).not.toHaveBeenCalled();
    expect(setCycleStatusMock).not.toHaveBeenCalled();
  });

  it('409s when the cycle is not awaiting monetize approval', async () => {
    getCycleMock.mockResolvedValue(cycle('searching'));
    const res = await request(buildApp())
      .post('/api/sourced-products/cycle/5/monetize/confirm')
      .send({ confirmIds: [], dropIds: [] });
    expect(res.status).toBe(409);
  });
});

describe('final decisions', () => {
  beforeEach(() => {
    getOpenCycleMock.mockResolvedValue(cycle('awaiting_final'));
  });

  it('approves a pending_final candidate and leaves the cycle open while others are pending', async () => {
    listCandidatesMock.mockResolvedValue([cand(1, 'pending_final'), cand(2, 'pending_final')]);
    const res = await request(buildApp()).post('/api/sourced-products/candidates/1/approve');
    expect(res.status).toBe(200);
    expect(decideCandidateMock).toHaveBeenCalledWith(fakeDb, 1, 'approved');
    expect(closeCycleMock).not.toHaveBeenCalled();
  });

  it('denies a candidate and closes the cycle when none remain pending_final', async () => {
    listCandidatesMock
      .mockResolvedValueOnce([cand(1, 'pending_final')])
      .mockResolvedValueOnce([cand(1, 'denied')]);
    const res = await request(buildApp()).post('/api/sourced-products/candidates/1/deny');
    expect(res.status).toBe(200);
    expect(decideCandidateMock).toHaveBeenCalledWith(fakeDb, 1, 'denied');
    expect(closeCycleMock).toHaveBeenCalledWith(fakeDb, 5);
  });

  it('409s when the candidate is not pending_final', async () => {
    listCandidatesMock.mockResolvedValue([cand(1, 'brand_fail')]);
    const res = await request(buildApp()).post('/api/sourced-products/candidates/1/approve');
    expect(res.status).toBe(409);
    expect(decideCandidateMock).not.toHaveBeenCalled();
  });

  it('404s when there is no open cycle or the candidate is unknown', async () => {
    listCandidatesMock.mockResolvedValue([]);
    const res = await request(buildApp()).post('/api/sourced-products/candidates/1/approve');
    expect(res.status).toBe(404);
    getOpenCycleMock.mockResolvedValue(null);
    const res2 = await request(buildApp()).post('/api/sourced-products/candidates/1/deny');
    expect(res2.status).toBe(404);
  });
});

describe('POST /cycle/:id/close', () => {
  it('abandons an open cycle', async () => {
    getCycleMock.mockResolvedValue(cycle('awaiting_product_picks'));
    const res = await request(buildApp()).post('/api/sourced-products/cycle/5/close');
    expect(res.status).toBe(200);
    expect(closeCycleMock).toHaveBeenCalledWith(fakeDb, 5);
  });

  it('404s for an unknown cycle and 409s for an already-closed one', async () => {
    const missing = await request(buildApp()).post('/api/sourced-products/cycle/5/close');
    expect(missing.status).toBe(404);
    getCycleMock.mockResolvedValue(cycle('closed'));
    const closed = await request(buildApp()).post('/api/sourced-products/cycle/5/close');
    expect(closed.status).toBe(409);
  });
});
