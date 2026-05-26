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
    title: "New: chat on Wikipedia",
    body: "A small chat panel now lives on every page. Talk to whoever else is reading the same article & find a favorite article for your name :) enjoy and let me know if you have any thoughts!",
    cta: {
      label: "try it on today's featured →",
      href: "https://en.wikipedia.org/wiki/Wikipedia:Today%27s_featured_article",
    },
    relevantUrl: /^https?:\/\/([a-z]+\.)?wikipedia\.org\//,
  },
];
