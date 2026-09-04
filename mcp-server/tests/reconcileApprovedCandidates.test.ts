import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github', () => ({
  listFiles: vi.fn(),
  commitFilesToMain: vi.fn(),
}));
vi.mock('@lhr/db', () => ({
  getApprovedCandidates: vi.fn(),
  affiliateLinkFilename: vi.fn((c: { asin: string; title: string }) => `${c.title.toLowerCase().replace(/\s+/g, '-')}-${c.asin.slice(-4).toLowerCase()}.json`),
  buildAffiliateLinkFile: vi.fn((c: { asin: string; title: string }, tag: string) => ({
    path: `src/content/affiliate-links/${c.title.toLowerCase().replace(/\s+/g, '-')}-${c.asin.slice(-4).toLowerCase()}.json`,
    content: JSON.stringify({ label: c.title, url: `https://www.amazon.com/dp/${c.asin}?tag=${tag}` }),
  })),
}));

const { listFiles, commitFilesToMain } = await import('../src/github');
const { getApprovedCandidates } = await import('@lhr/db');
const { reconcileApprovedCandidates } = await import('../src/reconcileApprovedCandidates');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reconcileApprovedCandidates', () => {
  it('commits a file for an approved candidate missing one, and skips ones that already have a file', async () => {
    vi.mocked(getApprovedCandidates).mockResolvedValue([
      { asin: 'B0MISSING1', title: 'Missing Item' },
      { asin: 'B0PRESENT1', title: 'Present Item' },
    ] as never);
    vi.mocked(listFiles).mockResolvedValue(['present-item-ent1.json']);

    const result = await reconcileApprovedCandidates({} as never, {} as never, 'lhr-20');

    expect(result.reconciledAsins).toEqual(['B0MISSING1']);
    expect(commitFilesToMain).toHaveBeenCalledTimes(1);
    expect(commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/affiliate-links/missing-item-ing1.json', content: expect.any(String) }],
      expect.stringContaining('Missing Item'),
    );
  });

  it('does nothing when there are no approved candidates', async () => {
    vi.mocked(getApprovedCandidates).mockResolvedValue([]);
    const result = await reconcileApprovedCandidates({} as never, {} as never, 'lhr-20');
    expect(result.reconciledAsins).toEqual([]);
    expect(commitFilesToMain).not.toHaveBeenCalled();
  });

  it('does nothing when every approved candidate already has a file', async () => {
    vi.mocked(getApprovedCandidates).mockResolvedValue([{ asin: 'B0PRESENT1', title: 'Present Item' }] as never);
    vi.mocked(listFiles).mockResolvedValue(['present-item-ent1.json']);
    const result = await reconcileApprovedCandidates({} as never, {} as never, 'lhr-20');
    expect(result.reconciledAsins).toEqual([]);
    expect(commitFilesToMain).not.toHaveBeenCalled();
  });
});
