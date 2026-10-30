// ABOUTME: Defines normalized identities and human policy types for Internet places.
// ABOUTME: Keeps page, pattern, path, hostname, and site keys identical across the Worker and curation desk.

import { canonicalizeUrl } from '@playhtml/extension-types';
import { getDomain } from 'tldts';

/**
 * Ordered most specific first. `pattern` matches a hostname plus a path where
 * `*` stands for exactly one segment; `path` matches leading path segments.
 */
export const INTERNET_PLACE_SCOPES = ['page', 'pattern', 'path', 'hostname', 'site'] as const;

/** A pattern segment that matches any single path segment. */
export const URL_PATTERN_WILDCARD = '*';
export const INTERNET_PLACE_PLACEMENTS = [
  'hidden',
  'scenery',
  'regular',
  'featured',
  'reserve',
] as const;
export const INTERNET_PLACE_REASONS = [
  'authentication-required',
  'private-or-user-bound',
  'documentation-or-support',
  'jobs-or-recruiting',
  'generic-homepage',
  'business-or-product',
  'unsafe-or-low-quality',
  'human-community',
  'editorial-or-cultural',
  'standalone-tool',
  'inspection-error',
  'other',
] as const;

export type InternetPlaceScope = (typeof INTERNET_PLACE_SCOPES)[number];
export type InternetPlacePlacement =
  (typeof INTERNET_PLACE_PLACEMENTS)[number];
export type InternetPlaceReason = (typeof INTERNET_PLACE_REASONS)[number];

export interface InternetPlacePolicy {
  scope: InternetPlaceScope;
  placeKey: string;
  placement?: InternetPlacePlacement;
  reason?: string;
  note: string;
  updatedAt: string;
}

function parsePublicUrl(value: string): URL {
  const input = value.trim();
  const url = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
  );
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password
  ) {
    throw new Error('Internet places require a public HTTP or HTTPS URL.');
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  return url;
}

export function normalizeInternetPlace(
  value: string,
  scope: InternetPlaceScope,
): string {
  const url = parsePublicUrl(value);
  if (!url.hostname.includes('.') || url.hostname.includes(URL_PATTERN_WILDCARD)) {
    throw new Error('Internet places require a complete public hostname.');
  }
  if (scope === 'page') return canonicalizeUrl(url.toString());
  if (scope === 'pattern') {
    const segments = getPathSegments(url);
    if (!segments.includes(URL_PATTERN_WILDCARD)) {
      throw new Error('A pattern needs at least one * segment.');
    }
    if (segments.some((segment) => segment !== URL_PATTERN_WILDCARD && segment.includes(URL_PATTERN_WILDCARD))) {
      throw new Error('A * must stand for a whole path segment.');
    }
    return `${url.hostname}/${segments.join('/')}`;
  }
  if (scope === 'path') {
    const segments = getPathSegments(url);
    if (segments.length === 0) {
      throw new Error('A path rule needs at least one path segment.');
    }
    return `${url.hostname}/${segments.join('/')}`;
  }
  if (scope === 'hostname') return url.hostname;

  const site = getDomain(url.hostname, { allowPrivateDomains: true });
  if (!site) throw new Error('The site boundary could not be determined.');
  return site;
}

function getPathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Every key a URL can match, most specific first: the page, each path prefix
 * from longest to shortest (whole segments only), the hostname, then the site.
 */
export function getInternetPlaceLookupKeys(value: string): Array<{
  scope: InternetPlaceScope;
  placeKey: string;
}> {
  const url = parsePublicUrl(value);
  const segments = getPathSegments(url);
  const pathKeys = segments.map((_, index) => ({
    scope: 'path' as const,
    placeKey: `${url.hostname}/${segments.slice(0, segments.length - index).join('/')}`,
  }));
  return [
    { scope: 'page', placeKey: normalizeInternetPlace(value, 'page') },
    ...pathKeys,
    { scope: 'hostname', placeKey: normalizeInternetPlace(value, 'hostname') },
    { scope: 'site', placeKey: normalizeInternetPlace(value, 'site') },
  ];
}

export function getInternetPlacePolicyKey(
  scope: InternetPlaceScope,
  placeKey: string,
): string {
  return `${scope}:${placeKey}`;
}

export function resolveInternetPlacePolicy(
  policies: Iterable<InternetPlacePolicy>,
  value: string,
): InternetPlacePolicy | undefined {
  return getCoveringInternetPlacePolicies(policies, value)[0];
}

/**
 * Every policy covering a URL, most specific first: the page, matching
 * patterns (fewest wildcards first), path prefixes, the hostname, the site.
 */
