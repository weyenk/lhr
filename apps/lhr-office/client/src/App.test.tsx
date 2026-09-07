import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
vi.mock('./lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

const { App } = await import('./App');

beforeEach(() => vi.clearAllMocks());

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
});
