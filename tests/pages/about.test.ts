import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('about page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the author photo beside the bio copy', () => {
    const html = readFileSync('dist/about/index.html', 'utf-8');
    expect(html).toContain('about-page__photo');
    expect(html).toContain('about-page__bio');
    expect(html).toContain('Love Heat Relationship began as a way to keep track of what actually worked');
  }, 60000);
});
