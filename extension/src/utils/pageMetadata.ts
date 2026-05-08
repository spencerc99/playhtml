// ABOUTME: DOM-side helpers for page metadata extraction. The pure
// ABOUTME: canonicalization helpers live in @playhtml/extension-types so
// ABOUTME: the worker (which has no DOM) can share the same algorithm.

import {
  canonicalizeUrl,
  buildPageRef,
  buildMetadataHash,
} from "@playhtml/extension-types";

// Re-export so existing call sites keep working.
export { canonicalizeUrl, buildPageRef, buildMetadataHash };

/**
 * Capture-time page metadata snapshot used by the extension's collectors.
 * The worker's database-row shape (with `metadata_hash` and `observed_at_ts`)
 * lives in @playhtml/extension-types under the same name; they're related
 * but not identical, so the extension keeps a local definition for clarity.
 */
export interface PageMetadataSnapshot {
  page_ref: string;
  canonical_url: string;
  title: string;
  favicon_url: string;
}

export function getPageTitle(fallback?: string): string {
  const safeFallback =
    fallback ||
    (typeof window.location.hostname === "string" && window.location.hostname.length > 0
      ? window.location.hostname
      : "unknown");

  return (document.title || safeFallback).trim() || safeFallback;
}

export function getFaviconUrl(): string {
  const faviconLink = document.querySelector(
    'link[rel~="icon"], link[rel="shortcut icon"]'
  ) as HTMLLinkElement | null;

  // Return the declared icon href, or empty string if the page hasn't declared
  // one. Consumers fall back to Google's S2 favicon service — the naive
  // `${hostname}/favicon.ico` path 404s on many major sites (GitHub, HN, are.na,
  // etc.) and pollutes the event store with broken URLs.
  return faviconLink?.href ?? "";
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
