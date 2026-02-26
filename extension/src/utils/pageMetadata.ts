// ABOUTME: Shared helpers for extracting and hashing page metadata
// ABOUTME: Used by collectors and site-discovery flows to avoid duplicated logic

export interface PageMetadataSnapshot {
  page_ref: string;
  canonical_url: string;
  title: string;
  favicon_url: string;
}

/**
 * Build a stable canonical URL for page identity.
 * We intentionally drop hash fragments so in-page anchors dedupe to one page_ref.
 */
export function canonicalizeUrl(inputUrl: string): string {
  try {
    const parsed = new URL(inputUrl, window.location.href);
    parsed.hash = '';
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
