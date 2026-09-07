import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
    },
  },
}));

const { useSession } = await import('./auth');

beforeEach(() => {
  vi.clearAllMocks();
  onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

describe('useSession', () => {
  it('starts loading, then resolves with the current session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    const { result } = renderHook(() => useSession());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toEqual({ access_token: 'tok' });
  });

  it('resolves with a null session when signed out', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('updates when onAuthStateChange fires', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    let capturedCallback: ((event: string, session: unknown) => void) | undefined;
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    capturedCallback?.('SIGNED_IN', { access_token: 'new-tok' });
    await waitFor(() => expect(result.current.session).toEqual({ access_token: 'new-tok' }));
  });
});
