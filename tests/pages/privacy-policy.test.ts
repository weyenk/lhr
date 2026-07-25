import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('privacy policy page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the Umami analytics disclosure accurately', () => {
    const html = readFileSync('dist/privacy-policy/index.html', 'utf-8');
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Umami');
    expect(html).toContain('cookieless');
    expect(html).not.toContain('googletagmanager');
  });

  it('links to the affiliate disclosure page', () => {
    const html = readFileSync('dist/privacy-policy/index.html', 'utf-8');
    expect(html).toContain('href="/affiliate-disclosure/"');
  });
});
