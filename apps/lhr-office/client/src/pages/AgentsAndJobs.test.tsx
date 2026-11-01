import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { AgentsAndJobs } = await import('./AgentsAndJobs');

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'trends-watcher',
    defaultCadenceDays: 7,
    cadenceDays: 7,
    prose: [
      { id: 'suggest', title: 'Suggest persona', source: 'inline', editable: true, text: 'default suggest text' },
      { id: 'strategist', title: 'strategist persona', source: 'repo', editable: false, text: '(repo)' },
    ],
    history: [
      {
        id: 1,
        jobName: 'trends-watcher',
        status: 'success',
        summary: 'ok',
        errorMessage: null,
        startedAt: '2026-09-01T00:00:00.000Z',
        finishedAt: '2026-09-01T00:05:00.000Z',
      },
    ],
    ...overrides,
  };
}

function allJobs() {
  return [
    jobRow({ name: 'product-sourcing-criteria', prose: [] }),
    jobRow({ name: 'product-sourcing-search', prose: [] }),
    jobRow({ name: 'product-sourcing-monetize', prose: [] }),
    jobRow({ name: 'product-sourcing-brand', prose: [] }),
    jobRow({ name: 'recipe-variant-generator', prose: [] }),
    jobRow({ name: 'recipe-variant-finisher', prose: [] }),
    jobRow({ name: 'trends-watcher' }),
    jobRow({ name: 'competitor-analysis', prose: [] }),
  ];
}

let jobsData: ReturnType<typeof allJobs>;
let cycleData: { cycle: Record<string, unknown> | null; candidates: unknown[] };

beforeEach(() => {
  vi.clearAllMocks();
  jobsData = allJobs();
  cycleData = { cycle: null, candidates: [] };
  apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/jobs') return jobsData;
    if (path === '/api/sourced-products/cycle') return cycleData;
    if (typeof path === 'string' && path.endsWith('/run')) return { outcome: 'ran' };
    if (typeof path === 'string' && path.endsWith('/tuning')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return { jobName: path.split('/')[3], cadenceDays: body.cadenceDays ?? null, proseOverrides: body.prose ?? {} };
    }
    return {};
  });
});

describe('AgentsAndJobs — Chains tab', () => {
  it('shows the Chains tab by default with the product-sourcing, recipe-variants, and research chains', async () => {
    render(<AgentsAndJobs />);
    expect(await screen.findByText('Product sourcing')).toBeInTheDocument();
    expect(screen.getByText('Recipe variants')).toBeInTheDocument();
    expect(screen.getByText('Research watchers')).toBeInTheDocument();
  });

  it('does not render the Studio (Mac) section anymore', async () => {
    render(<AgentsAndJobs />);
    await screen.findByText('Product sourcing');
    expect(screen.queryByRole('heading', { name: 'Studio (Mac)' })).not.toBeInTheDocument();
    expect(screen.queryByText(/repo_key/i)).not.toBeInTheDocument();
  });

  it('clicking a chain job node switches to the Jobs tab with that job selected', async () => {
    render(<AgentsAndJobs />);
    await screen.findByText('Product sourcing');

    const node = screen.getByRole('button', { name: /product-sourcing-criteria/ });
    fireEvent.click(node);

    expect(await screen.findByRole('tab', { name: 'Jobs', selected: true })).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: /job rail/i });
    expect(within(rail).getByRole('button', { name: /product-sourcing-criteria/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('links a waiting gate to /approvals', async () => {
    cycleData = {
      cycle: {
        id: 12,
        startedAt: '2026-10-01T00:00:00.000Z',
        status: 'awaiting_product_picks',
        criteriaJson: null,
        criteriaApprovedAt: null,
        gatingProfile: 'trust',
        closedAt: null,
      },
      candidates: [],
    };
    render(<AgentsAndJobs />);
    await screen.findByText('Product sourcing');
    const approvalsLinks = screen.getAllByRole('link', { name: /approvals/i });
    expect(approvalsLinks.length).toBeGreaterThan(0);
    expect(approvalsLinks[0]).toHaveAttribute('href', '/approvals');
  });
});

describe('AgentsAndJobs — Jobs tab', () => {
  async function goToJobsTab() {
    render(<AgentsAndJobs />);
    await screen.findByText('Product sourcing');
    fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
    await screen.findByRole('navigation', { name: /job rail/i });
  }

  it('lists every registered job in the rail, grouped', async () => {
    await goToJobsTab();
    const rail = screen.getByRole('navigation', { name: /job rail/i });
    expect(within(rail).getByRole('button', { name: /trends-watcher/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /recipe-variant-generator/ })).toBeInTheDocument();
  });

  it('runs the selected job on "Run now" and refetches', async () => {
    await goToJobsTab();
    fireEvent.click(screen.getByRole('button', { name: /trends-watcher/ }));
    const runButton = await screen.findByRole('button', { name: 'Run now' });

    fireEvent.click(runButton);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs/trends-watcher/run', { method: 'POST' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs'));
  });

  it('shows the selected job\'s run history under the Runs subtab', async () => {
    await goToJobsTab();
    fireEvent.click(within(screen.getByRole('navigation', { name: /job rail/i })).getByRole('button', { name: /trends-watcher/ }));
    expect(await screen.findByText('ok', { selector: '.run-log-summary' })).toBeInTheDocument();
  });

  it('saves a cadence override from the Tune subtab', async () => {
    await goToJobsTab();
    fireEvent.click(within(screen.getByRole('navigation', { name: /job rail/i })).getByRole('button', { name: /trends-watcher/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Tune' }));

    const cadenceInput = await screen.findByLabelText(/cadence/i);
    fireEvent.change(cadenceInput, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/api/jobs/trends-watcher/tuning',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const call = apiFetchMock.mock.calls.find((c) => c[0] === '/api/jobs/trends-watcher/tuning');
    const body = JSON.parse(call![1].body);
    expect(body.cadenceDays).toBe(10);
  });

  it('saves an edited editable prose field but never sends a read-only (repo) field', async () => {
    await goToJobsTab();
    fireEvent.click(within(screen.getByRole('navigation', { name: /job rail/i })).getByRole('button', { name: /trends-watcher/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Tune' }));

    const textarea = await screen.findByDisplayValue('default suggest text');
    fireEvent.change(textarea, { target: { value: 'edited suggest text' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs/trends-watcher/tuning', expect.anything()));
    const call = apiFetchMock.mock.calls.find((c) => c[0] === '/api/jobs/trends-watcher/tuning');
    const body = JSON.parse(call![1].body);
    expect(body.prose.suggest).toBe('edited suggest text');
    expect(body.prose.strategist).toBeUndefined();
  });

  it('renders a read-only textarea for a repo-sourced prose entry', async () => {
    await goToJobsTab();
    fireEvent.click(within(screen.getByRole('navigation', { name: /job rail/i })).getByRole('button', { name: /trends-watcher/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Tune' }));

    const repoTextarea = await screen.findByDisplayValue('(repo)');
    expect(repoTextarea).toHaveAttribute('readonly');
  });
});
