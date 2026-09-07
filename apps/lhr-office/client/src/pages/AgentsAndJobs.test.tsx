import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { AgentsAndJobs } = await import('./AgentsAndJobs');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockResolvedValue([
    {
      name: 'trends-watcher',
      cadenceDays: 7,
      history: [{ id: 1, jobName: 'trends-watcher', status: 'success', summary: 'ok', errorMessage: null, startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:05:00.000Z' }],
    },
  ]);
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
});
