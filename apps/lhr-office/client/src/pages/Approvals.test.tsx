import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

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
});
