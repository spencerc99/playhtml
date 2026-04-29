// ABOUTME: Playwright config for the smoke test suite.
// ABOUTME: Spins up a static server over the prebuilt site-dist/ output.

import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.SMOKE_PORT ?? 4173);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // Serve the prebuilt site. Tests assume `bun build-site` has already run.
    command: `bunx serve -l ${PORT} --no-clipboard ../site-dist`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
