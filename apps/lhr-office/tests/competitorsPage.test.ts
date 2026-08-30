import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { listCompetitorsByStatus: vi.fn(), getLatestReport: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { default: CompetitorsPage } = await import('../src/pages/competitors/index.astro');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('/competitors', () => {
  it('renders each tracked competitor with its latest report summary', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      { id: 1, domain: 'reliable-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ]);
    dbMock.getLatestReport.mockResolvedValue({
      id: 1, competitorId: 1, cycleId: '2026-W35', generatedAt: new Date('2026-08-24T00:00:00Z'),
      newContent: [], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y',
      summary: 'Published one new post this week.',
    });

    const container = await AstroContainer.create();
    const html = await container.renderToString(CompetitorsPage);

    expect(html).toContain('reliable-recipes.com');
    expect(html).toContain('Published one new post this week.');
  });

  it('shows a placeholder when a tracked competitor has no report yet', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      { id: 2, domain: 'brand-new.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ]);
    dbMock.getLatestReport.mockResolvedValue(null);

    const container = await AstroContainer.create();
    const html = await container.renderToString(CompetitorsPage);

    expect(html).toContain('brand-new.com');
    expect(html).toContain('No report yet');
  });

  it('is gated by requireAdminSession', async () => {
    const container = await AstroContainer.create();
    dbMock.listCompetitorsByStatus.mockResolvedValue([]);
    await container.renderToString(CompetitorsPage);
    expect(authMock.requireAdminSession).toHaveBeenCalled();
  });
});
