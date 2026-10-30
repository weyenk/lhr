import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { AgentsAndJobs } = await import('./AgentsAndJobs');

let bridgeJobs: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  bridgeJobs = [];
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/bridge/jobs') return { jobs: bridgeJobs };
    return [
      {
        name: 'trends-watcher',
        cadenceDays: 7,
        history: [{ id: 1, jobName: 'trends-watcher', status: 'success', summary: 'ok', errorMessage: null, startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:05:00.000Z' }],
      },
    ];
  });
});

describe('AgentsAndJobs', () => {
  it('renders each job with its run history', async () => {
    render(<AgentsAndJobs />);
    expect(await screen.findByText('trends-watcher')).toBeInTheDocument();
    expect(await screen.findByText(/success/)).toBeInTheDocument();
  });

  it('runs the job on click and refetches', async () => {
    render(<AgentsAndJobs />);
    const runButton = await screen.findByRole('button', { name: 'Run now' });
    apiFetchMock.mockResolvedValueOnce({ outcome: 'ran' });
    fireEvent.click(runButton);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs/trends-watcher/run', { method: 'POST' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs'));
  });

  it('renders the Studio (Mac) section', async () => {
    render(<AgentsAndJobs />);
    expect(await screen.findByRole('heading', { name: 'Studio (Mac)' })).toBeInTheDocument();
  });

  it('enqueues a studio job with the goal and default repo_key', async () => {
    render(<AgentsAndJobs />);
    const goal = await screen.findByLabelText(/goal/i);
    fireEvent.change(goal, { target: { value: 'Refactor the thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/bridge/jobs', {
        method: 'POST',
        body: JSON.stringify({ goal: 'Refactor the thing', repo_key: 'lhr' }),
      }),
    );
  });

  it('shows final_answer for done bridge jobs and error_message for failed ones', async () => {
    const base = { kind: 'cursor_agent', payload: { goal: 'g', repo_key: 'lhr' }, created_at: '2026-09-01T00:00:00.000Z', finished_at: null, worker_id: 'w1' };
    bridgeJobs = [
      { ...base, id: 'j1', status: 'done', result: { final_answer: 'All shipped', ok: true }, error_message: null },
      { ...base, id: 'j2', status: 'failed', result: null, error_message: 'worker exploded' },
    ];
    render(<AgentsAndJobs />);
    expect(await screen.findByText('All shipped')).toBeInTheDocument();
    expect(await screen.findByText(/worker exploded/)).toBeInTheDocument();
  });
});
