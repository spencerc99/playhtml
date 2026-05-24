// ABOUTME: GET /page-meta?url=… — fetches page title + favicon for a URL.
// ABOUTME: Tries oEmbed for known providers, falls back to HTMLRewriter. Cached.

import type { Env } from '../lib/supabase';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// Long browser cache + edge cache. Titles change rarely; if a user really
// needs fresh metadata they can hard-refresh.
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const CACHE_CONTROL = `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`;

// Portrait sessions can fan out hundreds of unique URLs on load; 300/min/IP
// is comfortable without inviting abuse. Edge cache absorbs repeat lookups
// across users so per-IP cost stays bounded even on busy pages.
const RATE_LIMIT_MAX = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;

// Cap body reads at 1 MB. Real pages have <title> in the first few KB; a
// hostile response that streams indefinitely would otherwise sit on a worker
// slot until our 6s timeout fires.
const MAX_BODY_BYTES = 1_024 * 1_024;

// Bump this whenever the title-normalization / favicon-resolution logic
// changes in a way that should invalidate cached results. The edge cache
// key includes this version, so a deploy with a new version effectively
// resets the cache without us needing to manually purge.
const CACHE_VERSION = 'v4';
const ipHits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (ipHits.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > RATE_LIMIT_MAX_TRACKED_IPS) {
    const toDrop = Math.floor(RATE_LIMIT_MAX_TRACKED_IPS / 2);
    let i = 0;
    for (const key of ipHits.keys()) {
      if (i++ >= toDrop) break;
      ipHits.delete(key);
    }
  }
  return false;
}

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...(extra || {}) },
  });
}

// Query params that are universally tracking / share-attribution noise. We
// strip these before fetching AND before using the URL as a cache key so the
// same article shared via different referrers maps to the same cache entry.
// Keep this list conservative — anything that could be identity-bearing for
// some site (?v=…, ?id=…, etc.) stays.
const STRIP_PARAMS: ReadonlySet<string> = new Set([
  // Google analytics
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_brand', 'utm_social', 'utm_source_platform',
  // Click trackers
  'gclid', 'dclid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'igshid',
  // Email / marketing
  'mc_eid', 'mc_cid', '_hsmi', '_hsenc', 'mkt_tok', 'oly_anon_id',
  'oly_enc_id', 'vero_id', 'vero_conv',
  // Generic referral
  'ref', 'ref_src', 'ref_url', 'referrer', 'source', 'src',
  // Per-platform share IDs that don't change the resource
  'si',  // YouTube share-id
  't',   // YouTube timestamp — irrelevant to title/favicon
  'feature', // YouTube feature flag
]);

function canonicalizeUrl(url: URL): URL {
  const out = new URL(url.toString());
  // Strip tracking params. Iterate over a snapshot since we mutate during.
  const toDelete: string[] = [];
  out.searchParams.forEach((_, key) => {
    if (STRIP_PARAMS.has(key.toLowerCase())) toDelete.push(key);
  });
  for (const k of toDelete) out.searchParams.delete(k);
  // Remove hash fragment — it never reaches the server anyway.
  out.hash = '';
  // Drop trailing `?` if all params were stripped.
  if (!out.searchParams.toString()) out.search = '';
  return out;
}

// Refuse internal / loopback / link-local destinations to prevent the worker
// from being used to probe internal infra. We only allow http(s).
function isPublicHttpUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  ) {
    return null;
  }
  // IPv4 literal: block private + loopback + link-local + reserved ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    ) {
      return null;
    }
  }
  // IPv6 literal in brackets: anything not unicast is unsafe; easier to deny
  // all IPv6 literals than to safely parse them. Real public addresses
  // resolve through DNS hostnames so this rejects only edge cases.
  if (host.startsWith('[') && host.endsWith(']')) return null;
  return parsed;
}

// ── oEmbed providers ────────────────────────────────────────────────────────
//
// Each entry maps a hostname (or suffix) to an oEmbed endpoint. Providers
// here return titles even when the target page itself is walled to anonymous
// fetchers (YouTube, Vimeo, etc.). The list is intentionally short — adding
// providers is a one-line change.

interface OEmbedProvider {
  // Matches `url.hostname` exactly OR is a suffix preceded by a dot.
  hostnames: string[];
  endpoint: (url: URL) => string;
}

const OEMBED_PROVIDERS: OEmbedProvider[] = [
  {
    hostnames: ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
    endpoint: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.toString())}`,
  },
  {
    hostnames: ['vimeo.com', 'player.vimeo.com'],
    endpoint: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u.toString())}`,
  },
  {
    hostnames: ['soundcloud.com'],
    endpoint: (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u.toString())}`,
  },
  {
    hostnames: ['flickr.com', 'www.flickr.com', 'flic.kr'],
    endpoint: (u) => `https://www.flickr.com/services/oembed/?format=json&url=${encodeURIComponent(u.toString())}`,
  },
  {
    hostnames: ['reddit.com', 'www.reddit.com'],
    endpoint: (u) => `https://www.reddit.com/oembed?url=${encodeURIComponent(u.toString())}`,
  },
];