export function getCoveringInternetPlacePolicies<T extends Pick<InternetPlacePolicy, 'scope' | 'placeKey'>>(
  policies: Iterable<T>,
  value: string,
): T[] {
  const all = [...policies];
  const byKey = new Map(
    all.map((policy) => [
      getInternetPlacePolicyKey(policy.scope, policy.placeKey),
      policy,
    ]),
  );
  const keyed = (lookup: { scope: InternetPlaceScope; placeKey: string }) => {
    const policy = byKey.get(getInternetPlacePolicyKey(lookup.scope, lookup.placeKey));
    return policy ? [policy] : [];
  };
  const [page, ...broader] = getInternetPlaceLookupKeys(value);
  const patterns = all
    .filter((policy) => policy.scope === 'pattern' && matchesUrlPattern(policy.placeKey, value))
    .sort(
      (a, b) =>
        countWildcards(a.placeKey) - countWildcards(b.placeKey) ||
        a.placeKey.localeCompare(b.placeKey),
    );
  return [...keyed(page), ...patterns, ...broader.flatMap(keyed)];
}

function countWildcards(pattern: string): number {
  return pattern.split('/').filter((segment) => segment === URL_PATTERN_WILDCARD).length;
}

/** True when a normalized pattern key covers the URL: same hostname, same segment count. */
export function matchesUrlPattern(pattern: string, value: string): boolean {
  let url: URL;
  try {
    url = parsePublicUrl(value);
  } catch {
    return false;
  }
  const [hostname, ...patternSegments] = pattern.split('/');
  if (hostname !== url.hostname) return false;
  const segments = getPathSegments(url);
  return (
    segments.length === patternSegments.length &&
    patternSegments.every(
      (segment, index) => segment === URL_PATTERN_WILDCARD || segment === segments[index],
    )
  );
}

/** Pattern suggestions need this many distinct seen URLs to count as a shape. */
export const URL_PATTERN_MIN_MATCHES = 3;
const URL_PATTERN_MAX_SEGMENTS = 10;

export interface UrlPatternSuggestion {
  pattern: string;
  /** Distinct seen URLs the pattern covers, including the URL itself. */
  matches: string[];
}

/**
 * Wildcard patterns for a URL, inferred from other URLs seen on its hostname.
 * A segment becomes `*` only when the URLs sharing every other segment take
 * at least two values there, and a pattern needs URL_PATTERN_MIN_MATCHES
 * distinct URLs. Most specific (fewest wildcards) first, then widest reach.
 */
export function suggestUrlPatterns(
  value: string,
  seen: Iterable<string>,
  limit = 3,
): UrlPatternSuggestion[] {
  let url: URL;
  try {
    url = parsePublicUrl(value);
  } catch {
    return [];
  }
  const target = getPathSegments(url);
  if (target.length === 0 || target.length > URL_PATTERN_MAX_SEGMENTS) return [];

  const peers = new Map<string, string[]>();
  peers.set(target.join('/'), target);
  for (const other of seen) {
    let otherUrl: URL;
    try {
      otherUrl = parsePublicUrl(other);
    } catch {
      continue;
    }
    if (otherUrl.hostname !== url.hostname) continue;
    const segments = getPathSegments(otherUrl);
    if (segments.length === target.length) peers.set(segments.join('/'), segments);
  }
  if (peers.size < URL_PATTERN_MIN_MATCHES) return [];

  const suggestions: Array<UrlPatternSuggestion & { wildcards: number }> = [];
  for (let mask = 1; mask < 1 << target.length; mask += 1) {
    const isWild = (index: number) => (mask & (1 << index)) !== 0;
    const matches = [...peers.values()].filter((segments) =>
      segments.every((segment, index) => isWild(index) || segment === target[index]),
    );
    if (matches.length < URL_PATTERN_MIN_MATCHES) continue;
    const everyWildcardVaries = target.every(
      (_, index) =>
        !isWild(index) || new Set(matches.map((segments) => segments[index])).size >= 2,
    );
    if (!everyWildcardVaries) continue;
    const segments = target.map((segment, index) => (isWild(index) ? URL_PATTERN_WILDCARD : segment));
    suggestions.push({
      pattern: `${url.hostname}/${segments.join('/')}`,
      matches: matches.map((segments) => `https://${url.hostname}/${segments.join('/')}`),
      wildcards: segments.filter((segment) => segment === URL_PATTERN_WILDCARD).length,
    });
  }
  return suggestions
    .sort((a, b) => a.wildcards - b.wildcards || b.matches.length - a.matches.length)
    .slice(0, limit)
    .map(({ pattern, matches }) => ({ pattern, matches }));
}
