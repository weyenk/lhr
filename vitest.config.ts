import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    environment: 'node',
    // Several test files shell out to `npm run build`, each writing to the
    // shared dist/ directory. Running test files in parallel (vitest's
    // default) races those builds against each other. Force sequential
    // execution so each `astro build` completes before the next starts.
    fileParallelism: false,
  },
});
