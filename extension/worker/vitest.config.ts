// ABOUTME: Vitest configuration for the Cloudflare Worker package.
// ABOUTME: Runs tests in node env; no DOM needed for handler logic.

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

const extensionTypesSource = fileURLToPath(
  new URL('../../packages/extension-types/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@playhtml/extension-types': extensionTypesSource,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
