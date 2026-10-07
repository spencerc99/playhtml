// ABOUTME: Loads a Tranco-format popularity list from disk and caps well-known
// ABOUTME: domains at an ordinary stop, so featuring stays for the smaller web.

import { existsSync, readFileSync } from "node:fs";

import { getDomainWithoutSuffix, parse } from "tldts";

export type PopularityList = {
  /** Absent when no list file was found on disk. */
  available: boolean;
  domains: Set<string>;
  path: string;
};

/** Parses `rank,domain` rows. Anything malformed is skipped rather than guessed. */
export function parseTrancoCsv(text: string): Set<string> {
  const domains = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",");
    if (parts.length < 2) continue;
    if (!/^\d+$/.test(parts[0].trim())) continue;
    const domain = parts[1].trim().toLowerCase();
    if (domain) domains.add(domain);
  }
  return domains;
}

/** Reads the list if it exists. Nothing is ever downloaded. */
export function loadPopularityList(path: string): PopularityList {
  if (!existsSync(path)) {
    return { available: false, domains: new Set(), path };
  }
  return {
    available: true,
    domains: parseTrancoCsv(readFileSync(path, "utf8")),
    path,
  };
}

export function registrableDomainOf(url: string): string | null {
  try {
    const parsed = parse(new URL(url).hostname, { allowPrivateDomains: false });
    return parsed.domain?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/**
 * True when the URL's registrable domain sits in the popularity list, which
 * means it is too well known to need featuring.
 */
export function isPopular(url: string, list: PopularityList): boolean {
  if (!list.available) return false;
  const domain = registrableDomainOf(url);
  if (!domain) return false;
  if (list.domains.has(domain)) return true;

  // A list naming the bare name without its suffix still matches the site.
  const withoutSuffix = getDomainWithoutSuffix(domain, {
    allowPrivateDomains: false,
  });
  return withoutSuffix ? list.domains.has(withoutSuffix) : false;
}
