import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    // Share one module registry across test files so Mongoose models are
    // compiled once. Without this, multiple model-importing test files trip
    // "OverwriteModelError: Cannot overwrite `Replicant` model once compiled."
    isolate: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
