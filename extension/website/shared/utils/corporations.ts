// ABOUTME: Maps web domains to the organizations that own them, so visualizations
// ABOUTME: can expose platform consolidation. Unknown domains are "the independent web".

export type OwnerKind = "corp" | "nonprofit" | "indie";

export interface Owner {
  id: string;
  name: string;
  kind: OwnerKind;
}

/** The catch-all owner for every domain we don't recognize — personal sites,
 * small tools, forums, blogs. Deliberately framed as a place, not a company. */
export const INDEPENDENT: Owner = {
  id: "indie",
  name: "the independent web",
  kind: "indie",
};

const OWNERS: Owner[] = [
  { id: "alphabet", name: "Alphabet", kind: "corp" },
  { id: "meta", name: "Meta", kind: "corp" },
  { id: "amazon", name: "Amazon", kind: "corp" },
  { id: "microsoft", name: "Microsoft", kind: "corp" },
  { id: "apple", name: "Apple", kind: "corp" },
  { id: "bytedance", name: "ByteDance", kind: "corp" },
  { id: "xcorp", name: "X Corp", kind: "corp" },
  { id: "netflix", name: "Netflix", kind: "corp" },
  { id: "spotify", name: "Spotify", kind: "corp" },
  { id: "reddit", name: "Reddit Inc", kind: "corp" },
  { id: "openai", name: "OpenAI", kind: "corp" },
  { id: "anthropic", name: "Anthropic", kind: "corp" },
  { id: "automattic", name: "Automattic", kind: "corp" },
  { id: "salesforce", name: "Salesforce", kind: "corp" },
  { id: "snap", name: "Snap Inc", kind: "corp" },
  { id: "pinterest", name: "Pinterest", kind: "corp" },
  { id: "yahoo", name: "Yahoo", kind: "corp" },
  { id: "adobe", name: "Adobe", kind: "corp" },
  { id: "zoom", name: "Zoom", kind: "corp" },
  { id: "shopify", name: "Shopify", kind: "corp" },
  { id: "ebay", name: "eBay", kind: "corp" },
  { id: "substack", name: "Substack", kind: "corp" },
  { id: "discord", name: "Discord Inc", kind: "corp" },
  { id: "notion", name: "Notion Labs", kind: "corp" },
  { id: "figma", name: "Figma", kind: "corp" },
  { id: "canva", name: "Canva", kind: "corp" },
  { id: "wikimedia", name: "Wikimedia", kind: "nonprofit" },
  { id: "archive", name: "Internet Archive", kind: "nonprofit" },
  { id: "mozilla", name: "Mozilla", kind: "nonprofit" },
  { id: "signal", name: "Signal Foundation", kind: "nonprofit" },
];

const ownerById = new Map<string, Owner>(OWNERS.map((o) => [o.id, o]));

/** Exact registrable-domain keys. Subdomains resolve via suffix walking, so
 * `docs.google.com` matches the `google.com` entry. */
