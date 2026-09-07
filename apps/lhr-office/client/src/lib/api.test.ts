import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

const { apiFetch, ApiError } = await import('./api');

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
  vi.stubGlobal('fetch', vi.fn());
});

describe('apiFetch', () => {
  it('attaches the bearer token from the current session', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    });
    const result = await apiFetch('/api/jobs');
    expect(result).toEqual({ hello: 'world' });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('signs out and throws ApiError on a 401', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    });
    await expect(apiFetch('/api/jobs')).rejects.toBeInstanceOf(ApiError);
    expect(signOutMock).toHaveBeenCalled();
  });

  it('throws ApiError with the server message on other failures', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'db down' }),
    });
    await expect(apiFetch('/api/jobs')).rejects.toMatchObject({ message: 'db down', status: 500 });
  });
});
