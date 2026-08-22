// ABOUTME: Defines normalized identities and human policy types for Internet places.
// ABOUTME: Keeps page, hostname, and site keys identical across the Worker and curation desk.

import { canonicalizeUrl } from '@playhtml/extension-types';
import { getDomain } from 'tldts';

export const INTERNET_PLACE_SCOPES = ['page', 'hostname', 'site'] as const;
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
  if (!url.hostname.includes('.')) {
    throw new Error('Internet places require a complete public hostname.');
  }
  if (scope === 'page') return canonicalizeUrl(url.toString());
  if (scope === 'hostname') return url.hostname;

  const site = getDomain(url.hostname, { allowPrivateDomains: true });
  if (!site) throw new Error('The site boundary could not be determined.');
  return site;
}

export function getInternetPlaceLookupKeys(value: string): Array<{
  scope: InternetPlaceScope;
  placeKey: string;
}> {
  return INTERNET_PLACE_SCOPES.map((scope) => ({
    scope,
    placeKey: normalizeInternetPlace(value, scope),
  }));
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
  const byKey = new Map(
    [...policies].map((policy) => [
      getInternetPlacePolicyKey(policy.scope, policy.placeKey),
      policy,
    ]),
  );
  for (const lookup of getInternetPlaceLookupKeys(value)) {
    const policy = byKey.get(
      getInternetPlacePolicyKey(lookup.scope, lookup.placeKey),
    );
    if (policy) return policy;
  }
  return undefined;
}
