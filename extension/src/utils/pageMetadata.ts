// ABOUTME: Shared helpers for extracting and hashing page metadata
// ABOUTME: Used by collectors and site-discovery flows to avoid duplicated logic
// ABOUTME: canonicalizeUrl is intentionally free of window/document so it also runs server-side.

export interface PageMetadataSnapshot {
  page_ref: string;
  canonical_url: string;
  title: string;
  favicon_url: string;
}

/**
 * Query parameters that are universally analytics/attribution-only and never
 * carry page-identity information. Only params where we are certain they don't
 * affect page content belong here — ambiguous ones like "ref" or "source" are
 * intentionally excluded because some sites use them as meaningful content params
 * (e.g. GitHub's ?tab=, search pages' ?q=, YouTube's ?v=).
 */
const TRACKING_PARAMS = new Set([
  // Google Analytics / Ads — always tracking, never content
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  '_ga', 'gclid', 'gclsrc',
  // Meta / Facebook
  'fbclid',
  // Microsoft
  'msclkid',
  // Twitter / X
  'twclid',
  // Mailchimp
  'mc_cid', 'mc_eid',
  // Instagram
  'igshid',
  // Yandex
  'yclid',
]);

/**
 * Build a stable canonical URL for page identity.
 *
 * Normalizations applied:
 * - Strips hash fragment (in-page anchors should dedupe to the same page_ref)
 * - Strips known tracking/session query parameters
 * - Sorts remaining query parameters for a deterministic order
 * - Removes a trailing slash from non-root paths (e.g. /wiki/Python/ → /wiki/Python)
 *
 * Does NOT depend on window/document, so it can run in both browser and server contexts.
 * Pass `base` when resolving relative URLs outside of a browser environment.
 */
export function canonicalizeUrl(inputUrl: string, base?: string): string {
  try {
    const parsed = new URL(inputUrl, base);

    // 1. Strip hash fragment
    parsed.hash = '';

    // 2. Remove tracking params
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    }

    // 3. Sort remaining params for deterministic order
    parsed.searchParams.sort();

    // 4. Remove trailing slash from non-root paths
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return inputUrl;
  }
}

/**
 * Generate a compact stable page reference from canonical URL.
 * Uses FNV-1a for speed and deterministic output (non-cryptographic).
 */
export function buildPageRef(canonicalUrl: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonicalUrl.length; i++) {
    hash ^= canonicalUrl.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pr_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function getPageTitle(fallback?: string): string {
  const safeFallback =
    fallback ||
    (typeof window.location.hostname === 'string' && window.location.hostname.length > 0
      ? window.location.hostname
      : 'unknown');

  return (document.title || safeFallback).trim() || safeFallback;
}

export function getFaviconUrl(): string {
  const faviconLink = document.querySelector(
    'link[rel~="icon"], link[rel="shortcut icon"]'
  ) as HTMLLinkElement | null;

  if (faviconLink?.href) {
    return faviconLink.href;
  }

  const protocol = window.location.protocol || 'https:';
  const hostname = window.location.hostname || 'localhost';
  return `${protocol}//${hostname}/favicon.ico`;
}

export function getCurrentPageMetadata(url = window.location.href): PageMetadataSnapshot {
  const canonicalUrl = canonicalizeUrl(url);
  return {
    page_ref: buildPageRef(canonicalUrl),
    canonical_url: canonicalUrl,
    title: getPageTitle(),
    favicon_url: getFaviconUrl(),
  };
}

export function buildMetadataHash(title: string, faviconUrl: string): string {
  const value = `${title}\u0001${faviconUrl}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `mh_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
