import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  approveCycleCriteria,
  closeSourcedProductCycle,
  createSourcedProductCycle,
  getOpenSourcedProductCycle,
  getSourcedProductCycle,
  setCycleCriteria,
  setCycleStatus,
} from '../src/sourcedProductCycles';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const cycleRow = {
  id: 7,
  started_at: new Date('2026-10-31T00:00:00Z'),
  status: 'drafting_criteria',
  criteria_json: null,
  criteria_approved_at: null,
  gating_profile: 'strict',
  closed_at: null,
};

const cycle = {
  id: 7,
  startedAt: cycleRow.started_at,
  status: 'drafting_criteria',
  criteriaJson: null,
  criteriaApprovedAt: null,
  gatingProfile: 'strict',
  closedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSourcedProductCycle', () => {
  it('inserts a drafting_criteria cycle with the gating profile and returns it', async () => {
    const db = mockDb([cycleRow]);
    const result = await createSourcedProductCycle(db as never, { gatingProfile: 'strict' });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sourced_product_cycles'),
      ['drafting_criteria', 'strict'],
    );
    expect(db.query.mock.calls[0][0]).toContain('RETURNING');
    expect(result).toEqual(cycle);
  });

  it('passes through the trust profile', async () => {
    const db = mockDb([{ ...cycleRow, gating_profile: 'trust' }]);
    const result = await createSourcedProductCycle(db as never, { gatingProfile: 'trust' });
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['drafting_criteria', 'trust']);
    expect(result.gatingProfile).toBe('trust');
  });
});

describe('getOpenSourcedProductCycle', () => {
  it('excludes closed cycles and returns the newest open one', async () => {
    const db = mockDb([cycleRow]);
    const result = await getOpenSourcedProductCycle(db as never);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status <> 'closed'");
    expect(sql).toContain('ORDER BY started_at DESC');
    expect(sql).toContain('LIMIT 1');
    expect(result).toEqual(cycle);
  });

  it('returns null when every cycle is closed', async () => {
    const db = mockDb([]);
    expect(await getOpenSourcedProductCycle(db as never)).toBeNull();
  });
});

describe('getSourcedProductCycle', () => {
  it('looks up by id', async () => {
    const db = mockDb([cycleRow]);
    const result = await getSourcedProductCycle(db as never, 7);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [7]);
    expect(result).toEqual(cycle);
  });

  it('returns null when missing', async () => {
    const db = mockDb([]);
    expect(await getSourcedProductCycle(db as never, 99)).toBeNull();
  });
});

describe('setCycleCriteria', () => {
  it('writes the criteria as JSON', async () => {
    const db = mockDb();
    const criteria = { categories: ['cookware'], maxUnitCostCents: 800 };
    await setCycleCriteria(db as never, 7, criteria);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('criteria_json = $1'),
      [JSON.stringify(criteria), 7],
    );
  });
});

describe('setCycleStatus', () => {
  it('updates the status', async () => {
    const db = mockDb();
    await setCycleStatus(db as never, 7, 'awaiting_criteria_approval');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = $1'),
      ['awaiting_criteria_approval', 7],
    );
  });
});

describe('approveCycleCriteria', () => {
  it('stamps criteria_approved_at and moves to searching', async () => {
    const db = mockDb();
    await approveCycleCriteria(db as never, 7);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain('criteria_approved_at = now()');
    expect(sql).toContain("status = 'searching'");
    expect(db.query.mock.calls[0][1]).toEqual([7]);
  });
});

describe('closeSourcedProductCycle', () => {
  it('stamps closed_at and sets status closed', async () => {
    const db = mockDb();
    await closeSourcedProductCycle(db as never, 7);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'closed'");
    expect(sql).toContain('closed_at = now()');
    expect(db.query.mock.calls[0][1]).toEqual([7]);
  });
});
