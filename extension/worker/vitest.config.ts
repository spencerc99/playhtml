// ABOUTME: Vitest configuration for the Cloudflare Worker package.
// ABOUTME: Runs tests in node env; no DOM needed for handler logic.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
