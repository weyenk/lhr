import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = { getProposalById: vi.fn(), markProposalStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(),
  commitFilesToMain: vi.fn(),
};
vi.mock('@lhr/github', () => githubMock);

const contentMock = { applyProductPlacement: vi.fn() };
vi.mock('@lhr/content', async () => {
  const actual = await vi.importActual<typeof import('@lhr/content')>('@lhr/content');
  return { ...actual, applyProductPlacement: contentMock.applyProductPlacement };
});

// contentMock must be initialized above before this dynamic import runs, since it triggers the
// vi.mock factory for '@lhr/content' (vi.mock calls are hoisted for registration, but the factory
// itself only executes when the module is first resolved).
const { StaleImageTargetError } = await import('@lhr/content');

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/product-placements/[id]/approve');

const pendingProposal = {
  id: 1, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
  targetImageKind: 'body' as const, targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending' as const, decidedAt: null, createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
  process.env.AUTHOR_GITHUB_TOKEN = 'test-token';
  githubMock.getFile.mockResolvedValue({ content: 'raw-mdx', sha: 'a' });
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/product-placements/[id]/approve', () => {
  it('returns 503 when the session gate is not configured, without touching the database', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(503);
    expect(dbMock.getProposalById).not.toHaveBeenCalled();
  });

  it('commits the updated post and marks the proposal approved', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    contentMock.applyProductPlacement.mockReturnValue('updated-mdx');

    const res = await POST(makeContext('1'));

    expect(res.status).toBe(200);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'approved');
    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/posts/pizza.mdx', content: 'updated-mdx' }],
      expect.stringContaining('wooden-pizza-server-1234'),
    );
  });

  it('marks the proposal stale and does not commit when the target has changed', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    contentMock.applyProductPlacement.mockImplementation(() => {
      throw new StaleImageTargetError();
    });

    const res = await POST(makeContext('1'));

    expect(res.status).toBe(409);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'stale');
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown proposal', async () => {
    dbMock.getProposalById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for a proposal that is already decided', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'approved' });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 409 for a proposal with no composited image', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, compositedImageUrl: null });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });

  it('returns 502 but leaves the proposal approved when the commit fails', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    contentMock.applyProductPlacement.mockReturnValue('updated-mdx');
    githubMock.commitFilesToMain.mockRejectedValue(new Error('commit failed'));

    const res = await POST(makeContext('1'));

    expect(res.status).toBe(502);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'approved');
    expect(dbMock.markProposalStatus).not.toHaveBeenCalledWith(mockPool, 1, 'stale');
  });
});
