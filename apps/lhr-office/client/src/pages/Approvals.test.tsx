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

type SourcedState = { cycle: Record<string, unknown> | null; candidates: Record<string, unknown>[] };
let sourcedState: SourcedState = { cycle: null, candidates: [] };

function sourcedCycle(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 5,
    status,
    criteriaJson: { keywords: ['linen apron', 'ceramic bowl'], platforms: ['etsy.com'], aestheticNotes: 'warm', categoryHints: [] },
    ...extra,
  };
}

function sourcedCandidate(id: number, status: string, title = `Product ${id}`) {
  return { id, cycleId: 5, title, status, sourceUrl: `https://x.test/${id}`, platform: 'etsy.com', monetizeRationale: `why ${id}` };
}

function mockData() {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/sourced-products/cycle') return sourcedState;
    if (path === '/api/candidates/recipe') return { id: 'cand1', record: { status: 'pending', source: { idMeal: '1', title: 'Teriyaki Chicken', cuisine: 'Japanese', category: 'Chicken' } } };
    if (path === '/api/candidates/affiliate') return [{ id: 1, title: 'Cast Iron Skillet' }];
    if (path === '/api/competitors') return { tracked: [], candidates: [{ id: 9, domain: 'other.com' }], latestReportsByCompetitorId: {} };
    return { ok: true };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sourcedState = { cycle: null, candidates: [] };
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

  describe('Sourced products', () => {
    it('shows an empty state when there is no open cycle', async () => {
      render(<Approvals />);
      expect(await screen.findByText('No open sourcing cycle')).toBeInTheDocument();
    });

    it('shows criteria keywords on the Brief tab and approves them', async () => {
      sourcedState = { cycle: sourcedCycle('awaiting_criteria_approval'), candidates: [] };
      render(<Approvals />);
      expect(await screen.findByText('linen apron')).toBeInTheDocument();
      expect(screen.getByText('ceramic bowl')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Approve brief' }));
      await waitFor(() =>
        expect(apiFetchMock).toHaveBeenCalledWith('/api/sourced-products/cycle/5/criteria/approve', { method: 'POST' }),
      );
    });

    it('advances selected candidates from the Pick tab and skips the rest', async () => {
      sourcedState = {
        cycle: sourcedCycle('awaiting_product_picks'),
        candidates: [sourcedCandidate(1, 'sourced', 'Linen Apron'), sourcedCandidate(2, 'sourced', 'Bowl'), sourcedCandidate(3, 'picked')],
      };
      render(<Approvals />);
      fireEvent.click(await screen.findByLabelText('Linen Apron'));
      expect(screen.queryByText('Product 3')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Advance selected' }));
      await waitFor(() =>
        expect(apiFetchMock).toHaveBeenCalledWith('/api/sourced-products/cycle/5/candidates/pick', {
          method: 'POST',
          body: JSON.stringify({ pickIds: [1], skipIds: [2] }),
        }),
      );
    });

    it('confirms monetize passes and drops unchecked ones', async () => {
      sourcedState = {
        cycle: sourcedCycle('awaiting_monetize_approval'),
        candidates: [sourcedCandidate(1, 'monetize_pass', 'Linen Apron'), sourcedCandidate(2, 'monetize_pass', 'Bowl'), sourcedCandidate(3, 'monetize_fail')],
      };
      render(<Approvals />);
      fireEvent.click(await screen.findByLabelText('Bowl'));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm selected' }));
      await waitFor(() =>
        expect(apiFetchMock).toHaveBeenCalledWith('/api/sourced-products/cycle/5/monetize/confirm', {
          method: 'POST',
          body: JSON.stringify({ confirmIds: [1], dropIds: [2] }),
        }),
      );
    });

    it('approves and denies pending_final candidates on the Final tab', async () => {
      sourcedState = { cycle: sourcedCycle('awaiting_final'), candidates: [sourcedCandidate(7, 'pending_final', 'Final Mug')] };
      render(<Approvals />);
      expect(await screen.findByText('Final Mug')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Approve Final Mug' }));
      await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/sourced-products/candidates/7/approve', { method: 'POST' }));
      fireEvent.click(screen.getByRole('button', { name: 'Deny Final Mug' }));
      await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/sourced-products/candidates/7/deny', { method: 'POST' }));
    });

    it('says nothing is at this stage when the active tab has no candidates', async () => {
      sourcedState = { cycle: sourcedCycle('awaiting_product_picks'), candidates: [] };
      render(<Approvals />);
      expect(await screen.findByText('Nothing at this stage')).toBeInTheDocument();
    });
  });
});
