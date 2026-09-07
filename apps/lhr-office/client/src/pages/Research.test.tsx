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

const { Research } = await import('./Research');

beforeEach(() => {
  vi.clearAllMocks();
  useApiResourceMock.mockImplementation((path: string, actualHook: typeof import('../hooks/useApiResource').useApiResource) => actualHook(path));
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/trends') {
      return {
        reports: [{ id: 1, category: 'cooking', cycleId: 'c1', summary: 'sourdough is trending' }],
        topics: [{ id: 5, category: 'cooking', topic: 'miso', status: 'candidate' }],
      };
    }
    if (path === '/api/competitors') {
      return { tracked: [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }], candidates: [], latestReportsByCompetitorId: { 1: { id: 10, competitorId: 1, cycleId: 'c1', summary: 'redesigned homepage' } } };
    }
    if (path === '/api/competitors/keywords') return [{ id: 1, keyword: 'gluten free recipes' }];
    return { ok: true };
  });
});

describe('Research', () => {
  it('renders trend topics, reports, tracked competitors, and keywords', async () => {
    render(<Research />);
    expect(await screen.findByText(/miso/)).toBeInTheDocument();
    expect(await screen.findByText(/sourdough is trending/)).toBeInTheDocument();
    expect(await screen.findByText(/example.com/)).toBeInTheDocument();
    expect(await screen.findByText(/redesigned homepage/)).toBeInTheDocument();
    expect(await screen.findByText('gluten free recipes')).toBeInTheDocument();
  });

  it('promotes a candidate topic and refetches', async () => {
    render(<Research />);
    const promoteButton = await screen.findByRole('button', { name: 'Promote' });
    fireEvent.click(promoteButton);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/trends/topics/5/promote', { method: 'POST' }));
  });

  it('adds a keyword via the form', async () => {
    render(<Research />);
    const input = await screen.findByPlaceholderText('New keyword');
    fireEvent.change(input, { target: { value: 'kitchenware roundup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/competitors/keywords', { method: 'POST', body: JSON.stringify({ keyword: 'kitchenware roundup' }) }),
    );
  });

  it('keeps the typed keyword in the input when the add fails', async () => {
    render(<Research />);
    const input = await screen.findByPlaceholderText('New keyword');
    fireEvent.change(input, { target: { value: 'kitchenware roundup' } });
    apiFetchMock.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(input).toHaveValue('kitchenware roundup');
  });

  it('shows an alert when a resource fails to load', async () => {
    useApiResourceMock.mockImplementation((path: string, actualHook: typeof import('../hooks/useApiResource').useApiResource) => {
      if (path === '/api/trends') {
        return { data: null, error: 'failed to load trends', loading: false, refetch: vi.fn() };
      }
      return actualHook(path);
    });
    render(<Research />);
    expect(await screen.findByRole('alert')).toHaveTextContent('failed to load trends');
  });
});
