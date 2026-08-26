import { describe, expect, it } from 'vitest';
import { requireSession, AuthNotConfiguredError } from '../src/lib/auth';

describe('requireSession', () => {
  it('always rejects with AuthNotConfiguredError until real auth lands', async () => {
    await expect(requireSession()).rejects.toBeInstanceOf(AuthNotConfiguredError);
  });
});
