import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    environment: 'node',
    // Several test files shell out to `npm run build`, each writing to the
    // shared dist/ directory. Running test files in parallel (vitest's
    // default) races those builds against each other. Force sequential
    // execution so each `astro build` completes before the next starts.
    fileParallelism: false,
    // mcp-server is a separate workspace package with its own vitest
    // config/version — exclude it here so root `npm test` doesn't run its
    // tests a second time under a different vitest major.
    exclude: ['**/node_modules/**', 'mcp-server/**', 'apps/**'],
  },
});
