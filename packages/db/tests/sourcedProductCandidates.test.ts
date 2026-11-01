import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  decideSourcedProductCandidate,
  insertSourcedProductCandidate,
  listSourcedProductCandidates,
  setCandidateBrandResult,
  setCandidateMonetizeResult,
  setCandidateStatus,
} from '../src/sourcedProductCandidates';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const candidateRow = {
  id: 3,
  cycle_id: 7,
  title: 'Carbon steel wok',
  image_url: 'https://cdn.example.com/wok.jpg',
  source_url: 'https://alibaba.com/item/1',
  platform: 'alibaba',
  moq: '100 pcs',
  unit_cost_cents: 450,
  notes: 'ships in 2 weeks',
  status: 'sourced',
  monetize_pass: null,
  monetize_rationale: null,
  brand_pass: null,
  brand_rationale: null,
  decided_at: null,
  created_at: new Date('2026-10-31T00:00:00Z'),
};

const candidate = {
  id: 3,
  cycleId: 7,
  title: 'Carbon steel wok',
  imageUrl: 'https://cdn.example.com/wok.jpg',
  sourceUrl: 'https://alibaba.com/item/1',
  platform: 'alibaba',
  moq: '100 pcs',
  unitCostCents: 450,
  notes: 'ships in 2 weeks',
  status: 'sourced',
  monetizePass: null,
  monetizeRationale: null,
  brandPass: null,
  brandRationale: null,
  decidedAt: null,
  createdAt: candidateRow.created_at,
};

const newCandidate = {
  cycleId: 7,
  title: 'Carbon steel wok',
  imageUrl: 'https://cdn.example.com/wok.jpg',
  sourceUrl: 'https://alibaba.com/item/1',
  platform: 'alibaba',
  moq: '100 pcs',
  unitCostCents: 450,
  notes: 'ships in 2 weeks',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertSourcedProductCandidate', () => {
  it('inserts with ON CONFLICT DO NOTHING and returns the mapped row', async () => {
    const db = mockDb([candidateRow]);
    const result = await insertSourcedProductCandidate(db as never, newCandidate);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO sourced_product_candidates');
    expect(sql).toContain('ON CONFLICT (cycle_id, source_url) DO NOTHING');
    expect(sql).toContain('RETURNING');
    expect(db.query.mock.calls[0][1]).toEqual([
      7,
      'Carbon steel wok',
      'https://cdn.example.com/wok.jpg',
      'https://alibaba.com/item/1',
      'alibaba',
      '100 pcs',
      450,
      'ships in 2 weeks',
    ]);
    expect(result).toEqual(candidate);
  });

  it('defaults optional fields to null', async () => {
    const db = mockDb([candidateRow]);
    await insertSourcedProductCandidate(db as never, {
      cycleId: 7,
      title: 'Wok',
      sourceUrl: 'https://alibaba.com/item/2',
      platform: 'alibaba',
    });
    expect(db.query.mock.calls[0][1]).toEqual([
      7, 'Wok', null, 'https://alibaba.com/item/2', 'alibaba', null, null, null,
    ]);
  });

  it('returns null when (cycle_id, source_url) already exists', async () => {
    const db = mockDb([]);
    expect(await insertSourcedProductCandidate(db as never, newCandidate)).toBeNull();
  });
});

describe('listSourcedProductCandidates', () => {
  it('lists every candidate for the cycle when no status is given', async () => {
    const db = mockDb([candidateRow]);
    const result = await listSourcedProductCandidates(db as never, 7);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('WHERE cycle_id = $1');
    expect(sql).not.toContain('status =');
    expect(sql).toContain('ORDER BY id ASC');
    expect(db.query.mock.calls[0][1]).toEqual([7]);
    expect(result).toEqual([candidate]);
  });

  it('filters by status when given', async () => {
    const db = mockDb([{ ...candidateRow, status: 'picked' }]);
    const result = await listSourcedProductCandidates(db as never, 7, 'picked');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('AND status = $2'), [7, 'picked']);
    expect(result[0].status).toBe('picked');
  });
});

describe('setCandidateStatus', () => {
  it('updates the status', async () => {
    const db = mockDb();
    await setCandidateStatus(db as never, 3, 'skipped');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $1'), ['skipped', 3]);
  });
});

describe('setCandidateMonetizeResult', () => {
  it('writes pass and rationale', async () => {
    const db = mockDb();
    await setCandidateMonetizeResult(db as never, 3, { pass: true, rationale: 'good fit' });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('monetize_pass = $1');
    expect(sql).toContain('monetize_rationale = $2');
    expect(db.query.mock.calls[0][1]).toEqual([true, 'good fit', 3]);
  });
});

describe('setCandidateBrandResult', () => {
  it('writes pass and rationale', async () => {
    const db = mockDb();
    await setCandidateBrandResult(db as never, 3, { pass: false, rationale: 'off-brand' });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('brand_pass = $1');
    expect(sql).toContain('brand_rationale = $2');
    expect(db.query.mock.calls[0][1]).toEqual([false, 'off-brand', 3]);
  });
});

describe('decideSourcedProductCandidate', () => {
  it('sets status and decided_at', async () => {
    const db = mockDb();
    await decideSourcedProductCandidate(db as never, 3, 'approved');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('status = $1');
    expect(sql).toContain('decided_at = now()');
    expect(db.query.mock.calls[0][1]).toEqual(['approved', 3]);
  });

  it('records denials the same way', async () => {
    const db = mockDb();
    await decideSourcedProductCandidate(db as never, 3, 'denied');
    expect(db.query.mock.calls[0][1]).toEqual(['denied', 3]);
  });
});
