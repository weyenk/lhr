import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { listKeywords: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { default: KeywordsPage } = await import('../src/pages/competitors/keywords/index.astro');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('/competitors/keywords', () => {
  it('renders the keyword list with remove controls and an add form', async () => {
    dbMock.listKeywords.mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }]);

    const container = await AstroContainer.create();
    const html = await container.renderToString(KeywordsPage);

    expect(html).toContain('gluten free dinner recipes');
    expect(html).toContain('data-action="remove"');
    expect(html).toContain('<form');
  });

  it('shows an empty state when there are no keywords yet', async () => {
    dbMock.listKeywords.mockResolvedValue([]);
    const container = await AstroContainer.create();
    const html = await container.renderToString(KeywordsPage);
    expect(html).toContain('No SEO keywords yet');
  });
});
