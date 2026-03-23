// ABOUTME: Lobby presence scenario: simulates thousands of users in a domain-wide lobby room.
// ABOUTME: Each user broadcasts a page URL via awareness, testing cross-page presence at scale.

import type { Scenario } from "./index.js";

// Pool of fake Wikipedia article URLs to distribute users across
const WIKI_PAGES = Array.from({ length: 200 }, (_, i) => ({
  url: `https://en.wikipedia.org/wiki/Article_${i}`,
  title: `Article ${i}`,
}));

const COLORS = [
  "hsl(0, 73%, 63%)",
  "hsl(30, 73%, 63%)",
  "hsl(60, 73%, 63%)",
  "hsl(120, 73%, 63%)",
  "hsl(180, 73%, 63%)",
  "hsl(210, 73%, 63%)",
  "hsl(270, 73%, 63%)",
  "hsl(330, 73%, 63%)",
];

export const lobbyPresence: Scenario = {
  name: "lobby-presence",
  description:
    "Simulates thousands of users in a domain-wide lobby room broadcasting their current Wikipedia page. " +
    "Tests awareness throughput and memory when getPresences() returns 10k+ entries.",
  defaults: {
    rampUpSeconds: 120,
    writeRateHz: 0,
    awarenessRateHz: 0.1, // Very low — lobby users only update on "navigation" (~every 10s)
  },
  tick(client, tickIndex, params) {
    // Each client picks a page on first tick and occasionally "navigates" to a new one
    const ticksPerNav = Math.round(10 / Math.max(params.awarenessRateHz, 0.01));
    if (tickIndex % ticksPerNav === 0) {
      const page = WIKI_PAGES[Math.floor(Math.random() * WIKI_PAGES.length)];
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      client.setAwareness({
        page: {
          url: page.url,
          title: page.title,
          color,
        },
      });
    }
  },
};
