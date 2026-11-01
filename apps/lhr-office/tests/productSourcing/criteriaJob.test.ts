import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  createSourcedProductCycle: vi.fn(),
  getOpenSourcedProductCycle: vi.fn(),
  setCycleCriteria: vi.fn(),
  setCycleStatus: vi.fn(),
  approveCycleCriteria: vi.fn(),
  getPool: vi.fn(() => ({ pool: true })),
};
vi.mock('@lhr/db', () => dbMock);

const llmMock = { callLLM: vi.fn() };
vi.mock('@lhr/llm', () => llmMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(),
  listFiles: vi.fn(),
};
vi.mock('lhr-authoring-mcp-server/dist-lib/github.js', () => githubMock);

const { runProductSourcingCriteria } = await import('../../src/productSourcing/criteriaJob');

const CRITERIA = {
  keywords: ['linen napkins', 'stoneware bowl'],
  platforms: ['alibaba.com', 'dhgate.com'],
  aestheticNotes: 'Warm, coastal, matte glazes.',
  categoryHints: ['serveware'],
};

function cycle(status: string, gatingProfile: 'strict' | 'trust' = 'strict') {
  return { id: 7, status, gatingProfile, criteriaJson: null, criteriaApprovedAt: null, startedAt: new Date(), closedAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PRODUCT_SOURCING_GATING_PROFILE;
  process.env.GITHUB_TOKEN = 'test-token';
  dbMock.getOpenSourcedProductCycle.mockResolvedValue(null);
  dbMock.createSourcedProductCycle.mockImplementation(async (_db, input) => cycle('drafting_criteria', input.gatingProfile));
  githubMock.getFile.mockImplementation(async (_client: unknown, path: string) => {
    if (path === '.claude/agents/designer-experience.md') return { content: 'You are a designer.', sha: 'a' };
    if (path === 'docs/BRAND.md') return { content: '# Brand\nWarm and coastal.', sha: 'b' };
    if (path === 'src/content/products/coastal-blue-platter.json') {
      return { content: JSON.stringify({ name: 'Coastal Blue Serving Platter' }), sha: 'c' };
    }
    return null;
  });
  githubMock.listFiles.mockResolvedValue(['coastal-blue-platter.json', 'README.md']);
  llmMock.callLLM.mockResolvedValue(JSON.stringify(CRITERIA));
});

describe('runProductSourcingCriteria', () => {
  it('creates a cycle, stores criteria and waits for approval under strict gating', async () => {
    const result = await runProductSourcingCriteria();

    expect(dbMock.createSourcedProductCycle).toHaveBeenCalledWith({ pool: true }, { gatingProfile: 'strict' });
    expect(dbMock.setCycleCriteria).toHaveBeenCalledWith({ pool: true }, 7, CRITERIA);
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith({ pool: true }, 7, 'awaiting_criteria_approval');
    expect(dbMock.approveCycleCriteria).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('auto-approves criteria under trust gating', async () => {
    process.env.PRODUCT_SOURCING_GATING_PROFILE = 'trust';

    const result = await runProductSourcingCriteria();

    expect(dbMock.createSourcedProductCycle).toHaveBeenCalledWith({ pool: true }, { gatingProfile: 'trust' });
    expect(dbMock.setCycleCriteria).toHaveBeenCalledWith({ pool: true }, 7, CRITERIA);
    expect(dbMock.approveCycleCriteria).toHaveBeenCalledWith({ pool: true }, 7);
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('includes persona, brand doc and existing product names in the LLM call', async () => {
    await runProductSourcingCriteria();

    const [messages, options] = llmMock.callLLM.mock.calls[0]!;
    expect(options.persona).toContain('You are a designer.');
    const prompt = messages.map((m: { content: string }) => m.content).join('\n');
    expect(prompt).toContain('Warm and coastal.');
    expect(prompt).toContain('Coastal Blue Serving Platter');
  });

  it.each(['awaiting_product_picks', 'awaiting_monetize_approval', 'awaiting_final'])(
    'is blocked waiting for a gate when the open cycle is %s',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingCriteria();

      expect(result).toEqual({ status: 'success', summary: 'blocked: waiting for gate' });
      expect(llmMock.callLLM).not.toHaveBeenCalled();
      expect(dbMock.createSourcedProductCycle).not.toHaveBeenCalled();
      expect(dbMock.setCycleCriteria).not.toHaveBeenCalled();
      expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
      expect(dbMock.approveCycleCriteria).not.toHaveBeenCalled();
    },
  );

  it.each(['searching', 'monetizing', 'branding'])('is blocked as busy when the open cycle is %s', async (status) => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

    const result = await runProductSourcingCriteria();

    expect(result).toEqual({ status: 'success', summary: 'blocked: cycle busy' });
    expect(llmMock.callLLM).not.toHaveBeenCalled();
    expect(dbMock.setCycleCriteria).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });

  it.each(['drafting_criteria', 'awaiting_criteria_approval'])(
    're-runs criteria for the open cycle in %s without creating a new one',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingCriteria();

      expect(dbMock.createSourcedProductCycle).not.toHaveBeenCalled();
      expect(dbMock.setCycleCriteria).toHaveBeenCalledWith({ pool: true }, 7, CRITERIA);
      expect(dbMock.setCycleStatus).toHaveBeenCalledWith({ pool: true }, 7, 'awaiting_criteria_approval');
      expect(result.status).toBe('success');
    },
  );

  it("uses the open cycle's own gating profile when re-running", async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('awaiting_criteria_approval', 'trust'));

    await runProductSourcingCriteria();

    expect(dbMock.approveCycleCriteria).toHaveBeenCalledWith({ pool: true }, 7);
  });

  it('retries once on malformed LLM JSON, then accepts a fenced reply', async () => {
    llmMock.callLLM.mockResolvedValueOnce('not json').mockResolvedValueOnce('```json\n' + JSON.stringify(CRITERIA) + '\n```');

    const result = await runProductSourcingCriteria();

    expect(llmMock.callLLM).toHaveBeenCalledTimes(2);
    expect(dbMock.setCycleCriteria).toHaveBeenCalledWith({ pool: true }, 7, CRITERIA);
    expect(result.status).toBe('success');
  });

  it('rejects criteria that violate the locked shape and does not advance the cycle', async () => {
    llmMock.callLLM.mockResolvedValue(JSON.stringify({ ...CRITERIA, keywords: [] }));

    await expect(runProductSourcingCriteria()).rejects.toThrow();

    expect(dbMock.setCycleCriteria).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    expect(dbMock.approveCycleCriteria).not.toHaveBeenCalled();
  });

  it('rejects platforms that include a scheme', async () => {
    llmMock.callLLM.mockResolvedValue(JSON.stringify({ ...CRITERIA, platforms: ['https://alibaba.com'] }));

    await expect(runProductSourcingCriteria()).rejects.toThrow();
    expect(dbMock.setCycleCriteria).not.toHaveBeenCalled();
  });
});
