import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCandidatesRouter } from '../../src/routes/candidates';

function buildApp(candidates: any, affiliateCandidates: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/candidates', createCandidatesRouter(candidates, affiliateCandidates));
  return app;
}

const noCandidates = { getPending: vi.fn().mockResolvedValue(null), approve: vi.fn(), reroll: vi.fn() };
const noAffiliateCandidates = { getPending: vi.fn().mockResolvedValue([]), approve: vi.fn(), deny: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/candidates/recipe', () => {
  it('returns the pending recipe candidate', async () => {
    const candidates = {
      getPending: vi.fn().mockResolvedValue({
        id: 'cand1',
        record: { status: 'pending', source: { idMeal: '52772', title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' } },
      }),
      approve: vi.fn(),
      reroll: vi.fn(),
    };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).get('/api/candidates/recipe');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cand1');
  });

  it('returns null when nothing is pending', async () => {
    const res = await request(buildApp(noCandidates, noAffiliateCandidates)).get('/api/candidates/recipe');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('POST /api/candidates/recipe/:id/approve', () => {
  it('approves and returns the result', async () => {
    const candidates = {
      getPending: vi.fn(),
      approve: vi.fn().mockResolvedValue({ draftId: 'draft1', title: 'Teriyaki Chicken Casserole', sourceMealDbId: '52772' }),
      reroll: vi.fn(),
    };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).post('/api/candidates/recipe/cand1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ draftId: 'draft1', title: 'Teriyaki Chicken Casserole', sourceMealDbId: '52772' });
    expect(candidates.approve).toHaveBeenCalledWith('cand1');
  });

  it('returns 500 (not a hang) when approve rejects', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn().mockRejectedValue(new Error('boom')), reroll: vi.fn() };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).post('/api/candidates/recipe/cand1/approve');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});

describe('POST /api/candidates/recipe/:id/reroll', () => {
  it('rerolls and returns the new candidate', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn(), reroll: vi.fn().mockResolvedValue({ id: 'cand2', record: {} }) };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).post('/api/candidates/recipe/cand1/reroll');
    expect(res.status).toBe(200);
    expect(candidates.reroll).toHaveBeenCalledWith('cand1');
  });
});

describe('GET /api/candidates/affiliate', () => {
  it('returns pending affiliate candidates', async () => {
    const affiliateCandidates = { getPending: vi.fn().mockResolvedValue([{ id: 1, title: 'Cast Iron Skillet' }]), approve: vi.fn(), deny: vi.fn() };
    const res = await request(buildApp(noCandidates, affiliateCandidates)).get('/api/candidates/affiliate');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, title: 'Cast Iron Skillet' }]);
  });
});

describe('POST /api/candidates/affiliate/:id/approve', () => {
  it('approves by numeric id and returns the result', async () => {
    const affiliateCandidates = { getPending: vi.fn(), approve: vi.fn().mockResolvedValue({ asin: 'B0X', title: 'Cast Iron Skillet', path: 'src/content/products/cast-iron.json' }), deny: vi.fn() };
    const res = await request(buildApp(noCandidates, affiliateCandidates)).post('/api/candidates/affiliate/42/approve');
    expect(res.status).toBe(200);
    expect(affiliateCandidates.approve).toHaveBeenCalledWith(42);
  });
});

describe('POST /api/candidates/affiliate/:id/deny', () => {
  it('denies by numeric id and returns the result', async () => {
    const affiliateCandidates = { getPending: vi.fn(), approve: vi.fn(), deny: vi.fn().mockResolvedValue({ asin: 'B0X', title: 'Cast Iron Skillet' }) };
    const res = await request(buildApp(noCandidates, affiliateCandidates)).post('/api/candidates/affiliate/42/deny');
    expect(res.status).toBe(200);
    expect(affiliateCandidates.deny).toHaveBeenCalledWith(42);
  });
});
