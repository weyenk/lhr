import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('article post page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the seed article post with named sections and kitchenware', () => {
    const html = readFileSync('dist/posts/why-coastal-blue/index.html', 'utf-8');
    expect(html).toContain('Why We Chose the Coastal Blue Set');
    expect(html).toContain('Every six months');
    expect(html).toContain('Coastal Blue Serving Platter');
    expect(html).toContain('data-umami-event="kitchenware-click"');
    expect(html).not.toContain('recipe-post__ingredients');
  }, 60000);
});
