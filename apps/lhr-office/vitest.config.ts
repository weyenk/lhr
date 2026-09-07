import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        name: 'node',
        test: {
          environment: 'node',
          include: ['**/*.test.ts', '**/*.test.tsx'],
          exclude: ['client/**/!(theme).test.ts', 'client/**/!(theme).test.tsx'],
        },
      },
      {
        name: 'jsdom',
        test: {
          environment: 'jsdom',
          include: ['client/**/!(theme).test.ts', 'client/**/!(theme).test.tsx'],
          setupFiles: ['./client/vitest.setup.ts'],
        },
      },
    ],
  },
});
