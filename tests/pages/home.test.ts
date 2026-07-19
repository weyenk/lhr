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

  it('lists links to all published posts', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('href="/posts/jerk-chicken-platter/"');
    expect(html).toContain('Jerk Chicken for a Crowd');
    expect(html).toContain('href="/posts/why-coastal-blue/"');
    expect(html).toContain('Why We Chose the Coastal Blue Set');
  });

  it('splits posts into a featured card and a recent-posts list', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__featured');
    expect(html).toContain('home__recent-list');
  });

  it('tags each post with its type', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('post-tag');
    expect(html).toContain('>Recipe<');
    expect(html).toContain('>Article<');
  });
});
