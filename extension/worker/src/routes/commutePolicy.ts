// ABOUTME: Reduces raw browsing events into the privacy-limited Internet Commute response.
// ABOUTME: Keeps private activity as domain-only scenery and curates clickable public pages.

import {
  canonicalizeUrl,
  type CollectionEvent,
  type CommuteDestination,
  type CommuteResponse,
  type CommuteSceneryItem,
} from '@playhtml/extension-types';
import { getDomain, getDomainWithoutSuffix, getSubdomain } from 'tldts';

const ACTIVE_PEOPLE_WINDOW_MS = 2 * 60_000;
const DESTINATION_LIMIT = 50;
const BASE_SCENERY_LIMIT = 100;
const MAX_SCENERY_LIMIT = 200;
const NAVIGATION_EVENTS_PER_SCENERY_ITEM = 5;

const MOVIE_TV_STREAMING_DOMAINS = [
  'amcplus.com',
  'britbox.com',
  'criterionchannel.com',
  'crunchyroll.com',
  'directv.com',
  'discoveryplus.com',
  'disneyplus.com',
  'fubo.tv',
  'hoopladigital.com',
  'hulu.com',
  'kanopy.com',
  'max.com',
  'mubi.com',
  'netflix.com',
  'paramountplus.com',
  'peacocktv.com',
  'philo.com',
  'play.hbomax.com',
  'pluto.tv',
  'primevideo.com',
  'showtime.com',
  'sling.com',
  'starz.com',
  'therokuchannel.roku.com',
  'tubitv.com',
  'tv.apple.com',
  'video.amazon.com',
  'viki.com',
  'watch.plex.tv',
];

const AI_SCENERY_ONLY_DOMAINS = [
  'anthropic.com',
  'bolt.new',
  'character.ai',
  'chat.deepseek.com',
  'chatgpt.com',
  'claude.ai',
  'cognition.ai',
  'copilot.microsoft.com',
  'cursor.com',
  'deepwiki.com',
  'devin.ai',
  'gemini.google.com',
  'grok.com',
  'janitorai.com',
  'lovable.dev',
  'manus.im',
  'meta.ai',
  'midjourney.com',
  'mistral.ai',
  'openai.com',
  'perplexity.ai',
  'pi.ai',
  'poe.com',
  'runwayml.com',
  'spicychat.ai',
  'stability.ai',
  'suno.com',
  'v0.dev',
  'x.ai',
  'you.com',
];

const SCENERY_ONLY_DOMAINS = [
  'accounts.google.com',
  ...AI_SCENERY_ONLY_DOMAINS,
  'ai.joinhandshake.com',
  'airtable.com',
  'app.flourish.studio',
  'app.joinhandshake.com',
  'app.mural.co',
  'app.slack.com',
  'apply.commonapp.org',
  'bing.com',
  'bsky.app',
  'calendar.google.com',
  'discord.com',
  'docs.google.com',
  'docs.superhuman.com',
  'drive.google.com',
  'duckduckgo.com',
  'ecosia.org',
  'ellipsus.com',
  'facebook.com',
  'figma.com',
  'form.typeform.com',
  'joinoasis.com',
  'jotform.com',
  'linkedin.com',
  'mail.google.com',
  'meet.google.com',
  'messenger.com',
  'miro.com',
  ...MOVIE_TV_STREAMING_DOMAINS,
  'myaccount.google.com',
  'mygju.gju.edu.jo',
  'myjobs.indeed.com',
  'notion.so',
  'onedrive.live.com',
  'onlyfans.com',
  'outlook.cloud.microsoft',
  'outlook.live.com',
  'outlook.office.com',
  'open.spotify.com',
  'partiful.com',
  'patreon.com',
  'photos.google.com',
  'profile.indeed.com',
  'proton.me',
  'safelinks.protection.outlook.com',
  'search.brave.com',
  'smartapply.indeed.com',
  'snapchat.com',
  'startpage.com',
  'stoat.chat',
  'tally.so',
  'tasks.google.com',
  'tiktok.com',
  'twitch.tv',
  'twitter.com',
  'van.dpo.org',
  'vk.com',
  'web.telegram.org',
  'x.com',
];

