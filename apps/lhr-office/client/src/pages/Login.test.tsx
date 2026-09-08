import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const signInWithPasswordMock = vi.fn();
const resetPasswordForEmailMock = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
    },
  },
}));

const { Login } = await import('./Login');

beforeEach(() => vi.clearAllMocks());

describe('Login', () => {
  it('submits email/password to Supabase', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: 'a@example.com', password: 'hunter2' }),
    );
  });

  it('shows an error message when sign-in fails', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  });

  it('switches to the forgot-password form and back', () => {
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('sends a reset email and shows a confirmation', async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: null });
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() =>
      expect(resetPasswordForEmailMock).toHaveBeenCalledWith('a@example.com', {
        redirectTo: window.location.origin,
      }),
    );
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it('shows an error when the reset request fails', async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: { message: 'Too many requests' } });
    render(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  });

  it('shows an initialError immediately, e.g. for an expired reset link', () => {
    render(<Login initialError="Email link is invalid or has expired" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email link is invalid or has expired');
  });

  it('shows initialError even when it arrives after the initial render, e.g. an async session-establishment failure', () => {
    const { rerender } = render(<Login initialError={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<Login initialError="Network error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });
});
