import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { listCompetitorsByStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { default: CandidatesPage } = await import('../src/pages/competitors/candidates/index.astro');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('/competitors/candidates', () => {
  it('renders each pending candidate with approve/reject controls', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      { id: 3, domain: 'new-candidate.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null },
    ]);

    const container = await AstroContainer.create();
    const html = await container.renderToString(CandidatesPage);

    expect(html).toContain('new-candidate.com');
    expect(html).toContain('data-action="approve"');
    expect(html).toContain('data-action="reject"');
  });

  it('shows an empty state when there are no pending candidates', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([]);
    const container = await AstroContainer.create();
    const html = await container.renderToString(CandidatesPage);
    expect(html).toContain('No pending candidates');
  });
});
