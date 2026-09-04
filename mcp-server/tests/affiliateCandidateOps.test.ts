import { describe, expect, it, vi, beforeEach } from 'vitest';

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  commitFilesToMain: vi.fn(),
};
vi.mock('../src/github', () => githubMock);

const dbMock = {
  getCandidateById: vi.fn(),
  markCandidateStatus: vi.fn(),
  insertDecisionHistory: vi.fn(),
  buildAffiliateLinkFile: vi.fn(() => ({ path: 'src/content/affiliate-links/test-item-ple1.json', content: '{}' })),
};
vi.mock('@lhr/db', () => dbMock);

const { approveAffiliateCandidate, denyAffiliateCandidate, CandidateNotFoundError, CandidateAlreadyDecidedError } =
  await import('../src/affiliateCandidateOps');

const db = { query: vi.fn() } as never;

const pendingCandidate = {
  id: 1, cycleId: '2026-W35', asin: 'B0EXAMPLE1', title: 'Test Item', category: 'Kitchen', priceCents: 2999,
  imageUrl: 'https://example.com/x.jpg', productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03, commissionRateIsFallback: false, estimatedMonthlySales: 100,
  status: 'pending' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.buildAffiliateLinkFile.mockReturnValue({
    path: 'src/content/affiliate-links/test-item-ple1.json',
    content: '{}',
  });
});

describe('approveAffiliateCandidate', () => {
  it('commits an affiliate-links file, marks approved, and records the decision', async () => {
    dbMock.getCandidateById.mockResolvedValue(pendingCandidate);

    const result = await approveAffiliateCandidate(db, 'test-token', 'lhr-20', 1);

    expect(dbMock.buildAffiliateLinkFile).toHaveBeenCalledWith(pendingCandidate, 'lhr-20');
    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/affiliate-links/test-item-ple1.json', content: '{}' }],
      expect.stringContaining('Test Item'),
    );
    expect(dbMock.markCandidateStatus).toHaveBeenCalledWith(db, 1, 'approved');
    expect(dbMock.insertDecisionHistory).toHaveBeenCalledWith(db, {
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999,
      commissionRate: 0.03, estimatedMonthlySales: 100, decision: 'approved',
    });
    expect(result).toEqual({ asin: 'B0EXAMPLE1', title: 'Test Item', path: 'src/content/affiliate-links/test-item-ple1.json' });
  });

  it('throws CandidateNotFoundError for an unknown candidate, without writing anything', async () => {
    dbMock.getCandidateById.mockResolvedValue(null);
    await expect(approveAffiliateCandidate(db, 'test-token', 'lhr-20', 999)).rejects.toThrow(CandidateNotFoundError);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(dbMock.markCandidateStatus).not.toHaveBeenCalled();
  });

  it('throws CandidateAlreadyDecidedError for a candidate that is already decided', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, status: 'denied' });
    await expect(approveAffiliateCandidate(db, 'test-token', 'lhr-20', 1)).rejects.toThrow(CandidateAlreadyDecidedError);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(dbMock.markCandidateStatus).not.toHaveBeenCalled();
  });

  it('leaves the candidate pending when the GitHub commit fails', async () => {
    dbMock.getCandidateById.mockResolvedValue(pendingCandidate);
    githubMock.commitFilesToMain.mockRejectedValue(new Error('GitHub down'));
    await expect(approveAffiliateCandidate(db, 'test-token', 'lhr-20', 1)).rejects.toThrow('GitHub down');
    expect(dbMock.markCandidateStatus).not.toHaveBeenCalled();
    expect(dbMock.insertDecisionHistory).not.toHaveBeenCalled();
  });
});

describe('denyAffiliateCandidate', () => {
  it('marks denied and records the decision, with no GitHub write', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, id: 2, asin: 'B0EXAMPLE2', estimatedMonthlySales: null });

    const result = await denyAffiliateCandidate(db, 2);

    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(dbMock.markCandidateStatus).toHaveBeenCalledWith(db, 2, 'denied');
    expect(dbMock.insertDecisionHistory).toHaveBeenCalledWith(db, {
      asin: 'B0EXAMPLE2', category: 'Kitchen', priceCents: 2999,
      commissionRate: 0.03, estimatedMonthlySales: null, decision: 'denied',
    });
    expect(result).toEqual({ asin: 'B0EXAMPLE2', title: 'Test Item' });
  });

  it('throws CandidateNotFoundError for an unknown candidate', async () => {
    dbMock.getCandidateById.mockResolvedValue(null);
    await expect(denyAffiliateCandidate(db, 999)).rejects.toThrow(CandidateNotFoundError);
    expect(dbMock.markCandidateStatus).not.toHaveBeenCalled();
  });

  it('throws CandidateAlreadyDecidedError for a candidate that is already decided', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, status: 'approved' });
    await expect(denyAffiliateCandidate(db, 1)).rejects.toThrow(CandidateAlreadyDecidedError);
    expect(dbMock.markCandidateStatus).not.toHaveBeenCalled();
  });
});
