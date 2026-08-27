export class AuthNotConfiguredError extends Error {
  constructor() {
    super(
      'Admin auth is not wired up yet. apps/lhr-office is gated by a placeholder that denies all ' +
        'access until the trends-watcher spec\'s requireAdminSession() lands — swap this stub for ' +
        'that real import once it exists. See docs/affiliate-sourcing-agent-setup.md.',
    );
    this.name = 'AuthNotConfiguredError';
  }
}

export async function requireSession(): Promise<never> {
  throw new AuthNotConfiguredError();
}
