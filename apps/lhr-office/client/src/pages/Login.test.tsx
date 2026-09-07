import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const signInWithPasswordMock = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args) } },
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
});
