// ABOUTME: Reduces raw browsing events into the privacy-limited Internet Commute response.
// ABOUTME: Keeps private activity as domain-only scenery and curates clickable public pages.

import {
  canonicalizeUrl,
  type CollectionEvent,
  type CommuteDestination,
  type CommuteResponse,
  type CommuteSceneryItem,
} from '@playhtml/extension-types';

const ACTIVE_PEOPLE_WINDOW_MS = 2 * 60_000;
const DESTINATION_LIMIT = 10;
const SCENERY_LIMIT = 100;

const NEVER_LAND_DOMAINS = [
  'accounts.google.com',
  'calendar.google.com',
  'chat.deepseek.com',
  'chatgpt.com',
  'discord.com',
  'docs.google.com',
  'docs.superhuman.com',
  'drive.google.com',
  'gemini.google.com',
  'grok.com',
  'mail.google.com',
  'outlook.cloud.microsoft',
  'outlook.live.com',
  'outlook.office.com',
  'open.spotify.com',
  'twitter.com',
  'web.telegram.org',
  'x.com',
];

const TITLE_REQUIRED_DOMAINS = [
  'github.com',
  'imdb.com',
  'instagram.com',
  'itch.io',
  'pinterest.com',
  'substack.com',
  'tiktok.com',
  'wikipedia.org',
  'wordpress.com',
  'youtu.be',
  'youtube.com',
];

const GENERIC_PATHS = new Set([
  '/dashboard',
  '/feed',
  '/home',
  '/newtab',
  '/search',
]);

const NEVER_LAND_SUBDOMAIN_LABELS = new Set([
  'account',
  'accounts',
  'admin',
  'auth',
  'candidate',
  'dashboard',
  'idp',
  'idpproxy',
  'login',
  'mail',
  'sso',
]);

const NEVER_LAND_PATH_SEGMENTS = new Set([
  'account',
  'accounts',
  'auth',
  'authorize',
  'cart',
  'checkout',
  'download',
  'editor',
  'inbox',
  'login',
  'myschedule',
  'oauth',
  'outbound',
  'publish',
  'redirect',
  'redir',
  'settings',
  'signin',
  'sso',
  'statements',
]);

const NEVER_LAND_PATH_PREFIXES = [
  {
    domain: 'nytimes.com',
    prefixes: ['/puzzles/stats'],
  },
];

const AUTHENTICATION_PATH_MARKERS = [
  'oauth2callback',
  'saml2acs',
  'signinoidc',
  'simplesaml',
];

const GENERIC_TITLES = new Set([
  'attentionrequiredcloudflare',
  'checkingyourbrowser',
  'dashboard',
  'home',
  'homepage',
  'justamoment',
  'login',
  'newtab',
  'search',
  'signin',
  'untitled',
]);

interface NavigationCandidate {
  domain: string;
  hue: string;
  pid: string;
  recentDomainVisits: number;
  title: string | null;
  url: string;
  visitedAt: number;
}

function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function comparableLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function isLocalNetworkHost(domain: string): boolean {
  if (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.local') ||
    domain.includes(':')
  ) {
    return true;
  }

  const ipv4Parts = domain.split('.');
  return (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => {
      const number = Number(part);
      return Number.isInteger(number) && number >= 0 && number <= 255;
    })
  );
}

function hasBlockedPath(pathname: string, domain: string): boolean {
  if (
    [...GENERIC_PATHS].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  ) {
    return true;
  }

  if (
    NEVER_LAND_PATH_PREFIXES.some(
      (rule) =>
        domainMatches(domain, rule.domain) &&
        rule.prefixes.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
        ),
    )
  ) {
    return true;
  }

  return pathname.split('/').some((segment) => {
    const label = comparableLabel(segment);
    return (
      NEVER_LAND_PATH_SEGMENTS.has(label) ||
      AUTHENTICATION_PATH_MARKERS.some((marker) => label.includes(marker))
    );
  });
}

function getMeaningfulTitle(
  title: string | null,
  domain: string,
): string | null {
  const normalizedTitle = title?.replace(/\s+/g, ' ').trim() ?? '';
  if (
    normalizedTitle.length < 3 ||
    normalizedTitle.length > 100 ||
    GENERIC_TITLES.has(comparableLabel(normalizedTitle)) ||
    /^https?:\/\/\S+$/i.test(normalizedTitle)
  ) {
    return null;
  }

  const domainParts = domain.split('.');
  const comparableDomains = new Set([
    comparableLabel(domain),
    comparableLabel(domainParts[0]),
    comparableLabel(domainParts.slice(0, -1).join(' ')),
    ...domainParts.slice(0, -1).map(comparableLabel),
  ]);

  return comparableDomains.has(comparableLabel(normalizedTitle))
    ? null
    : normalizedTitle;
}

function hasUserBoundSubdomain(domain: string): boolean {
  const labels = domain.split('.');
  return labels
    .slice(0, -2)
    .some((label) => NEVER_LAND_SUBDOMAIN_LABELS.has(comparableLabel(label)));
}

