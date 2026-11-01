import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getOpenSourcedProductCycle: vi.fn(),
  listSourcedProductCandidates: vi.fn(),
  setCandidateMonetizeResult: vi.fn(),
  setCandidateStatus: vi.fn(),
  setCycleStatus: vi.fn(),
  getPool: vi.fn(() => ({ pool: true })),
};
vi.mock('@lhr/db', () => dbMock);

const llmMock = { callLLM: vi.fn() };
vi.mock('@lhr/llm', () => llmMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(),
};
vi.mock('lhr-authoring-mcp-server/dist-lib/github.js', () => githubMock);

// resolveProse hits the DB (getJobTuning) to look up a prose override; this test suite is not
// exercising that lookup, so stub it to always fall through to the hardcoded default it's given.
vi.mock('../../src/resolveJobTuning.js', () => ({
  resolveProse: vi.fn(async (_db: unknown, _jobName: string, _key: string, fallback: string) => fallback),
}));

const { runProductSourcingMonetize } = await import('../../src/productSourcing/monetizeJob');

const POOL = { pool: true };

function cycle(status: string, gatingProfile = 'strict') {
  return { id: 7, status, gatingProfile, criteriaJson: {}, criteriaApprovedAt: new Date(), startedAt: new Date(), closedAt: null };
}

function candidate(id: number) {
  return { id, cycleId: 7, title: `Item ${id}`, sourceUrl: `https://alibaba.com/p/${id}`, platform: 'alibaba.com', moq: '100', unitCostCents: 250, notes: 'nice', status: 'picked' };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.PRODUCT_SOURCING_GATING_PROFILE = 'strict';
  dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('monetizing'));
  dbMock.listSourcedProductCandidates.mockResolvedValue([candidate(1), candidate(2)]);
  githubMock.getFile.mockResolvedValue({ content: 'You are a monetization scout.', sha: 'a' });
  llmMock.callLLM.mockResolvedValue(
    JSON.stringify({
      results: [
        { id: 1, pass: true, rationale: 'Good margin.' },
        { id: 2, pass: false, rationale: 'MOQ too high.' },
      ],
    }),
  );
});

describe('runProductSourcingMonetize', () => {
  it('is blocked when there is no open cycle', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(null);

    const result = await runProductSourcingMonetize();

    expect(result).toEqual({ status: 'success', summary: 'blocked: no open cycle' });
    expect(llmMock.callLLM).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });

  it.each(['awaiting_criteria_approval', 'awaiting_product_picks', 'awaiting_monetize_approval', 'awaiting_final'])(
    'is blocked waiting for gate when the open cycle is %s',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingMonetize();

      expect(result).toEqual({ status: 'success', summary: 'blocked: waiting for gate' });
      expect(llmMock.callLLM).not.toHaveBeenCalled();
      expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    },
  );

  it.each(['drafting_criteria', 'searching', 'branding'])(
    'is blocked as cycle not monetizing when the open cycle is %s',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingMonetize();

      expect(result).toEqual({ status: 'success', summary: 'blocked: cycle not monetizing' });
      expect(llmMock.callLLM).not.toHaveBeenCalled();
      expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    },
  );

  it('processes only picked candidates', async () => {
    await runProductSourcingMonetize();

    expect(dbMock.listSourcedProductCandidates).toHaveBeenCalledWith(POOL, 7, 'picked');
  });

  it('writes pass/fail results and statuses, then waits for approval under strict gating', async () => {
    const result = await runProductSourcingMonetize();

    expect(dbMock.setCandidateMonetizeResult).toHaveBeenCalledWith(POOL, 1, { pass: true, rationale: 'Good margin.' });
    expect(dbMock.setCandidateMonetizeResult).toHaveBeenCalledWith(POOL, 2, { pass: false, rationale: 'MOQ too high.' });
    expect(dbMock.setCandidateStatus).toHaveBeenCalledWith(POOL, 1, 'monetize_pass');
    expect(dbMock.setCandidateStatus).toHaveBeenCalledWith(POOL, 2, 'monetize_fail');
    expect(dbMock.setCandidateStatus).not.toHaveBeenCalledWith(POOL, 1, 'monetize_confirmed');
    expect(dbMock.setCycleStatus).toHaveBeenCalledTimes(1);
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'awaiting_monetize_approval');
    expect(result.status).toBe('success');
  });

  it('uses the monetization-scout persona and scopes the prompt to wholesale sellability, not affiliate', async () => {
    await runProductSourcingMonetize();

    expect(githubMock.getFile).toHaveBeenCalledWith({}, '.claude/agents/monetization-scout.md', 'main');
    const [messages, options] = llmMock.callLLM.mock.calls[0]!;
    expect(options.persona).toContain('monetization scout');
    const prompt = messages.map((m: { content: string }) => m.content).join('\n');
    expect(prompt).toMatch(/wholesale/i);
    expect(prompt).toMatch(/do not.*affiliate/i);
    expect(prompt).toContain('"id": 1');
  });

  it('auto-confirms monetize_pass candidates and advances to branding when the cycle snapshot is trust', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('monetizing', 'trust'));
    // env says strict; the cycle's snapshot must win.
    process.env.PRODUCT_SOURCING_GATING_PROFILE = 'strict';

    await runProductSourcingMonetize();

    expect(dbMock.setCandidateStatus).toHaveBeenCalledWith(POOL, 1, 'monetize_confirmed');
    expect(dbMock.setCandidateStatus).not.toHaveBeenCalledWith(POOL, 2, 'monetize_confirmed');
    expect(dbMock.setCandidateStatus).toHaveBeenCalledWith(POOL, 2, 'monetize_fail');
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'branding');
  });

  it('stays strict when the cycle snapshot is strict even if env says trust', async () => {
    process.env.PRODUCT_SOURCING_GATING_PROFILE = 'trust';

    await runProductSourcingMonetize();

    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'awaiting_monetize_approval');
  });

  it('advances without calling the LLM when there are no picked candidates', async () => {
    dbMock.listSourcedProductCandidates.mockResolvedValue([]);

    const result = await runProductSourcingMonetize();

    expect(llmMock.callLLM).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'awaiting_monetize_approval');
    expect(result.status).toBe('success');
  });

  it('throws without mutating when the LLM omits a verdict for a candidate', async () => {
    llmMock.callLLM.mockResolvedValue(JSON.stringify({ results: [{ id: 1, pass: true, rationale: 'ok' }] }));

    await expect(runProductSourcingMonetize()).rejects.toThrow();
    expect(llmMock.callLLM).toHaveBeenCalledTimes(2);
    expect(dbMock.setCandidateMonetizeResult).not.toHaveBeenCalled();
    expect(dbMock.setCandidateStatus).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });

  it('throws without mutating when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(runProductSourcingMonetize()).rejects.toThrow('GITHUB_TOKEN');
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });
});
