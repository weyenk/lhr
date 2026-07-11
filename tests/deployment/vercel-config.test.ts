import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vercel.json', () => {
  it('specifies the Astro framework, build command, and output directory', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    expect(config.framework).toBe('astro');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBe('dist');
  });
});