function pickOEmbedProvider(url: URL): OEmbedProvider | null {
  const host = url.hostname.toLowerCase();
  for (const p of OEMBED_PROVIDERS) {
    for (const h of p.hostnames) {
      if (host === h || host.endsWith(`.${h}`)) return p;
    }
  }
  return null;
}

interface PageMeta {
  title?: string;
  favicon?: string;
  source: 'oembed' | 'html' | 'none';
}

// Titles that look like a generic anonymous shell of the app rather than a
// real page label — usually returned by SPAs that haven't run their JS or by
// walled apps that hide content behind auth. Treat as missing.
const STUB_TITLES: ReadonlySet<string> = new Set([
  'notion', 'gmail', 'inbox', 'google docs', 'google drive', 'google sheets',
  'google slides', 'figma', 'figma | the collaborative interface design tool',
  'x', 'twitter', 'linkedin', 'linear', 'discord',
  'loading…', 'loading...', 'loading',
  'just a moment...', 'just a moment…',
  'attention required! | cloudflare',
  'access denied', 'forbidden',
]);

// Reduce a hostname/title segment to its identifying letters: lowercase,
// strip non-alphanumerics. Used to test whether a trailing " - X" segment
// matches the hostname (a real brand suffix) vs. being part of the title.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Returns the title with its trailing branding suffix removed, or null if
// the title doesn't appear to have a brand suffix worth stripping. We only
// strip when the part being cut matches the hostname (e.g. "Hypertext -
// Wikipedia" on en.wikipedia.org) — otherwise we'd butcher titles that
// legitimately contain " - " (e.g. "Rick Astley - Never Gonna Give You Up").
function stripBrandingSuffix(title: string, target: URL): string | null {
  // Find the LAST separator so multi-dash titles strip just the brand.
  const sepRe = /\s*[-–—|]\s*/g;
  let lastSepIdx = -1;
  let lastSepLen = 0;
  let mm: RegExpExecArray | null;
  while ((mm = sepRe.exec(title)) !== null) {
    lastSepIdx = mm.index;
    lastSepLen = mm[0].length;
  }
  if (lastSepIdx <= 0) return null;
  const head = title.slice(0, lastSepIdx);
  const tail = title.slice(lastSepIdx + lastSepLen);
  if (head.length < 3 || tail.length === 0 || tail.length > 60) return null;

  // Compare the tail against every dot-segment of the hostname (sans `www.`
  // and the TLD). For en.wikipedia.org we check ["en", "wikipedia"]; for
  // github.com we check ["github"]; for music.youtube.com ["music", "youtube"].
  // Strip when the tail (slugified) contains, or is contained by, any of
  // those segments. Avoids butchering titles whose tail happens to coincide
  // with a TLD-like word.
  const segments = target.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .slice(0, -1) // drop the TLD ("com", "org", "co.uk" — close enough)
    .map(slugify)
    .filter((s) => s.length >= 2);
  const tailSlug = slugify(tail);
  if (!tailSlug || segments.length === 0) return null;
  for (const seg of segments) {
    if (tailSlug.includes(seg) || seg.includes(tailSlug)) {
      return head.trim();
    }
  }
  return null;
}

// Normalize a raw <title> for downstream rendering. Trims, collapses
// whitespace, strips a trailing branding suffix only when it actually
// matches the hostname, and rejects titles that turn out to be useless
// after cleaning. Returns null when the title shouldn't be displayed.
function normalizeTitle(raw: string | undefined, target: URL): string | null {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;

  const lower = collapsed.toLowerCase();
  if (STUB_TITLES.has(lower)) return null;

  // Title equals the URL or hostname → not useful as a label.
  if (lower === target.toString().toLowerCase()) return null;
  if (lower === target.hostname.toLowerCase()) return null;
  if (lower === target.hostname.toLowerCase().replace(/^www\./, '')) return null;

  // Try to strip a trailing branding suffix — but only when the suffix
  // is actually about the site, not part of the title content (e.g.
  // "Rick Astley - Never Gonna Give You Up" has a " - " but the suffix
  // is the title, not the brand). Heuristic: the part after the last
  // separator must share characters with the hostname.
  const final = stripBrandingSuffix(collapsed, target) ?? collapsed;

  // Final sanity check: if the cleaned title became one of the stubs (e.g.
  // "Foo - Notion" → "Foo" is fine, but "Notion" → "Notion" is still stub).
  if (STUB_TITLES.has(final.toLowerCase())) return null;
  return final;
}

