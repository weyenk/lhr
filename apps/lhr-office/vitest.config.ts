import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['client/**', 'jsdom']],
    setupFiles: ['./client/vitest.setup.ts'],
  },
});