const GENERIC_BUSINESS_HOMEPAGE_DOMAINS = [
  'adobe.com',
  'airbnb.com',
  'apple.com',
  'bestbuy.com',
  'canva.com',
  'garmin.com',
  'microsoft.com',
  'ouraring.com',
  'paypal.com',
  'shopify.com',
  'stripe.com',
  'vercel.com',
  'wayfair.com',
];

const MEANINGFUL_TITLE_REQUIRED_DOMAINS = ['itch.io', 'wordpress.com'];

const GENERIC_PATHS = new Set([
  '/browse',
  '/dashboard',
  '/feed',
  '/home',
  '/newtab',
  '/notifications',
  '/saved',
  '/search',
]);

const PRODUCT_PATH_PATTERNS = [
  /\/products?\/[^/]+(?:\/|$)/i,
  /\/listings?\/[^/]+(?:\/|$)/i,
];

const NEVER_SHOW_SUBDOMAIN_LABELS = new Set(['auth', 'tracking']);

const SCENERY_ONLY_SUBDOMAIN_LABELS = new Set([
  'account',
  'accounts',
  'admin',
  'apply',
  'candidate',
  'dashboard',
  'file',
  'files',
  'fs',
  'idp',
  'idpproxy',
  'inside',
  'intranet',
  'login',
  'mail',
  'my',
  'mysignin',
  'mysignins',
  'portal',
  'profile',
  'signin',
  'signins',
  'sso',
]);

const SCENERY_ONLY_PATH_SEGMENTS = new Set([
  'account',
  'accounts',
  'admin',
  'auth',
  'authorize',
  'cart',
  'checkout',
  'download',
  'editor',
  'inbox',
  'login',
  'myschedule',
  'mypolicy',
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

const SCENERY_ONLY_PATH_PREFIXES = [
  {
    domain: 'nytimes.com',
    prefixes: ['/puzzles/stats'],
  },
];

const PRIVATE_ROUTE_SEGMENTS = new Set([
  'board',
  'chat',
  'client',
  'document',
  'edit',
  'e2ee',
  'messages',
  'room',
  'rooms',
  'workspace',
]);

const AUTHENTICATION_PATH_MARKERS = [
  'oauth2callback',
  'saml2acs',
  'signinoidc',
  'simplesaml',
];

const RAW_ASSET_EXTENSIONS = new Set([
  '7z',
  'avi',
  'avif',
  'bmp',
  'csv',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'mov',
  'mp3',
  'mp4',
  'mpeg',
  'ogg',
  'pdf',
  'png',
  'rar',
  'svg',
  'tar',
  'txt',
  'wav',
  'webm',
  'webp',
  'zip',
]);

const WIKIPEDIA_PRIVATE_NAMESPACES = new Set([
  'benutzer',
  'benutzerdiskussion',
  'discussaodeusuario',
  'discussionutilisateur',
  'discussioniutente',
  'dyskusjauzytkownika',
  'gebruiker',
  'overleggebruiker',
  'special',
  'user',
  'usertalk',
  'usuario',
  'usuariodiscusion',
  'utente',
  'utilisateur',
  'uzytkownik',
  'anvandare',
  'anvandardiskussion',
  'обсуждениеучастника',
  'участник',
  '使用者',
  '使用者討論',
  '利用者',
  '利用者会話',
  '用户',
  '用户讨论',
  '用戶',
  '用戶討論',
  '사용자',
  '사용자토론',
]);

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
  registrableDomain: string;
  title: string | null;
  url: string;
  visitedAt: number;
}

interface PlatformRoutePolicy {
  matches: (domain: string) => boolean;
  sanitize: (url: URL) => string | null;
}

function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

function comparableLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function getRegistrableDomain(domain: string): string | null {
  return getDomain(domain, { allowPrivateDomains: true });
}

function getSubdomainLabels(domain: string): string[] {
  return (
    getSubdomain(domain, { allowPrivateDomains: true })
      ?.split('.')
      .filter(Boolean) ?? []
  );
}

function hasSubdomainLabel(domain: string, labels: Set<string>): boolean {
  return getSubdomainLabels(domain).some((label) =>
    labels.has(comparableLabel(label)),
  );
}

function isNeverShownHost(
  domain: string,
  registrableDomain: string | null,
): boolean {
  return (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.local') ||
    registrableDomain === null ||
    hasSubdomainLabel(domain, NEVER_SHOW_SUBDOMAIN_LABELS)
  );
}

function isOpaqueIdentifier(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
    (/^[a-z0-9_-]{8,}={0,2}$/i.test(segment) && /\d/.test(segment))
  );
}

