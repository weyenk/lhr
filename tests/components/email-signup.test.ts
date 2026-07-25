import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('email signup', () => {
  it('is omitted from the build when PUBLIC_CONVERTKIT_FORM_ID is unset', () => {
    execSync('npm run build', { stdio: 'inherit' });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).not.toContain('app.kit.com/forms');
    expect(html).not.toContain('email_address');
  }, 60000);

  it('renders the ConvertKit form in the footer when PUBLIC_CONVERTKIT_FORM_ID is set', () => {
    execSync('npm run build', {
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_CONVERTKIT_FORM_ID: 'test-form-id',
      },
    });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('action="https://app.kit.com/forms/test-form-id/subscriptions"');
    expect(html).toContain('name="email_address"');
  }, 60000);

  it('renders a coming-soon community page with the standalone signup form', () => {
    execSync('npm run build', {
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_CONVERTKIT_FORM_ID: 'test-form-id',
      },
    });
    const html = readFileSync('dist/community/index.html', 'utf-8');
    expect(html).toContain('Coming soon');
    expect(html).toContain('action="https://app.kit.com/forms/test-form-id/subscriptions"');
  }, 60000);
});
