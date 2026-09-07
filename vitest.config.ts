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
    //
    // apps/lhr-office is excluded for the same reason: it's a separate
    // workspace with its own vitest config (jsdom environment, client
    // setup file) and its own `npm test --workspace=lhr-office` command —
    // running its React Testing Library tests under this root config's
    // node environment fails with `document is not defined`.
    exclude: ['**/node_modules/**', 'mcp-server/**', 'apps/lhr-office/**'],
  },
});
