import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

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
        reports: [
          {
            id: 1,
            category: 'cooking',
            cycleId: '2026-09-06',
            summary: 'sourdough is trending',
            generatedAt: '2026-09-06T12:00:00.000Z',
            topicsUsed: [
              { topic: 'cast iron breads', source: 'curated' },
              { topic: 'miso', source: 'suggested' },
            ],
            rawFindings: {
              topics: [
                {
                  topic: 'cast iron breads',
                  source: 'curated',
                  interest: {
                    direction: 'rising',
                    topQueries: [{ query: 'cast iron bread pan', value: '100' }],
                    risingQueries: [{ query: 'no knead cast iron bread', value: 'Breakout' }],
                  },
                },
                {
                  topic: 'miso',
                  source: 'suggested',
                  interest: {
                    direction: 'flat',
                    topQueries: [{ query: 'miso soup', value: '100' }],
                    risingQueries: [],
                  },
                },
              ],
            },
          },
        ],
        topics: [
          { id: 5, category: 'cooking', topic: 'miso', status: 'candidate', timesSeen: 2 },
          { id: 6, category: 'cooking', topic: 'cast iron breads', status: 'curated', timesSeen: 4 },
        ],
      };
    }
    if (path === '/api/competitors') {
      return {
        tracked: [
          { id: 1, domain: 'example.com', name: 'Example', status: 'tracked' },
          { id: 2, domain: 'lowthreat.com', name: 'Low', status: 'tracked' },
        ],
        candidates: [],
        latestReportsByCompetitorId: {
          1: {
            id: 10,
            competitorId: 1,
            cycleId: 'c1',
            summary: 'redesigned homepage',
            newContent: [{ title: 'Cast Iron Bread', url: 'https://example.com/cast-iron-bread', publishedAt: null }],
            seoPositions: [{ keyword: 'gluten free recipes', position: 4 }],
            monetizationSnapshot: 'Sells cookbooks and affiliates.',
            designSnapshot: 'Editorial hero with shop CTA.',
            overlapScores: { market: 72, content: 68, product: 55, threat: 78 },
            decisionBrief: 'Closest mainstream neighbor after a homepage redesign.',
            suggestedActions: ['Double down on gluten-free POV'],
          },
          2: {
            id: 11,
            competitorId: 2,
            cycleId: 'c1',
            summary: 'quiet week',
            newContent: [],
            seoPositions: [],
            monetizationSnapshot: 'Newsletter only.',
            designSnapshot: 'Simple blog.',
            overlapScores: { market: 40, content: 35, product: 20, threat: 30 },
            decisionBrief: 'Low threat; useful CTA notes only.',
            suggestedActions: [],
          },
        },
      };
    }
    if (path === '/api/competitors/keywords') return [{ id: 1, keyword: 'gluten free recipes' }];
    if (path === '/api/competitors/discovery-queries') {
      return [{ id: 1, query: 'gluten free recipe blog' }];
    }
    return { ok: true };
  });
});

