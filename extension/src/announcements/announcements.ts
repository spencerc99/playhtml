// ABOUTME: Build-time list of extension announcements shown via toast + popup postcard.
// ABOUTME: Newest first. Each announcement has a stable id used as a storage key.

export interface Announcement {
  id: string;
  shippedAt: number;
  title: string;
  body: string;
  cta?: {
    label: string;
    href: string;
  };
  relevantUrl?: RegExp;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "wiki-chat-2026-05",
    shippedAt: Date.parse("2026-05-27T00:00:00Z"),
    title: "Chat on Wikipedia!",
    body: "A small chat panel now lives on every page so you can talk to others there. Happy rabbitholing!",
    cta: {
      label: "try on today's featured article →",
      href: "https://en.wikipedia.org/wiki/Wikipedia:Today%27s_featured_article",
    },
    relevantUrl: /^https?:\/\/([a-z]+\.)?wikipedia\.org\//,
  },
];
