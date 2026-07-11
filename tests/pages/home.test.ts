import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('home page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the site title', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('Love Heat Relationship');
  });
});
