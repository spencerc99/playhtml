// ABOUTME: Fetches bounded public metadata for selected commute evaluation candidates.
// ABOUTME: Rejects private network targets and redirects before reading small HTML responses.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

import type { ExternalEvidence } from "../commute-audit/evaluationTypes";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 8_000;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19));
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateIpv4(mapped);
  // Only globally routable unicast IPv6 is eligible; mapped and transition addresses are excluded.
  return !/^[23][0-9a-f]{3}:/.test(normalized) || normalized.startsWith("2002:") || normalized.startsWith("2001:0:");
}

export async function validatePublicUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("only credential-free HTTPS URLs on port 443 can be enriched");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("hostname resolves to a private or unsupported address");
  }
  return url;
}

function decodeEntities(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/\s+/g, " ").trim();
}

function metaContent(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (property !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content !== undefined) return decodeEntities(content);
  }
  return undefined;
}

function jsonLdValues(html: string): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) if (row && typeof row === "object" && !Array.isArray(row)) values.push(row as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return values;
}

function countFromJsonLd(rows: Record<string, unknown>[], interactionType: string): number | undefined {
  for (const row of rows) {
    const statistics = Array.isArray(row.interactionStatistic) ? row.interactionStatistic : [row.interactionStatistic];
    for (const statistic of statistics) {
      if (!statistic || typeof statistic !== "object") continue;
      const value = statistic as Record<string, unknown>;
      const type = typeof value.interactionType === "string" ? value.interactionType : JSON.stringify(value.interactionType ?? "");
      const count = typeof value.userInteractionCount === "number" ? value.userInteractionCount : Number(value.userInteractionCount);
      const normalizedType = type.toLowerCase();
      const typeMatches = normalizedType.includes(interactionType) || (interactionType === "view" && normalizedType.includes("watch"));
      if (typeMatches && Number.isFinite(count)) return count;
    }
  }
  return undefined;
}

export function extractPublicMetadata(html: string): Omit<ExternalEvidence, "status" | "checkedAt" | "finalUrl"> {
  const jsonLd = jsonLdValues(html);
  const primary = jsonLd[0] ?? {};
  const documentTitle = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const title = metaContent(html, "og:title") ?? (typeof primary.name === "string" ? primary.name : undefined) ?? (documentTitle || undefined);
  const description = metaContent(html, "og:description") ?? metaContent(html, "description") ?? (typeof primary.description === "string" ? primary.description : undefined);
  const authorValue = primary.author;
  const author = typeof authorValue === "string" ? authorValue : authorValue && typeof authorValue === "object" && "name" in authorValue && typeof authorValue.name === "string" ? authorValue.name : undefined;
  const youtubeViewCount = Number(html.match(/["']viewCount["']\s*:\s*["']?(\d+)/i)?.[1]);
  return {
    title,
    description,
    author,
    publishedAt: metaContent(html, "article:published_time") ?? (typeof primary.datePublished === "string" ? primary.datePublished : undefined),
    viewCount: countFromJsonLd(jsonLd, "view") ?? (Number.isFinite(youtubeViewCount) ? youtubeViewCount : undefined),
    likeCount: countFromJsonLd(jsonLd, "like"),
    source: jsonLd.length > 0 ? "json-ld" : "open-graph",
  };
}

function fetchPublic(url: URL): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "InternetCommuteResearch/1.0 (+https://wewere.online)" },
      // Validate the address used by the connection, not only a preceding DNS lookup.
      lookup(hostname, options, callback) {
        lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
          if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
            callback(new Error("hostname resolves to a private or unsupported address"), "", 4);
          } else if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }, (error: Error) => callback(error, "", 4));
      },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("error", reject);
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) incoming.destroy(new Error("response exceeded 512 KiB limit"));
        else chunks.push(chunk);
      });
      incoming.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = incoming.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

export async function enrichPublicPage(rawUrl: string): Promise<ExternalEvidence> {
  const checkedAt = new Date().toISOString();
  try {
    let url = await validatePublicUrl(rawUrl);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await fetchPublic(url);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) throw new Error("redirect chain could not be followed safely");
        url = await validatePublicUrl(new URL(location, url).href);
        continue;
      }
      if (response.status === 404 || response.status === 410) return { status: "unavailable", checkedAt, finalUrl: url.href, source: "http" };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/html")) return { status: "available", checkedAt, finalUrl: url.href, contentType, source: "http" };
      return { status: "available", checkedAt, finalUrl: url.href, contentType, ...extractPublicMetadata(await response.text()) };
    }
    throw new Error("redirect limit exceeded");
  } catch (error) {
    return { status: "failed", checkedAt, error: error instanceof Error ? error.message : String(error) };
  }
}
