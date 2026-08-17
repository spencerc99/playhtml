// ABOUTME: Configures the externally hosted PlayHTML version 2 end-to-end suite.
// ABOUTME: Reads the site and PartyKit hosts without starting either server.

import { defineConfig } from "@playwright/test";

const siteHost = process.env.PLAYHTML_E2E_SITE ?? "http://localhost:5178";
const partyHost = process.env.PLAYHTML_E2E_PARTY ?? "localhost:2000";

export default defineConfig({
  expect: {
    timeout: 15_000,
  },
  metadata: {
    partyHost,
  },
  timeout: 60_000,
  use: {
    baseURL: siteHost,
    headless: true,
  },
});