function hasPrivateRouteShape(pathname: string): boolean {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  return segments.some((segment, index) => {
    if (!PRIVATE_ROUTE_SEGMENTS.has(comparableLabel(segment))) return false;
    return segments.slice(index + 1).some(isOpaqueIdentifier);
  });
}

function hasRawAssetPath(pathname: string): boolean {
  const filename = pathname.split('/').at(-1)?.toLowerCase() ?? '';
  const extension = filename.includes('.') ? filename.split('.').at(-1) : null;
  return extension ? RAW_ASSET_EXTENSIONS.has(extension) : false;
}

function hasQueryLikePath(pathname: string): boolean {
  try {
    return /(?:^|[&?])(?:q|query|search)=/i.test(decodeURIComponent(pathname));
  } catch {
    return false;
  }
}

function hasBlockedPath(pathname: string, domain: string): boolean {
  const normalizedPathname = pathname.toLowerCase();
  if (
    [...GENERIC_PATHS].some(
      (path) =>
        normalizedPathname === path ||
        normalizedPathname.startsWith(`${path}/`),
    )
  ) {
    return true;
  }

  if (
    SCENERY_ONLY_PATH_PREFIXES.some(
      (rule) =>
        domainMatches(domain, rule.domain) &&
        rule.prefixes.some(
          (prefix) =>
            normalizedPathname === prefix ||
            normalizedPathname.startsWith(`${prefix}/`),
        ),
    )
  ) {
    return true;
  }

  return pathname.split('/').some((segment) => {
    const label = comparableLabel(segment);
    return (
      SCENERY_ONLY_PATH_SEGMENTS.has(label) ||
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

function sanitizeContentUrl(url: URL): string {
  url.search = '';
  return canonicalizeUrl(url.toString());
}

function sanitizeProductUrl(
  url: URL,
  domain: string,
): string | null | undefined {
  if (
    getDomainWithoutSuffix(domain, { allowPrivateDomains: true }) === 'amazon'
  ) {
    const productId = url.pathname.match(
      /\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i,
    )?.[1];
    return productId ? `${url.origin}/dp/${productId.toUpperCase()}` : null;
  }

  const isProductPage = PRODUCT_PATH_PATTERNS.some((pattern) =>
    pattern.test(url.pathname),
  );

  return isProductPage ? sanitizeContentUrl(url) : undefined;
}

function normalizeWikipediaNamespace(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function isWikipediaArticle(pathname: string): boolean {
  if (!pathname.startsWith('/wiki/')) return false;

  try {
    const pageName = decodeURIComponent(pathname.slice('/wiki/'.length));
    const namespaceSeparator = pageName.indexOf(':');
    if (namespaceSeparator === -1) return true;

    const namespace = normalizeWikipediaNamespace(
      pageName.slice(0, namespaceSeparator),
    );
    return !WIKIPEDIA_PRIVATE_NAMESPACES.has(namespace);
  } catch {
    return false;
  }
}

const GITHUB_NON_REPOSITORY_ROUTES = new Set([
  'about',
  'collections',
  'customer-stories',
  'enterprise',
  'enterprises',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'search',
  'security',
  'settings',
  'sponsors',
  'topics',
  'trending',
  'users',
]);

const PLATFORM_ROUTE_POLICIES: PlatformRoutePolicy[] = [
  {
    matches: (domain) => domainMatches(domain, 'youtube.com'),
    sanitize: (url) => {
      if (url.pathname !== '/watch') return null;
      const videoId = url.searchParams.get('v');
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    },
  },
  {
    matches: (domain) => domain === 'youtu.be',
    sanitize: (url) => {
      const videoId = url.pathname.replace(/^\/+/, '').split('/')[0];
      return /^[A-Za-z0-9_-]{11}$/.test(videoId)
        ? `https://youtu.be/${videoId}`
        : null;
    },
  },
  {
    matches: (domain) => domainMatches(domain, 'imdb.com'),
    sanitize: (url) =>
      /^\/(?:title\/tt\d+|name\/nm\d+)(?:\/|$)/.test(url.pathname)
        ? sanitizeContentUrl(url)
        : null,
  },
  {
    matches: (domain) => domain === 'archive.org',
    sanitize: (url) =>
      /^\/details\/[^/]+(?:\/|$)/.test(url.pathname)
        ? sanitizeContentUrl(url)
        : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'pinterest.com'),
    sanitize: (url) =>
      /^\/pin\/\d+(?:\/|$)/.test(url.pathname) ? sanitizeContentUrl(url) : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'github.com'),
    sanitize: (url) => {
      const segments = url.pathname.split('/').filter(Boolean);
      if (
        segments.length < 2 ||
        GITHUB_NON_REPOSITORY_ROUTES.has(segments[0].toLowerCase())
      ) {
        return null;
      }
      return sanitizeContentUrl(url);
    },
  },
  {
    matches: (domain) => domainMatches(domain, 'archiveofourown.org'),
    sanitize: (url) =>
      /^\/works\/\d+(?:\/|$)/.test(url.pathname)
        ? sanitizeContentUrl(url)
        : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'roblox.com'),
    sanitize: (url) =>
      /^\/games\/\d+(?:\/|$)/.test(url.pathname)
        ? sanitizeContentUrl(url)
        : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'substack.com'),
    sanitize: (url) =>
      /^\/(?:p\/[^/]+|@[^/]+\/p\/[^/]+)(?:\/|$)/.test(url.pathname)
        ? sanitizeContentUrl(url)
        : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'wikipedia.org'),
    sanitize: (url) =>
      isWikipediaArticle(url.pathname) ? sanitizeContentUrl(url) : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'instagram.com'),
    sanitize: (url) =>
      /^\/(?:p|reel|tv)\/[^/]+(?:\/|$)/.test(url.pathname)
        ? sanitizeContentUrl(url)
        : null,
  },
  {
    matches: (domain) => domainMatches(domain, 'tumblr.com'),
    sanitize: (url) => {
      const isCustomBlogPost =
        domainMatches(normalizeDomain(url.hostname), 'tumblr.com') &&
        normalizeDomain(url.hostname) !== 'tumblr.com' &&
        /^\/post\/\d+(?:\/|$)/.test(url.pathname);
      const isCentralPost = /^\/[^/]+\/\d+(?:\/|$)/.test(url.pathname);
      return isCustomBlogPost || isCentralPost ? sanitizeContentUrl(url) : null;
    },
  },
  {
    matches: (domain) =>
      getDomainWithoutSuffix(domain, { allowPrivateDomains: true }) ===
        'google' && getSubdomainLabels(domain).length === 0,
    sanitize: () => null,
  },
];

