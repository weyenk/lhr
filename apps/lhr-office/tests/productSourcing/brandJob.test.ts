import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getOpenSourcedProductCycle: vi.fn(),
  listSourcedProductCandidates: vi.fn(),
  setCandidateBrandResult: vi.fn(),
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

const { runProductSourcingBrand } = await import('../../src/productSourcing/brandJob');

const POOL = { pool: true };

function cycle(status: string) {
  return { id: 7, status, gatingProfile: 'strict', criteriaJson: {}, criteriaApprovedAt: new Date(), startedAt: new Date(), closedAt: null };
}

function candidate(id: number) {
  return { id, cycleId: 7, title: `Item ${id}`, sourceUrl: `https://alibaba.com/p/${id}`, platform: 'alibaba.com', moq: null, unitCostCents: null, notes: null, status: 'monetize_confirmed' };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('branding'));
  dbMock.listSourcedProductCandidates.mockResolvedValue([candidate(1), candidate(2)]);
  githubMock.getFile.mockImplementation(async (_c: unknown, path: string) => ({
    content: path === 'docs/BRAND.md' ? 'Warm, coastal brand.' : 'You are a design reviewer.',
    sha: 'a',
  }));
  llmMock.callLLM.mockResolvedValue(
    JSON.stringify({
      results: [
        { id: 1, pass: true, rationale: 'On palette.' },
        { id: 2, pass: false, rationale: 'Garish neon.' },
      ],
    }),
  );
});

describe('runProductSourcingBrand', () => {
  it('is blocked when there is no open cycle', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(null);

    const result = await runProductSourcingBrand();

    expect(result).toEqual({ status: 'success', summary: 'blocked: no open cycle' });
    expect(llmMock.callLLM).not.toHaveBeenCalled();
  });

  it.each(['awaiting_criteria_approval', 'awaiting_product_picks', 'awaiting_monetize_approval', 'awaiting_final'])(
    'is blocked waiting for gate when the open cycle is %s',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingBrand();

      expect(result).toEqual({ status: 'success', summary: 'blocked: waiting for gate' });
      expect(llmMock.callLLM).not.toHaveBeenCalled();
      expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    },
  );

  it.each(['drafting_criteria', 'searching', 'monetizing'])(
    'is blocked as cycle not branding when the open cycle is %s',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingBrand();

      expect(result).toEqual({ status: 'success', summary: 'blocked: cycle not branding' });
      expect(llmMock.callLLM).not.toHaveBeenCalled();
      expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    },
  );

  it('processes only monetize_confirmed candidates', async () => {
    await runProductSourcingBrand();

    expect(dbMock.listSourcedProductCandidates).toHaveBeenCalledWith(POOL, 7, 'monetize_confirmed');
  });

  it('moves brand_pass to pending_final, leaves brand_fail terminal, and advances to awaiting_final', async () => {
    const result = await runProductSourcingBrand();

    expect(dbMock.setCandidateBrandResult).toHaveBeenCalledWith(POOL, 1, { pass: true, rationale: 'On palette.' });
    expect(dbMock.setCandidateBrandResult).toHaveBeenCalledWith(POOL, 2, { pass: false, rationale: 'Garish neon.' });
    expect(dbMock.setCandidateStatus).toHaveBeenCalledWith(POOL, 1, 'pending_final');
    expect(dbMock.setCandidateStatus).toHaveBeenCalledWith(POOL, 2, 'brand_fail');
    expect(dbMock.setCycleStatus).toHaveBeenCalledTimes(1);
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'awaiting_final');
    expect(result.status).toBe('success');
  });

  it('uses the designer-experience persona and the brand doc in the prompt', async () => {
    await runProductSourcingBrand();

    expect(githubMock.getFile).toHaveBeenCalledWith({}, '.claude/agents/designer-experience.md', 'main');
    const [messages, options] = llmMock.callLLM.mock.calls[0]!;
    expect(options.persona).toContain('design reviewer');
    const prompt = messages.map((m: { content: string }) => m.content).join('\n');
    expect(prompt).toContain('Warm, coastal brand.');
    expect(prompt).toContain('"id": 1');
  });

  it('advances to awaiting_final even when no candidates pass', async () => {
    llmMock.callLLM.mockResolvedValue(
      JSON.stringify({
        results: [
          { id: 1, pass: false, rationale: 'no' },
          { id: 2, pass: false, rationale: 'no' },
        ],
      }),
    );

    await runProductSourcingBrand();

    expect(dbMock.setCandidateStatus).not.toHaveBeenCalledWith(POOL, expect.anything(), 'pending_final');
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'awaiting_final');
  });

  it('advances to awaiting_final without calling the LLM when there are no candidates', async () => {
    dbMock.listSourcedProductCandidates.mockResolvedValue([]);

    const result = await runProductSourcingBrand();

    expect(llmMock.callLLM).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith(POOL, 7, 'awaiting_final');
    expect(result.status).toBe('success');
  });

  it('throws without mutating when the LLM omits a verdict for a candidate', async () => {
    llmMock.callLLM.mockResolvedValue(JSON.stringify({ results: [{ id: 1, pass: true, rationale: 'ok' }] }));

    await expect(runProductSourcingBrand()).rejects.toThrow();
    expect(dbMock.setCandidateBrandResult).not.toHaveBeenCalled();
    expect(dbMock.setCandidateStatus).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });

  it('throws without mutating when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(runProductSourcingBrand()).rejects.toThrow('GITHUB_TOKEN');
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });
});
