import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { useApiResource } = await import('./useApiResource');

beforeEach(() => vi.clearAllMocks());

describe('useApiResource', () => {
  it('fetches on mount and exposes the result', async () => {
    apiFetchMock.mockResolvedValue({ hello: 'world' });
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ hello: 'world' });
    expect(result.current.error).toBeNull();
  });

  it('does not surface an error until 3 consecutive failures', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();

    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeNull();

    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('resets the failure count on a subsequent success', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('one'));
    apiFetchMock.mockRejectedValueOnce(new Error('two'));
    apiFetchMock.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ ok: true });
  });

  it('refetch triggers another apiFetch call for the same path', async () => {
    apiFetchMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs');
  });
});