describe('Research', () => {
  it('renders the trend board without category labels or category picker', async () => {
    render(<Research />);
    const candidates = await screen.findByRole('region', { name: 'Candidates' });
    const curated = screen.getByRole('region', { name: 'Curated seeds' });
    expect(within(candidates).getByText('miso')).toBeInTheDocument();
    expect(within(curated).getByText('cast iron breads')).toBeInTheDocument();
    expect(screen.queryByLabelText('File under')).not.toBeInTheDocument();
    expect(screen.queryByText('web-design')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Weekly digests' })).not.toBeInTheDocument();
  });

  it('opens a research modal with deep research reports when a topic card is clicked', async () => {
    render(<Research />);
    const curated = await screen.findByRole('region', { name: 'Curated seeds' });
    fireEvent.click(within(curated).getByRole('button', { name: /cast iron breads/i }));
    const dialog = await screen.findByRole('dialog', { name: /cast iron breads/i });
    expect(within(dialog).getByRole('region', { name: 'Deep research reports' })).toBeInTheDocument();
    expect(within(dialog).getByText(/sourdough is trending/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Research' })).toBeInTheDocument();
  });

  it('hides the Research button for candidate topics', async () => {
    render(<Research />);
    const candidates = await screen.findByRole('region', { name: 'Candidates' });
    fireEvent.click(within(candidates).getByRole('button', { name: /miso/i }));
    const dialog = await screen.findByRole('dialog', { name: /miso/i });
    expect(within(dialog).getByRole('button', { name: 'Promote' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Research' })).not.toBeInTheDocument();
  });

  it('shows a not-implemented toast when Research is clicked on a curated topic', async () => {
    render(<Research />);
    const curated = await screen.findByRole('region', { name: 'Curated seeds' });
    fireEvent.click(within(curated).getByRole('button', { name: /cast iron breads/i }));
    const dialog = await screen.findByRole('dialog', { name: /cast iron breads/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Research' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Feature not implemented yet');
  });

  it('does not open the modal when the card was dragged', async () => {
    render(<Research />);
    const curated = await screen.findByRole('region', { name: 'Curated seeds' });
    const card = within(curated).getByRole('button', { name: /cast iron breads/i });
    fireEvent.dragStart(card);
    fireEvent.dragEnd(card);
    fireEvent.click(card);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('promotes from the topic modal', async () => {
    render(<Research />);
    const candidates = await screen.findByRole('region', { name: 'Candidates' });
    fireEvent.click(within(candidates).getByRole('button', { name: /miso/i }));
    const dialog = await screen.findByRole('dialog', { name: /miso/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/trends/topics/5/promote', { method: 'POST' }));
  });

  it('adds a freeform topic without asking for a category', async () => {
    render(<Research />);
    const topicInput = await screen.findByLabelText('Topic');
    fireEvent.change(topicInput, { target: { value: 'sourdough discard cookies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to curated' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/trends/topics',
        { method: 'POST', body: JSON.stringify({ category: 'cooking', topic: 'sourdough discard cookies' }) },
      ),
    );
  });

  it('demotes a curated topic when dropped onto Candidates', async () => {
    render(<Research />);
    const curated = await screen.findByRole('region', { name: 'Curated seeds' });
    const card = within(curated).getByRole('button', { name: /cast iron breads/i });
    const candidates = screen.getByRole('region', { name: 'Candidates' });
    fireEvent.dragStart(card);
    fireEvent.dragOver(candidates);
    fireEvent.drop(candidates);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/trends/topics/6/demote', { method: 'POST' }));
  });

  it('switches to the competitors overview with radar, threat-sorted chips, and collapsed sources', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    expect(await screen.findByRole('img', { name: /Overlap radar for example.com/i })).toBeInTheDocument();
    const chips = screen.getAllByRole('listitem');
    expect(chips[0]).toHaveAccessibleName(/example.com, threat 78/i);
    expect(chips[1]).toHaveAccessibleName(/lowthreat.com, threat 30/i);
    const sources = screen.getByText(/Sources \(discovery queries/i).closest('details');
    expect(sources).not.toBeNull();
    expect(sources!.open).toBe(false);
    fireEvent.click(screen.getByText(/Sources \(discovery queries/i));
    expect(sources!.open).toBe(true);
    expect(screen.getByText('gluten free recipes')).toBeInTheDocument();
    expect(screen.getByText('gluten free recipe blog')).toBeInTheDocument();
  });

  it('opens the analysis modal with decision brief, actions, and snapshots', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    fireEvent.click(await screen.findByRole('button', { name: /Open full analysis/i }));
    const dialog = await screen.findByRole('dialog', { name: /Analysis for example.com/i });
    expect(within(dialog).getByText(/Closest mainstream neighbor/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Double down on gluten-free POV/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Sells cookbooks and affiliates/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Editorial hero with shop CTA/i)).toBeInTheDocument();
    expect(within(dialog).getByText('#4')).toBeInTheDocument();
    const website = within(dialog).getByRole('link', { name: 'Website' });
    expect(website).toHaveAttribute('href', 'https://example.com');
  });

  it('adds and removes a discovery query used to find competitor candidates', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    fireEvent.click(screen.getByText(/Sources \(discovery queries/i));
    const input = await screen.findByPlaceholderText('e.g. weeknight pasta blog');
    fireEvent.change(input, { target: { value: 'weeknight pasta blog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discovery query' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/competitors/discovery-queries',
        { method: 'POST', body: JSON.stringify({ query: 'weeknight pasta blog' }) },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove discovery query gluten free recipe blog' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/competitors/discovery-queries/1', { method: 'DELETE' }),
    );
  });

  it('adds a tracked competitor from a domain', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    const input = await screen.findByPlaceholderText('e.g. all-clad.com');
    fireEvent.change(input, { target: { value: 'https://www.smittenkitchen.com/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add competitor' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/competitors',
        { method: 'POST', body: JSON.stringify({ domain: 'https://www.smittenkitchen.com/' }) },
      ),
    );
  });

  it('removes a tracked competitor from the analysis modal', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    fireEvent.click(await screen.findByRole('button', { name: /Open full analysis/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove example.com' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/competitors/1/reject', { method: 'POST' }),
    );
  });

  it('adds a keyword via the form', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    fireEvent.click(screen.getByText(/Sources \(discovery queries/i));
    const input = await screen.findByPlaceholderText('New keyword');
    fireEvent.change(input, { target: { value: 'kitchenware roundup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/competitors/keywords', { method: 'POST', body: JSON.stringify({ keyword: 'kitchenware roundup' }) }),
    );
  });

  it('keeps the typed keyword in the input when the add fails', async () => {
    render(<Research />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Competitors' }));
    fireEvent.click(screen.getByText(/Sources \(discovery queries/i));
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
