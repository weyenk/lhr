import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePolling } from './usePolling';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePolling', () => {
  it('calls the callback on every interval', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000));
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('stops calling the callback after unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 5000));
    unmount();
    vi.advanceTimersByTime(20000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('always calls the latest callback, not the one from the first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 5000), { initialProps: { cb: first } });
    rerender({ cb: second });
    vi.advanceTimersByTime(5000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