function isExcludedDestinationSurface(url: URL, domain: string): boolean {
  return (
    Boolean(url.username || url.password) ||
    NEVER_LAND_DOMAINS.some((candidate) => domainMatches(domain, candidate)) ||
    hasUserBoundSubdomain(domain) ||
    hasBlockedPath(url.pathname || '/', domain)
  );
}

function sanitizePublicDestinationUrl(rawUrl: string): string | null {
  try {
    const url = new URL(canonicalizeUrl(rawUrl));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    const domain = normalizeDomain(url.hostname);
    if (isExcludedDestinationSurface(url, domain)) return null;

    if (domainMatches(domain, 'youtube.com') && url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }

    if (domain === 'youtu.be') {
      const videoId = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      return `https://youtu.be/${videoId}`;
    }

    if (
      domainMatches(domain, 'imdb.com') &&
      /^\/(?:title\/tt\d+|name\/nm\d+)(?:\/|$)/.test(url.pathname)
    ) {
      url.search = '';
      return url.toString();
    }

    if (url.searchParams.size > 0) return null;

    return url.toString();
  } catch {
    return null;
  }
}

function toCandidate(event: CollectionEvent): NavigationCandidate | null {
  if (event.type !== 'navigation' || !event.meta?.url || !event.meta?.pid) {
    return null;
  }

  try {
    const url = new URL(event.meta.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const domain = normalizeDomain(url.hostname);
    if (!domain || isLocalNetworkHost(domain)) return null;

    const data = event.data as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title : null;

    return {
      domain,
      hue: event.meta.cursor_color ?? '#4a9a8a',
      pid: event.meta.pid,
      recentDomainVisits: 1,
      title,
      url: event.meta.url,
      visitedAt: event.ts,
    };
  } catch {
    return null;
  }
}

function buildScenery(candidates: NavigationCandidate[]): CommuteSceneryItem[] {
  const scenery: CommuteSceneryItem[] = [];
  const seenDomains = new Set<string>();

  for (const candidate of candidates) {
    if (seenDomains.has(candidate.domain)) continue;
    scenery.push({
      id: `${candidate.domain}:${candidate.visitedAt}`,
      domain: candidate.domain,
      visitedAt: candidate.visitedAt,
      hue: candidate.hue,
    });
    seenDomains.add(candidate.domain);
    if (scenery.length === SCENERY_LIMIT) break;
  }

  return scenery;
}

function buildDestinations(
  candidates: NavigationCandidate[],
): CommuteDestination[] {
  const destinations: CommuteDestination[] = [];
  const seenDomains = new Set<string>();
  const stopsByRider = new Map<string, number>();
  const rankedCandidates = [...candidates].sort((first, second) => {
    const visitDifference =
      first.recentDomainVisits - second.recentDomainVisits;
    if (visitDifference !== 0) return visitDifference;
    return second.visitedAt - first.visitedAt;
  });

  for (const candidate of rankedCandidates) {
    const url = sanitizePublicDestinationUrl(candidate.url);
    if (!url || seenDomains.has(candidate.domain)) continue;

    const title = getMeaningfulTitle(candidate.title, candidate.domain);
    if (
      TITLE_REQUIRED_DOMAINS.some((domain) =>
        domainMatches(candidate.domain, domain),
      ) &&
      !title
    ) {
      continue;
    }

    const riderStopCount = stopsByRider.get(candidate.pid) ?? 0;
    if (riderStopCount >= 2) continue;

    destinations.push({
      id: url,
      url,
      domain: candidate.domain,
      title,
      visitedAt: candidate.visitedAt,
      hue: candidate.hue,
    });
    seenDomains.add(candidate.domain);
    stopsByRider.set(candidate.pid, riderStopCount + 1);
    if (destinations.length === DESTINATION_LIMIT) break;
  }

  return destinations;
}

function countActivePeople(
  cursorEvents: CollectionEvent[],
  now: number,
): number {
  const cutoff = now - ACTIVE_PEOPLE_WINDOW_MS;
  const activePeople = new Set<string>();

  for (const event of cursorEvents) {
    if (
      event.type !== 'cursor' ||
      !event.meta?.pid ||
      Math.min(event.ts, now) < cutoff
    ) {
      continue;
    }
    activePeople.add(event.meta.pid);
  }

  return activePeople.size;
}

export function buildCommuteResponse(
  navigationEvents: CollectionEvent[],
  cursorEvents: CollectionEvent[],
  now = Date.now(),
): CommuteResponse {
  const newestFirst = navigationEvents
    .map(toCandidate)
    .filter((candidate): candidate is NavigationCandidate => candidate !== null)
    .sort((first, second) => second.visitedAt - first.visitedAt);
  const visitsByDomain = new Map<string, number>();

  for (const candidate of newestFirst) {
    visitsByDomain.set(
      candidate.domain,
      (visitsByDomain.get(candidate.domain) ?? 0) + 1,
    );
  }

  const candidates = newestFirst.map((candidate) => ({
    ...candidate,
    recentDomainVisits: visitsByDomain.get(candidate.domain) ?? 1,
  }));

  return {
    generatedAt: now,
    activePeople: countActivePeople(cursorEvents, now),
    scenery: buildScenery(candidates),
    destinations: buildDestinations(candidates),
  };
}