function getPlatformDestinationUrl(
  url: URL,
  domain: string,
): string | null | undefined {
  const policy = PLATFORM_ROUTE_POLICIES.find((candidate) =>
    candidate.matches(domain),
  );
  return policy ? policy.sanitize(url) : undefined;
}

function hasPersonBoundRoute(url: URL, domain: string): boolean {
  return (
    (domainMatches(domain, 'last.fm') &&
      /^\/user\/[^/]+(?:\/|$)/.test(url.pathname)) ||
    (domainMatches(domain, 'artfight.net') &&
      /^\/~[^/]+(?:\/|$)/.test(url.pathname))
  );
}

function isGenericBusinessHomepage(url: URL, domain: string): boolean {
  return (
    url.pathname === '/' &&
    GENERIC_BUSINESS_HOMEPAGE_DOMAINS.some((candidate) =>
      domainMatches(domain, candidate),
    )
  );
}

function isVercelPreviewDomain(domain: string): boolean {
  if (!domain.endsWith('.vercel.app')) return false;

  const deploymentName = domain.slice(0, -'.vercel.app'.length);
  if (deploymentName.includes('-git-')) return true;

  const hasGeneratedHash = deploymentName
    .split('-')
    .some(
      (part) =>
        part.length >= 8 && /[a-z]/.test(part) && /\d/.test(part),
    );
  return deploymentName.length >= 40 && hasGeneratedHash;
}

