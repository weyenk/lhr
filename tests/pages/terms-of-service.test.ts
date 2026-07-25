import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('terms of service page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the terms with a food-content disclaimer', () => {
    const html = readFileSync('dist/terms-of-service/index.html', 'utf-8');
    expect(html).toContain('Terms of Service');
    expect(html).toContain('informational and entertainment purposes only');
  });

  it('links to the affiliate disclosure page', () => {
    const html = readFileSync('dist/terms-of-service/index.html', 'utf-8');
    expect(html).toContain('href="/affiliate-disclosure/"');
  });
});
