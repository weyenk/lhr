import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = {
  getOpenSourcedProductCycle: vi.fn(),
  insertSourcedProductCandidate: vi.fn(),
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

const serpMock = { fetchSearchResults: vi.fn() };
vi.mock('../../src/serpapiSearch.js', () => serpMock);

const { runProductSourcingSearch } = await import('../../src/productSourcing/searchJob');

const CRITERIA = {
  keywords: ['linen napkins', 'stoneware bowl'],
  platforms: ['alibaba.com', 'dhgate.com'],
  aestheticNotes: 'Warm, coastal.',
  categoryHints: ['serveware'],
};

function cycle(status: string, criteria: unknown = CRITERIA) {
  return { id: 7, status, gatingProfile: 'strict', criteriaJson: criteria, criteriaApprovedAt: new Date(), startedAt: new Date(), closedAt: null };
}

function hit(n: number, domain = 'alibaba.com') {
  return { position: n, title: `Item ${n}`, link: `https://www.${domain}/p/${n}`, domain };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('searching'));
  dbMock.insertSourcedProductCandidate.mockImplementation(async (_db, c) => ({ id: 1, ...c }));
  githubMock.getFile.mockResolvedValue({ content: 'You are a sourcing scout.', sha: 'a' });
  serpMock.fetchSearchResults.mockResolvedValue([]);
  llmMock.callLLM.mockResolvedValue(JSON.stringify({ annotations: [] }));
});

describe('runProductSourcingSearch', () => {
  it.each(['drafting_criteria', 'awaiting_criteria_approval', 'awaiting_product_picks', 'monetizing'])(
    'is blocked without mutation when the open cycle is %s',
    async (status) => {
      dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle(status));

      const result = await runProductSourcingSearch();

      expect(result.status).toBe('success');
      expect(result.summary).toMatch(/^blocked/);
      expect(serpMock.fetchSearchResults).not.toHaveBeenCalled();
      expect(dbMock.insertSourcedProductCandidate).not.toHaveBeenCalled();
      expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
    },
  );

  it('is blocked when there is no open cycle', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(null);

    const result = await runProductSourcingSearch();

    expect(result.summary).toMatch(/^blocked/);
    expect(serpMock.fetchSearchResults).not.toHaveBeenCalled();
  });

  it('inserts sourced candidates from SerpAPI hits and advances to awaiting_product_picks', async () => {
    serpMock.fetchSearchResults.mockImplementation(async (q: string) =>
      q.includes('alibaba.com') ? [hit(1), hit(2)] : [hit(3, 'dhgate.com')],
    );

    const result = await runProductSourcingSearch();

    expect(serpMock.fetchSearchResults).toHaveBeenCalledWith('linen napkins site:alibaba.com', 8);
    // 4 queries; alibaba returns the same 2 URLs for both keywords, dhgate the same 1 → 3 unique candidates.
    expect(dbMock.insertSourcedProductCandidate).toHaveBeenCalledTimes(3);
    const inserted = dbMock.insertSourcedProductCandidate.mock.calls.map((c) => c[1]);
    expect(inserted).toContainEqual(
      expect.objectContaining({ cycleId: 7, title: 'Item 1', sourceUrl: 'https://www.alibaba.com/p/1', platform: 'alibaba.com', moq: null, unitCostCents: null }),
    );
    expect(inserted).toContainEqual(expect.objectContaining({ sourceUrl: 'https://www.dhgate.com/p/3', platform: 'dhgate.com' }));
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith({ pool: true }, 7, 'awaiting_product_picks');
    expect(result.status).toBe('success');
  });

  it('caps the run at 6 queries with 8 results each', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(
      cycle('searching', { ...CRITERIA, keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    );

    await runProductSourcingSearch();

    expect(serpMock.fetchSearchResults).toHaveBeenCalledTimes(6);
    for (const call of serpMock.fetchSearchResults.mock.calls) expect(call[1]).toBe(8);
  });

  it('defaults platforms to alibaba.com and dhgate.com when criteria has none', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(
      cycle('searching', { ...CRITERIA, keywords: ['mug'], platforms: [] }),
    );

    await runProductSourcingSearch();

    expect(serpMock.fetchSearchResults.mock.calls.map((c) => c[0])).toEqual([
      'mug site:alibaba.com',
      'mug site:dhgate.com',
    ]);
  });

  it('moves to awaiting_product_picks with a success summary when there are no hits', async () => {
    const result = await runProductSourcingSearch();

    expect(dbMock.insertSourcedProductCandidate).not.toHaveBeenCalled();
    expect(llmMock.callLLM).not.toHaveBeenCalled();
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith({ pool: true }, 7, 'awaiting_product_picks');
    expect(result.status).toBe('success');
    expect(result.summary).toContain('0');
  });

  it('skips duplicate URLs (insert returns null) without failing', async () => {
    serpMock.fetchSearchResults.mockResolvedValue([hit(1)]);
    dbMock.insertSourcedProductCandidate.mockResolvedValue(null);

    const result = await runProductSourcingSearch();

    expect(result.status).toBe('success');
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith({ pool: true }, 7, 'awaiting_product_picks');
  });

  it('dedupes the same URL returned by multiple queries', async () => {
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('searching', { ...CRITERIA, platforms: ['alibaba.com'] }));
    serpMock.fetchSearchResults.mockResolvedValue([hit(1)]);

    await runProductSourcingSearch();

    expect(dbMock.insertSourcedProductCandidate).toHaveBeenCalledTimes(1);
  });

  it('applies LLM annotations and tells the model not to fabricate', async () => {
    serpMock.fetchSearchResults.mockResolvedValue([hit(1)]);
    dbMock.getOpenSourcedProductCycle.mockResolvedValue(cycle('searching', { ...CRITERIA, keywords: ['mug'], platforms: ['alibaba.com'] }));
    llmMock.callLLM.mockResolvedValue(
      JSON.stringify({ annotations: [{ index: 0, notes: 'Matte glaze, fits coastal look.', moq: null, unitCostCents: null }] }),
    );

    await runProductSourcingSearch();

    const [messages, options] = llmMock.callLLM.mock.calls[0]!;
    expect(options.persona).toContain('sourcing scout');
    expect(messages.map((m: { content: string }) => m.content).join('\n')).toMatch(/null/i);
    expect(dbMock.insertSourcedProductCandidate).toHaveBeenCalledWith(
      { pool: true },
      expect.objectContaining({ notes: 'Matte glaze, fits coastal look.', moq: null, unitCostCents: null }),
    );
  });

  it('returns partial but keeps rows when the LLM fails after retry', async () => {
    serpMock.fetchSearchResults.mockResolvedValue([hit(1)]);
    llmMock.callLLM.mockResolvedValue('not json');

    const result = await runProductSourcingSearch();

    expect(llmMock.callLLM).toHaveBeenCalledTimes(2);
    expect(dbMock.insertSourcedProductCandidate).toHaveBeenCalled();
    expect(dbMock.setCycleStatus).toHaveBeenCalledWith({ pool: true }, 7, 'awaiting_product_picks');
    expect(result.status).toBe('partial');
  });

  it('throws without mutating when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(runProductSourcingSearch()).rejects.toThrow('GITHUB_TOKEN');
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });

  it('leaves the cycle in searching when a SerpAPI query fails', async () => {
    serpMock.fetchSearchResults.mockRejectedValue(new Error('boom'));

    await expect(runProductSourcingSearch()).rejects.toThrow('boom');
    expect(dbMock.setCycleStatus).not.toHaveBeenCalled();
  });
});
