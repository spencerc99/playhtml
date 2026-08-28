// ABOUTME: Shared network and HTML helpers for the atlas crawlers.
// ABOUTME: Normalizes site domains and applies consistent polite fetch behavior.

export const FETCH_TIMEOUT_MS = 8000;
export const MAX_BODY_BYTES = 500_000;
export const PAGE_DELAY_MS = 150;

const USER_AGENT = "playhtml-atlas-crawler/0.1 (+https://playhtml.fun/map)";

// Hosting platforms where the subdomain is the site (mirrors the snapshot cleaning)
export const SITE_SUFFIXES = [
  "pages.dev", "netlify.app", "vercel.app", "github.io", "glitch.me",
  "neocities.org", "onrender.com", "fly.dev", "web.app", "firebaseapp.com",
  "herokuapp.com", "codepen.dev", "codepen.io", "wixsite.com", "deno.dev",
  "workers.dev", "webflow.io", "surge.sh", "repl.co", "blogspot.com",
  "bearblog.dev", "substack.com", "wordpress.com", "tumblr.com",
];

// ccTLD second-level registries: the site lives at the third label
// (foo.co.uk), so collapsing to two labels would merge unrelated sites
export const SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "me.uk", "gov.uk",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "com.au", "net.au", "org.au", "edu.au",
  "com.br", "org.br", "net.br",
  "co.nz", "org.nz", "net.nz", "ac.nz",
  "co.kr", "or.kr", "co.in", "ac.in", "org.in",
  "com.mx", "org.mx", "com.ar", "com.tw", "com.sg", "com.hk",
  "co.za", "org.za", "ac.at", "or.at", "co.at",
]);

export function baseDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  for (const suf of SITE_SUFFIXES) {
    if (h.endsWith("." + suf)) {
      const stem = h.slice(0, -(suf.length + 1));
      let site = stem.split(".").pop()!;
      // vercel deploy previews: project-<hash>-team -> project-team
      const preview = site.match(/^(.+)-[a-z0-9]{9}-([a-z0-9-]+)$/);
      if (suf === "vercel.app" && preview) {
        site = `${preview[1]}-${preview[2]}`;
      }
      return `${site}.${suf}`;
    }
  }
  const labels = h.split(".");
  if (
    labels.length >= 3 &&
    SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join("."))
  ) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export async function fetchWithTimeout(
  url: string,
  accept: string
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function makeLane(spacingMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  return function slot<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const value = await task();
      await new Promise((r) => setTimeout(r, spacingMs));
      return value;
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

export async function robotsDisallows(origin: string): Promise<string[]> {
  const res = await fetchWithTimeout(`${origin}/robots.txt`, "text/plain");
  if (!res || !res.ok) return [];
  try {
    const text = await res.text();
    const rules: string[] = [];
    let applies = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) applies = value === "*";
      else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
    }
    return rules;
  } catch {
    return [];
  }
}

export function extractLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1], pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:")
        out.push(url.href);
    } catch {
      // unparseable href
    }
  }
  return out;
}

function decodeXmlText(value: string): string {
  const decodeCodePoint = (entity: string, digits: string, radix: number) => {
    const codePoint = Number.parseInt(digits, radix);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (entity, digits: string) =>
      decodeCodePoint(entity, digits, 16)
    )
    .replace(/&#([0-9]+);/g, (entity, digits: string) =>
      decodeCodePoint(entity, digits, 10)
    )
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

export function extractSitemapLocations(xml: string): string[] {
  const locations: string[] = [];
  const locationPattern =
    /<(?:[a-z_][\w.-]*:)?loc\b[^>]*>([\s\S]*?)<\/(?:[a-z_][\w.-]*:)?loc\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = locationPattern.exec(xml))) {
    const location = decodeXmlText(match[1]).trim();
    if (location) locations.push(location);
  }
  return locations;
}

const LINK_RICH_PATH_TERMS = [
  "link",
  "blogroll",
  "friend",
  "now",
  "about",
  "bookmarks",
  "webring",
  "follow",
];

export function selectCrawlSeeds(
  homepage: string,
  discoveredUrls: Iterable<string>,
  maxPages: number
): string[] {
  const candidates = [...new Set(discoveredUrls)].filter(
    (url) => url !== homepage
  );
  candidates.sort((left, right) => {
    const leftPath = new URL(left).pathname;
    const rightPath = new URL(right).pathname;
    const leftIsLinkRich = LINK_RICH_PATH_TERMS.some((term) =>
      leftPath.toLowerCase().includes(term)
    );
    const rightIsLinkRich = LINK_RICH_PATH_TERMS.some((term) =>
      rightPath.toLowerCase().includes(term)
    );
    if (leftIsLinkRich !== rightIsLinkRich) return leftIsLinkRich ? -1 : 1;
    if (leftPath.length !== rightPath.length) {
      return leftPath.length - rightPath.length;
    }
    return left.localeCompare(right);
  });
  return [homepage, ...candidates].slice(0, maxPages);
}

export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) || null : null;
}

export function extractFavicon(html: string, pageUrl: string): string | null {
  const m = html.match(
    /<link\s[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i
  );
  if (m) {
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) {
      try {
        return new URL(href[1], pageUrl).href;
      } catch {
        // fall through to default
      }
    }
  }
  try {
    return new URL("/favicon.ico", pageUrl).href;
  } catch {
    return null;
  }
}

export const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp[34]|webm|woff2?|ttf)$/i;
