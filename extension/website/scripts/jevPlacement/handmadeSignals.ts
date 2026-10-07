// ABOUTME: Detects handmade-web markers in raw HTML with plain pattern matching,
// ABOUTME: so visual sites carrying little text still show what kind of place they are.

export type HandmadeSignals = {
  badge88x31: boolean;
  webring: boolean;
  guestbook: boolean;
  feed: boolean;
  relMe: boolean;
  adTrackerCount: number;
  cookieBanner: boolean;
  checkout: boolean;
};

/** Well-known ad and analytics hosts, matched against script sources. */
const AD_TRACKER_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "doubleclick.net",
  "adservice.google.com",
  "facebook.net",
  "connect.facebook.com",
  "hotjar.com",
  "segment.com",
  "segment.io",
  "mixpanel.com",
  "amplitude.com",
  "clarity.ms",
  "scorecardresearch.com",
  "quantserve.com",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "adroll.com",
  "bing.com/bat",
  "snap.licdn.com",
  "analytics.tiktok.com",
  "matomo",
  "plausible.io",
  "fathom",
  "statcounter.com",
  "chartbeat.com",
  "newrelic.com",
  "optimizely.com",
];

const WEBRING_HOSTS = [
  "webring",
  "neocities.org/webring",
  "nekoweb.org",
  "indieweb.org",
  "ringlink",
  "onionring",
];

function tagsOf(html: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  return html.match(pattern) ?? [];
}

function attributeOf(tag: string, attribute: string): string | null {
  // A quoted value may contain spaces, as inline styles and rel lists do, so
  // quoted and bare forms are read separately.
  const quoted = tag.match(
    new RegExp(`\\b${attribute}\\s*=\\s*(["'])([^"']*)\\1`, "i"),
  );
  if (quoted) return quoted[2];

  const bare = tag.match(
    new RegExp(`\\b${attribute}\\s*=\\s*([^"'>\\s]+)`, "i"),
  );
  return bare?.[1] ?? null;
}

/**
 * The 88x31 button is the web's oldest handmade badge. It is detected by its
 * declared dimensions, or by a filename that says so.
 */
export function hasBadge88x31(html: string): boolean {
  for (const tag of tagsOf(html, "img")) {
    const width = attributeOf(tag, "width");
    const height = attributeOf(tag, "height");
    if (width === "88" && height === "31") return true;

    const source = `${attributeOf(tag, "src") ?? ""} ${attributeOf(tag, "alt") ?? ""}`;
    if (/88x31|88_31/i.test(source)) return true;

    const style = attributeOf(tag, "style") ?? "";
    if (/width:\s*88px/i.test(style) && /height:\s*31px/i.test(style)) {
      return true;
    }
  }
  return /88x31/i.test(html);
}

export function hasWebring(html: string): boolean {
  if (/webring/i.test(html)) return true;
  if (WEBRING_HOSTS.some((host) => html.toLowerCase().includes(host))) {
    return true;
  }
  // A prev/next pair sitting next to the word "ring" is the classic ring nav.
  return (
    /\bring\b/i.test(html) &&
    /(prev(ious)?)\b/i.test(html) &&
    /\bnext\b/i.test(html)
  );
}

export function hasGuestbook(html: string): boolean {
  return /guestbook|guest-book|sign\s+my\s+guest/i.test(html);
}

export function hasFeed(html: string): boolean {
  for (const tag of tagsOf(html, "link")) {
    const rel = attributeOf(tag, "rel") ?? "";
    const type = attributeOf(tag, "type") ?? "";
    if (/alternate/i.test(rel) && /rss|atom|xml/i.test(type)) return true;
  }
  return /href=["'][^"']*(?:rss\.xml|atom\.xml|feed\.xml|\/feed\/?)["']/i.test(
    html,
  );
}

export function hasRelMe(html: string): boolean {
  return tagsOf(html, "a").some((tag) =>
    /\bme\b/i.test(attributeOf(tag, "rel") ?? ""),
  );
}

export function countAdTrackers(html: string): number {
  const found = new Set<string>();
  const sources = [
    ...tagsOf(html, "script").map((tag) => attributeOf(tag, "src") ?? ""),
    ...tagsOf(html, "iframe").map((tag) => attributeOf(tag, "src") ?? ""),
  ];
  for (const source of sources) {
    const lower = source.toLowerCase();
    for (const host of AD_TRACKER_HOSTS) {
      if (lower.includes(host)) found.add(host);
    }
  }
  // Inline snippets name their vendor without ever loading a script src.
  const lowerHtml = html.toLowerCase();
  for (const host of ["googletagmanager.com", "google-analytics.com"]) {
    if (lowerHtml.includes(host)) found.add(host);
  }
  return found.size;
}

export function hasCookieBanner(html: string): boolean {
  return /cookie\s*(consent|banner|notice|policy|preferences)|we\s+use\s+cookies|accept\s+(all\s+)?cookies|gdpr|onetrust|cookiebot|osano|termly|klaro/i.test(
    html,
  );
}

export function hasCheckout(html: string): boolean {
  if (
    /add\s+to\s+(cart|bag|basket)|proceed\s+to\s+checkout|shopping\s+cart|view\s+cart/i.test(
      html,
    )
  ) {
    return true;
  }
  return /href=["'][^"']*\/(cart|checkout|basket)(\/|["'?])/i.test(html);
}

export function detectHandmadeSignals(html: string): HandmadeSignals {
  return {
    badge88x31: hasBadge88x31(html),
    webring: hasWebring(html),
    guestbook: hasGuestbook(html),
    feed: hasFeed(html),
    relMe: hasRelMe(html),
    adTrackerCount: countAdTrackers(html),
    cookieBanner: hasCookieBanner(html),
    checkout: hasCheckout(html),
  };
}

/**
 * A single integer, positive for handmade markers and negative for the
 * commercial apparatus that marks a page as someone's business.
 */
export function handmadeScore(signals: HandmadeSignals): number {
  let score = 0;
  if (signals.badge88x31) score += 2;
  if (signals.webring) score += 2;
  if (signals.guestbook) score += 2;
  if (signals.feed) score += 1;
  if (signals.relMe) score += 1;
  if (signals.adTrackerCount > 0) score -= Math.min(3, signals.adTrackerCount);
  if (signals.cookieBanner) score -= 1;
  if (signals.checkout) score -= 2;
  return score;
}

/** The signal names, for handing Jev facts rather than numbers. */
export function signalNames(signals: HandmadeSignals): string[] {
  const names: string[] = [];
  if (signals.badge88x31) names.push("88x31_badge");
  if (signals.webring) names.push("webring");
  if (signals.guestbook) names.push("guestbook");
  if (signals.feed) names.push("rss_or_atom_feed");
  if (signals.relMe) names.push("rel_me_link");
  if (signals.adTrackerCount > 0) names.push("ad_or_analytics_scripts");
  if (signals.cookieBanner) names.push("cookie_consent_banner");
  if (signals.checkout) names.push("checkout_or_cart");
  return names;
}
