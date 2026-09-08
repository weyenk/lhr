import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const updateUserMock = vi.fn();
vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { updateUser: (...args: unknown[]) => updateUserMock(...args) } },
}));

const { SetPassword } = await import('./SetPassword');

beforeEach(() => vi.clearAllMocks());

describe('SetPassword', () => {
  it('submits the new password to Supabase when both fields match', async () => {
    updateUserMock.mockResolvedValue({ error: null });
    const onDone = vi.fn();
    render(<SetPassword onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ password: 'hunter2hunter2' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('shows an error and does not call Supabase when the passwords do not match', async () => {
    const onDone = vi.fn();
    render(<SetPassword onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows the Supabase error message and does not call onDone when the update fails', async () => {
    updateUserMock.mockResolvedValue({ error: { message: 'Password should be at least 6 characters' } });
    const onDone = vi.fn();
    render(<SetPassword onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password should be at least 6 characters');
    expect(onDone).not.toHaveBeenCalled();
  });
});
