import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('governance docs', () => {
  const constitution = () => readFileSync('docs/CONSTITUTION.md', 'utf-8');
  const rules = () => readFileSync('docs/RULES.md', 'utf-8');

  it('constitution includes all six never-change principles', () => {
    const text = constitution();
    expect(text).toContain('never goes live without the author');
    expect(text).toContain('always disclosed per FTC');
    expect(text).toContain('free or open-source');
    expect(text).toContain('never silently discarded');
    expect(text).toContain('single-author only');
    expect(text).toContain('codified as a new Rule');
  });

  it('rules includes all five evolvable rules', () => {
    const text = rules();
    expect(text).toContain('Astro + Vercel + Umami');
    expect(text).toContain('content/posts');
    expect(text).toContain('start_post');
    expect(text).toContain('26-posts/6-months');
    expect(text).toContain('frontmatter schema');
  });
});
