import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const useSessionMock = vi.fn();
vi.mock('./lib/auth', () => ({ useSession: () => useSessionMock() }));
// Isolates this shell/routing test from each panel's real data-fetching (added in Tasks
// 13-16, after this test is written) — without this, rendering a real panel would exercise
// the real lib/api.ts -> lib/supabaseClient.ts chain, which throws when VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY aren't set in the test environment.
vi.mock('./lib/api', () => ({ apiFetch: vi.fn().mockResolvedValue(null) }));
// `./App` statically imports `./pages/Login`, which imports `../lib/supabaseClient` at module
// scope (independent of lib/api) — that module throws at import time without
// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY set, so it needs the same isolation Login.test.tsx
// already applies, or importing `./App` below throws regardless of which branch is rendered.
const setSessionMock = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
vi.mock('./lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      setSession: (...args: unknown[]) => setSessionMock(...args),
    },
  },
}));

const { App } = await import('./App');

beforeEach(() => {
  vi.clearAllMocks();
  setSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  window.location.hash = '';
  delete (window as { __initialAuthHash?: string }).__initialAuthHash;
});

describe('App', () => {
  it('shows nothing but a loading state while the session is resolving', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the Login page when there is no session', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'lhr office' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders the sidebar and default panel when signed in', () => {
    useSessionMock.mockReturnValue({ session: { access_token: 'tok' }, loading: false });
    render(<App />);
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents & Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Research' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('shows the set-password screen instead of the dashboard when the URL is a recovery redirect', () => {
    window.location.hash = '#access_token=abc&type=recovery';
    useSessionMock.mockReturnValue({ session: { access_token: 'tok' }, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('shows the set-password screen for an invite redirect too', () => {
    window.location.hash = '#access_token=abc&type=invite';
    useSessionMock.mockReturnValue({ session: { access_token: 'tok' }, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
  });

  it('still shows Login when the URL is a recovery redirect but no session is established yet', () => {
    window.location.hash = '#access_token=abc&type=recovery';
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'lhr office' })).toBeInTheDocument();
  });

  it('shows a clear message on Login when the recovery/invite link has expired or was already used', () => {
    window.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'lhr office' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Email link is invalid or has expired');
  });

  it('detects a recovery redirect via window.__initialAuthHash even when location.hash has already been cleared', () => {
    // Reproduces a real production bug: supabase-js's client clears window.location.hash as
    // part of its own session setup, sometimes before App's own code gets to read it — so
    // location.hash is empty by the time this runs, exactly like it would be for real.
    window.location.hash = '';
    (window as { __initialAuthHash?: string }).__initialAuthHash = '#access_token=abc&type=recovery';
    useSessionMock.mockReturnValue({ session: { access_token: 'tok' }, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
  });

  it('establishes the session itself from a recovery hash instead of relying on automatic detection', () => {
    // detectSessionInUrl is disabled on the real client (see supabaseClient.ts) because its
    // automatic detection swallows failures silently — App calls setSession() directly so a
    // failure is visible instead. This test only checks the call is made correctly; the
    // resulting session update happens through the real onAuthStateChange plumbing (mocked away
    // here via useSessionMock, exercised by the other tests in this file).
    window.location.hash = '#access_token=abc&refresh_token=def&type=recovery';
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(setSessionMock).toHaveBeenCalledWith({ access_token: 'abc', refresh_token: 'def' });
  });

  it('does not call setSession when the hash has no refresh_token (e.g. an unrelated access_token param)', () => {
    window.location.hash = '#access_token=abc&type=recovery';
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('shows a clear message on Login when establishing the session from a recovery hash fails', async () => {
    setSessionMock.mockResolvedValue({ data: { session: null }, error: { message: 'Network error' } });
    window.location.hash = '#access_token=abc&refresh_token=def&type=recovery';
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
    expect(screen.getByRole('heading', { name: 'lhr office' })).toBeInTheDocument();
  });

  it('clears the token hash from the URL bar once tokens have been captured for setSession', () => {
    window.location.hash = '#access_token=abc&refresh_token=def&type=recovery';
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(window.location.hash).toBe('');
  });
});
