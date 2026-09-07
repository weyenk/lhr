import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

const { Approvals } = await import('./Approvals');

function mockData() {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/candidates/recipe') return { id: 'cand1', record: { status: 'pending', source: { idMeal: '1', title: 'Teriyaki Chicken', cuisine: 'Japanese', category: 'Chicken' } } };
    if (path === '/api/candidates/affiliate') return [{ id: 1, title: 'Cast Iron Skillet' }];
    if (path === '/api/competitors') return { tracked: [], candidates: [{ id: 9, domain: 'other.com' }], latestReportsByCompetitorId: {} };
    return { ok: true };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockData();
  useApiResourceMock.mockImplementation((path: string, actualHook: typeof import('../hooks/useApiResource').useApiResource) => actualHook(path));
});

describe('Approvals', () => {
  it('approves the recipe candidate and refetches', async () => {
    render(<Approvals />);
    // Three "Approve" buttons render (recipe/affiliate/competitor sections) — the recipe
    // candidate's is the first, since that section renders first.
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/candidates/recipe/cand1/approve', { method: 'POST' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/candidates/recipe'));
  });

  it('shows an error banner when an action fails', async () => {
    render(<Approvals />);
    apiFetchMock.mockRejectedValueOnce(new Error('boom'));
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('shows an alert when a resource fails to load', async () => {
    useApiResourceMock.mockImplementation((path: string, actualHook: typeof import('../hooks/useApiResource').useApiResource) => {
      if (path === '/api/candidates/affiliate') {
        return { data: null, error: 'failed to load affiliate candidates', loading: false, refetch: vi.fn() };
      }
      return actualHook(path);
    });
    render(<Approvals />);
    expect(await screen.findByRole('alert')).toHaveTextContent('failed to load affiliate candidates');
  });
});
