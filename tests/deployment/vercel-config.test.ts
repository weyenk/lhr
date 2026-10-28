import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vercel.json', () => {
  it('specifies the Astro framework and build command (adapter owns output path)', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    expect(config.framework).toBe('astro');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBeUndefined();
  });
});