function isExcludedDestinationSurface(url: URL, domain: string): boolean {
  return (
    Boolean(url.username || url.password) ||
    SCENERY_ONLY_DOMAINS.some((candidate) =>
      domainMatches(domain, candidate),
    ) ||
    hasSubdomainLabel(domain, SCENERY_ONLY_SUBDOMAIN_LABELS) ||
    isGenericBusinessHomepage(url, domain) ||
    isVercelPreviewDomain(domain) ||
    hasBlockedPath(url.pathname || '/', domain) ||
    hasPrivateRouteShape(url.pathname) ||
    hasPersonBoundRoute(url, domain) ||
    hasRawAssetPath(url.pathname) ||
    hasQueryLikePath(url.pathname)
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

    const platformUrl = getPlatformDestinationUrl(url, domain);
    if (platformUrl !== undefined) return platformUrl;

    const productUrl = sanitizeProductUrl(url, domain);
    if (productUrl !== undefined) return productUrl;

    if (url.searchParams.size > 0) return null;

    return canonicalizeUrl(url.toString());
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
    const registrableDomain = getRegistrableDomain(domain);
    if (
      !domain ||
      !registrableDomain ||
      url.username ||
      url.password ||
      isNeverShownHost(domain, registrableDomain)
    ) {
      return null;
    }

    const data = event.data as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title : null;

    return {
      domain,
      hue: event.meta.cursor_color ?? '#4a9a8a',
      pid: event.meta.pid,
      recentDomainVisits: 1,
      registrableDomain,
      title,
      url: event.meta.url,
      visitedAt: event.ts,
    };
  } catch {
    return null;
  }
}

function getSceneryLimit(navigationEventCount: number): number {
  return Math.min(
    MAX_SCENERY_LIMIT,
    Math.max(
      BASE_SCENERY_LIMIT,
      Math.ceil(navigationEventCount / NAVIGATION_EVENTS_PER_SCENERY_ITEM),
    ),
  );
}

function buildScenery(
  candidates: NavigationCandidate[],
  limit: number,
): CommuteSceneryItem[] {
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
    if (scenery.length === limit) break;
  }

  return scenery;
}

function buildDestinations(
  candidates: NavigationCandidate[],
): CommuteDestination[] {
  const destinations: CommuteDestination[] = [];
  const seenRegistrableDomains = new Set<string>();
  const stopsByRider = new Map<string, number>();
  const rankedCandidates = [...candidates].sort((first, second) => {
    const visitDifference =
      first.recentDomainVisits - second.recentDomainVisits;
    if (visitDifference !== 0) return visitDifference;
    return second.visitedAt - first.visitedAt;
  });

  for (const candidate of rankedCandidates) {
    const url = sanitizePublicDestinationUrl(candidate.url);
    if (!url || seenRegistrableDomains.has(candidate.registrableDomain)) {
      continue;
    }

    const title = getMeaningfulTitle(candidate.title, candidate.domain);
    if (
      MEANINGFUL_TITLE_REQUIRED_DOMAINS.some((domain) =>
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
    seenRegistrableDomains.add(candidate.registrableDomain);
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
      candidate.registrableDomain,
      (visitsByDomain.get(candidate.registrableDomain) ?? 0) + 1,
    );
  }

  const candidates = newestFirst.map((candidate) => ({
    ...candidate,
    recentDomainVisits: visitsByDomain.get(candidate.registrableDomain) ?? 1,
  }));

  return {
    generatedAt: now,
    activePeople: countActivePeople(cursorEvents, now),
    scenery: buildScenery(candidates, getSceneryLimit(candidates.length)),
    destinations: buildDestinations(candidates),
  };
}