const DOMAIN_TO_OWNER: Record<string, string> = {
  // Alphabet
  "google.com": "alphabet",
  "youtube.com": "alphabet",
  "youtu.be": "alphabet",
  "gmail.com": "alphabet",
  "googleusercontent.com": "alphabet",
  "googleapis.com": "alphabet",
  "gstatic.com": "alphabet",
  "googlevideo.com": "alphabet",
  "blogger.com": "alphabet",
  "blogspot.com": "alphabet",
  "withgoogle.com": "alphabet",
  "goo.gl": "alphabet",
  // Meta
  "facebook.com": "meta",
  "fb.com": "meta",
  "instagram.com": "meta",
  "whatsapp.com": "meta",
  "messenger.com": "meta",
  "threads.net": "meta",
  "threads.com": "meta",
  "meta.com": "meta",
  "oculus.com": "meta",
  // Amazon
  "amazon.com": "amazon",
  "twitch.tv": "amazon",
  "audible.com": "amazon",
  "imdb.com": "amazon",
  "goodreads.com": "amazon",
  "primevideo.com": "amazon",
  "zappos.com": "amazon",
  "a2z.com": "amazon",
  "awsstatic.com": "amazon",
  // Microsoft
  "microsoft.com": "microsoft",
  "bing.com": "microsoft",
  "linkedin.com": "microsoft",
  "github.com": "microsoft",
  "githubusercontent.com": "microsoft",
  "office.com": "microsoft",
  "office365.com": "microsoft",
  "live.com": "microsoft",
  "outlook.com": "microsoft",
  "msn.com": "microsoft",
  "azure.com": "microsoft",
  "sharepoint.com": "microsoft",
  "xbox.com": "microsoft",
  "skype.com": "microsoft",
  // Apple
  "apple.com": "apple",
  "icloud.com": "apple",
  "apple.news": "apple",
  // ByteDance
  "tiktok.com": "bytedance",
  "capcut.com": "bytedance",
  "tiktokcdn.com": "bytedance",
  // X Corp
  "x.com": "xcorp",
  "twitter.com": "xcorp",
  "t.co": "xcorp",
  "twimg.com": "xcorp",
  // Netflix
  "netflix.com": "netflix",
  // Spotify
  "spotify.com": "spotify",
  // Reddit
  "reddit.com": "reddit",
  "redd.it": "reddit",
  "redditmedia.com": "reddit",
  // OpenAI
  "openai.com": "openai",
  "chatgpt.com": "openai",
  "oaiusercontent.com": "openai",
  "sora.com": "openai",
  // Anthropic
  "anthropic.com": "anthropic",
  "claude.ai": "anthropic",
  "claude.com": "anthropic",
  // Automattic
  "wordpress.com": "automattic",
  "tumblr.com": "automattic",
  "gravatar.com": "automattic",
  "wp.com": "automattic",
  // Salesforce
  "salesforce.com": "salesforce",
  "slack.com": "salesforce",
  "force.com": "salesforce",
  // Snap
  "snapchat.com": "snap",
  "snap.com": "snap",
  // Pinterest
  "pinterest.com": "pinterest",
  "pin.it": "pinterest",
  // Yahoo
  "yahoo.com": "yahoo",
  "flickr.com": "yahoo",
  "aol.com": "yahoo",
  "engadget.com": "yahoo",
  "techcrunch.com": "yahoo",
  // Adobe
  "adobe.com": "adobe",
  "behance.net": "adobe",
  // Zoom
  "zoom.us": "zoom",
  "zoom.com": "zoom",
  // Shopify
  "shopify.com": "shopify",
  "myshopify.com": "shopify",
  // eBay
  "ebay.com": "ebay",
  // Substack
  "substack.com": "substack",
  // Discord
  "discord.com": "discord",
  "discord.gg": "discord",
  // Notion
  "notion.so": "notion",
  "notion.com": "notion",
  // Figma
  "figma.com": "figma",
  // Canva
  "canva.com": "canva",
  // Wikimedia
  "wikipedia.org": "wikimedia",
  "wikimedia.org": "wikimedia",
  "wiktionary.org": "wikimedia",
  "wikidata.org": "wikimedia",
  "wikiquote.org": "wikimedia",
  "wikibooks.org": "wikimedia",
  "wikisource.org": "wikimedia",
  // Internet Archive
  "archive.org": "archive",
  "openlibrary.org": "archive",
  // Mozilla
  "mozilla.org": "mozilla",
  "firefox.com": "mozilla",
  "mdn.dev": "mozilla",
  // Signal
  "signal.org": "signal",
};

/** Brands that own a whole family of country TLDs (google.de, amazon.co.jp, …).
 * Checked only after the exact-domain map misses. */
const BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, "alphabet"],
  [/(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/, "amazon"],
  [/(^|\.)ebay\.[a-z]{2,3}(\.[a-z]{2})?$/, "ebay"],
];

/**
 * Resolve a domain (as produced by `extractDomain`) to the organization that
 * owns it. Walks subdomain suffixes so any depth of subdomain matches its
 * registrable parent. Falls back to {@link INDEPENDENT}.
 */
export function resolveOwner(domain: string): Owner {
  const host = (domain ?? "").toLowerCase().replace(/^www\./, "");
  if (!host) return INDEPENDENT;

  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const ownerId = DOMAIN_TO_OWNER[candidate];
    if (ownerId) return ownerById.get(ownerId) ?? INDEPENDENT;
  }

  for (const [pattern, ownerId] of BRAND_PATTERNS) {
    if (pattern.test(host)) return ownerById.get(ownerId) ?? INDEPENDENT;
  }

  return INDEPENDENT;
}

export function getOwner(id: string): Owner {
  return ownerById.get(id) ?? INDEPENDENT;
}
