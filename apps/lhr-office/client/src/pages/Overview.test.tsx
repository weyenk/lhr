import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { Overview } = await import('./Overview');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/jobs') {
      return [
        {
          name: 'recipe-variant-generator',
          cadenceDays: 7,
          history: [{ id: 1, jobName: 'recipe-variant-generator', status: 'success', summary: 'ok', errorMessage: null, startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:05:00.000Z' }],
        },
      ];
    }
    if (path === '/api/candidates/recipe') return { id: 'cand1', record: { status: 'pending', source: { idMeal: '1', title: 'X', cuisine: 'Y', category: 'Z' } } };
    if (path === '/api/candidates/affiliate') return [{ id: 1 }, { id: 2 }];
    if (path === '/api/competitors') return { tracked: [], candidates: [{ id: 9 }], latestReportsByCompetitorId: {} };
    throw new Error(`unexpected path ${path}`);
  });
});

describe('Overview', () => {
  it('renders a job health card and the recent activity feed', async () => {
    render(<Overview />);
    expect(await screen.findByText('recipe-variant-generator')).toBeInTheDocument();
    const successElements = await screen.findAllByText(/success/);
    expect(successElements.length).toBeGreaterThan(0);
  });

  it('computes the badge count across recipe, affiliate, and competitor candidates', async () => {
    render(<Overview />);
    // 1 pending recipe candidate + 2 affiliate + 1 competitor candidate = 4
    expect(await screen.findByText('4 item(s) awaiting a decision')).toBeInTheDocument();
  });
});