async function tryOEmbed(url: URL, provider: OEmbedProvider): Promise<PageMeta | null> {
  const endpoint = provider.endpoint(url);
  try {
    const resp = await fetch(endpoint, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { title?: string; thumbnail_url?: string };
    if (!data || typeof data !== 'object') return null;
    const raw = typeof data.title === 'string' ? data.title : undefined;
    const title = normalizeTitle(raw, url);
    if (!title) return null;
    // oEmbed returns thumbnail_url, not a favicon. Use the provider's own
    // domain favicon as a sensible default — Google's s2 favicon service
    // resolves it without us needing to do another fetch.
    const favicon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
    return { title, favicon, source: 'oembed' };
  } catch {
    return null;
  }
}

// Browser-shaped UA with a clear identifier in the comment block — most
// substring-based bot filters that match "bot"/"crawler" let this through,
// while ops teams can still find us and contact us via the URL if needed.
const USER_AGENT =
  'Mozilla/5.0 (compatible; wewere-online/1.0; +https://wewere.online)';

async function tryHtmlScrape(url: URL): Promise<PageMeta | null> {
  let title: string | undefined;
  let favicon: string | undefined;
  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
      return null;
    }

    // Cap body bytes so a slowly-streaming or oversized response can't pin
    // a worker slot. We tee the body through a TransformStream that throws
    // once it exceeds MAX_BODY_BYTES; HTMLRewriter's error handling cleanly
    // returns the partial parse, which is fine — <title> lives in <head>.
    let bytesRead = 0;
    const capStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesRead += chunk.byteLength;
        if (bytesRead > MAX_BODY_BYTES) {
          controller.terminate();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const cappedBody = resp.body
      ? resp.body.pipeThrough(capStream)
      : null;
    const cappedResp = new Response(cappedBody, {
      status: resp.status,
      headers: resp.headers,
    });

    // Use HTMLRewriter to stream-parse just the bits we care about. This
    // doesn't load the whole document into memory and bails as soon as the
    // stream completes.
    let inTitle = false;
    let titleBuf = '';
    const rewriter = new HTMLRewriter()
      .on('title', {
        element() {
          inTitle = true;
        },
        text(t) {
          if (inTitle) titleBuf += t.text;
        },
      })
      .on('link', {
        element(el) {
          if (favicon) return;
          const rel = (el.getAttribute('rel') || '').toLowerCase();
          if (!/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) return;
          const href = el.getAttribute('href');
          if (href) favicon = href;
        },
      })
      .on('meta', {
        element(el) {
          // og:title is often nicer (cleaner trailing branding) than <title>.
          if (title) return;
          const property = (el.getAttribute('property') || '').toLowerCase();
          if (property !== 'og:title') return;
          const content = el.getAttribute('content');
          if (content) title = content.trim();
        },
      });

    try {
      await rewriter.transform(cappedResp).text();
    } catch {
      // Body cap fired or stream errored mid-parse. Whatever we've captured
      // so far (in titleBuf / title / favicon vars) is still usable.
    }
    const rawTitle = title || titleBuf || undefined;
    title = normalizeTitle(rawTitle, url) ?? undefined;
    if (favicon) {
      try {
        favicon = new URL(favicon, url).toString();
      } catch {
        favicon = undefined;
      }
    }
    if (!favicon) {
      favicon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
    }
    if (!title) return null;
    return { title, favicon, source: 'html' };
  } catch {
    return null;
  }
}

export async function handlePageMeta(request: Request, _env: Env): Promise<Response> {
  const reqUrl = new URL(request.url);
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return jsonResponse(400, { error: 'missing url' });

  const validated = isPublicHttpUrl(raw);
  if (!validated) return jsonResponse(400, { error: 'invalid url' });
  const target = canonicalizeUrl(validated);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimited(ip, Date.now())) {
    return jsonResponse(429, { error: 'rate limited' });
  }

  // Edge cache lookup. The cache key reflects only the canonical URL so
  // multiple clients asking for the same URL share a result. CACHE_VERSION
  // is embedded so a deploy with logic changes invalidates the cache.
  const cacheKey = new Request(
    `https://page-meta-cache.invalid/${CACHE_VERSION}?url=${encodeURIComponent(target.toString())}`,
    { method: 'GET' },
  );
  // Workers exposes the default Cache via the runtime even though the
  // standard CacheStorage type doesn't declare it.
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const provider = pickOEmbedProvider(target);
  let meta: PageMeta | null = null;
  if (provider) meta = await tryOEmbed(target, provider);
  if (!meta) meta = await tryHtmlScrape(target);
  if (!meta) meta = { source: 'none' };

  const body = JSON.stringify(meta);
  const resp = new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': CACHE_CONTROL,
    },
  });
  // Cache the response (including the 'none' case — failures are also
  // worth caching briefly to avoid hammering a failing site).
  await cache.put(cacheKey, resp.clone());
  return resp;
}
