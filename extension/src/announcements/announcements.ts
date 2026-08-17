// ABOUTME: Build-time list of extension announcements shown via toast + popup postcard.
// ABOUTME: Newest first. Each announcement has a stable id used as a storage key.

export interface Announcement {
  id: string;
  shippedAt: number;
  title: string;
  body: string;
  popupOnly?: boolean;
  // Announcements for a feature that is still dark only surface once that
  // feature is reachable for this user.
  requiresFeature?: "scraps";
  cta?: {
    label: string;
  } & (
    | { href: string; extensionPath?: never }
    | { extensionPath: string; href?: never }
  );
  relevantUrl?: RegExp;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "scraps-2026-08",
    shippedAt: Date.parse("2026-08-16T00:00:00Z"),
    title: "internet scraps",
    body: "the little things you pass while wandering - images, buttons, icons, cursors - now wash up on a shore of your own.",
    popupOnly: true,
    requiresFeature: "scraps",
    cta: {
      label: "visit your shore →",
      extensionPath: "scraps.html",
    },
  },
  {
    id: "history-2026-08",
    shippedAt: Date.parse("2026-08-06T00:00:00Z"),
    title: "Browsing history review",
    body: "We browse so many corners of the internet. What were the rabbit holes you went on? Where did you spend time on? A new tab experience shares a review of your browsing history from the week, month, or year. Find it in every new tab or from the popup.",
    popupOnly: true,
    cta: {
      label: "open history →",
      extensionPath: "walking-record.html",
    },
  },
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
