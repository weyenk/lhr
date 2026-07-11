import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Umami analytics script', () => {
  it('is included in the build when Umami env vars are set', () => {
    execSync('npm run build', {
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_UMAMI_URL: 'https://umami.loveheatrelationship.com/script.js',
        PUBLIC_UMAMI_WEBSITE_ID: 'test-website-id',
      },
    });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('src="https://umami.loveheatrelationship.com/script.js"');
    expect(html).toContain('data-website-id="test-website-id"');
  }, 60000);

  it('is omitted from the build when Umami env vars are unset', () => {
    execSync('npm run build', { stdio: 'inherit' });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).not.toContain('data-website-id');
  }, 60000);
});
