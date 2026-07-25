import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

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

describe('site header', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the wordmark and links to Home and About', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('site-header');
    expect(html).toContain('site-header__nav');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about/"');
  });

  it('renders an accessible mobile nav toggle', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('data-nav-toggle');
    expect(html).toContain('aria-label="Toggle navigation"');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('site footer', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the wordmark and copyright line', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    const year = new Date().getFullYear();
    expect(html).toContain('site-footer');
    expect(html).toContain(`© ${year} Love Heat Relationship`);
  });

  it('links to the legal pages', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('href="/privacy-policy/"');
    expect(html).toContain('href="/terms-of-service/"');
    expect(html).toContain('href="/affiliate-disclosure/"');
  });
});
