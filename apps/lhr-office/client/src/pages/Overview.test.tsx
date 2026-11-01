import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

// Passes through to the real hook by default; individual tests can override
// the implementation to force a resource into an error state without
// fighting useApiResource's 3-consecutive-failure threshold (see
// useApiResource.test.ts for that threshold's own coverage).
const useApiResourceMock = vi.fn();
vi.mock('../hooks/useApiResource', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useApiResource')>();
  return { useApiResource: (path: string) => useApiResourceMock(path, actual.useApiResource) };
});

const { Overview } = await import('./Overview');

let sourcedState: { cycle: Record<string, unknown> | null; candidates: Record<string, unknown>[] };

beforeEach(() => {
  vi.clearAllMocks();
  sourcedState = { cycle: null, candidates: [] };
  useApiResourceMock.mockImplementation((path: string, actualHook: typeof import('../hooks/useApiResource').useApiResource) => actualHook(path));
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
    if (path === '/api/sourced-products/cycle') return sourcedState;
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

  it('includes sourced actionable items in the pending count', async () => {
    sourcedState = {
      cycle: { id: 5, status: 'awaiting_final' },
      candidates: [
        { id: 1, status: 'pending_final' },
        { id: 2, status: 'pending_final' },
        { id: 3, status: 'approved' },
      ],
    };
    render(<Overview />);
    // 4 (recipe + affiliate + competitor) + 2 pending_final sourced products = 6
    expect(await screen.findByText('6 item(s) awaiting a decision')).toBeInTheDocument();
  });

  it('counts the sourcing brief awaiting criteria approval as one decision', async () => {
    sourcedState = { cycle: { id: 5, status: 'awaiting_criteria_approval' }, candidates: [] };
    render(<Overview />);
    expect(await screen.findByText('5 item(s) awaiting a decision')).toBeInTheDocument();
  });

  it('shows an alert when a resource fails to load', async () => {
    useApiResourceMock.mockImplementation((path: string, actualHook: typeof import('../hooks/useApiResource').useApiResource) => {
      if (path === '/api/candidates/affiliate') {
        return { data: null, error: 'failed to load affiliate candidates', loading: false, refetch: vi.fn() };
      }
      return actualHook(path);
    });
    render(<Overview />);
    expect(await screen.findByRole('alert')).toHaveTextContent('failed to load affiliate candidates');
  });
});
