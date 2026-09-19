// ABOUTME: Classifies bounded page-response evidence for Internet Commute destinations.
// ABOUTME: Keeps network retrieval separate so inspection can run asynchronously and safely.

export type PublicPageVerdict =
  | 'public'
  | 'gated'
  | 'not_public'
  | 'unavailable'
  | 'unknown';

export type PublicPageReason =
  | 'public_html'
  | 'authentication_required'
  | 'access_restricted'
  | 'login_redirect'
  | 'noindex'
  | 'not_html'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'unresolved_redirect'
  | 'unsafe_redirect'
  | 'redirect_loop'
  | 'too_many_redirects'
  | 'network_error'
  | 'incomplete_head'
  | 'metadata_only'
  | 'unexpected_status';

export interface PublicPageEvidence {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  xRobotsTag: string | null;
  htmlHead: string;
  formActions?: string[];
  metaRefreshes?: string[];
}

export interface PublicPageInspection {
  verdict: PublicPageVerdict;
  reason: PublicPageReason;
  finalUrl: string;
}

const AUTHENTICATION_PATH_SEGMENTS = new Set([
  'account',
  'accounts',
  'auth',
  'authorize',
  'login',
  'oauth',
  'session',
  'signin',
  'sso',
]);

function hasAuthenticationPath(url: URL): boolean {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => AUTHENTICATION_PATH_SEGMENTS.has(segment.toLowerCase()));
}

function resolvesToAuthenticationPath(value: string, baseUrl: URL): boolean {
  try {
    return hasAuthenticationPath(new URL(value, baseUrl));
  } catch {
    return false;
  }
}

function getMetaRefreshUrl(value: string): string | null {
  const match = value.match(/(?:^|;)\s*url\s*=\s*["']?([^"']+?)["']?\s*$/i);
  return match?.[1]?.trim() ?? null;
}

function hasNoindexDirective(value: string | null): boolean {
  return (
    value !== null &&
    /(?:^|[\s,;])(?:noindex|none)(?:$|[\s,;])/i.test(value)
  );
}

function getHtmlAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(
    new RegExp(
      `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
      'i',
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function getMetaRobotsContent(htmlHead: string): string[] {
  const directives: string[] = [];
  const metaTags = htmlHead.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const name = getHtmlAttribute(tag, 'name')?.toLowerCase();
    if (name !== 'robots' && name !== 'wewere-online') continue;

    const content = getHtmlAttribute(tag, 'content');
    if (content) directives.push(content);
  }

  return directives;
}

function isLoginDocument(
  htmlHead: string,
  formActions: string[],
  finalUrl: URL,
): boolean {
  if (
    !/<input\b[^>]*\s+type\s*=\s*(?:"password"|'password'|password)(?=\s|\/?>)[^>]*>/i.test(
      htmlHead,
    )
  ) {
    return false;
  }

  const title =
    htmlHead
      .match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';
  return (
    /^(?:log[ -]?in|sign[ -]?in|authentication required|single sign[ -]?on)(?:\s*[-–—|].*)?$/i.test(
      title,
    ) ||
    formActions.some((action) => resolvesToAuthenticationPath(action, finalUrl))
  );
}

export function classifyPublicPage(
  evidence: PublicPageEvidence,
): PublicPageInspection {
  const finalUrl = new URL(evidence.finalUrl);

  if (evidence.status === 401) {
    return {
      verdict: 'gated',
      reason: 'authentication_required',
      finalUrl: finalUrl.toString(),
    };
  }

  if (evidence.status === 403) {
    return {
      verdict: 'unknown',
      reason: 'access_restricted',
      finalUrl: finalUrl.toString(),
    };
  }

  if (evidence.status === 404 || evidence.status === 410) {
    return {
      verdict: 'unavailable',
      reason: 'not_found',
      finalUrl: finalUrl.toString(),
    };
  }

  if (evidence.status === 429) {
    return {
      verdict: 'unavailable',
      reason: 'rate_limited',
      finalUrl: finalUrl.toString(),
    };
  }

  if (evidence.status >= 500) {
    return {
      verdict: 'unavailable',
      reason: 'server_error',
      finalUrl: finalUrl.toString(),
    };
  }

  if (evidence.status >= 300 && evidence.status < 400) {
    return {
      verdict: 'unknown',
      reason: 'unresolved_redirect',
      finalUrl: finalUrl.toString(),
    };
  }

  if (evidence.status < 200 || evidence.status >= 300) {
    return {
      verdict: 'unavailable',
      reason: 'unexpected_status',
      finalUrl: finalUrl.toString(),
    };
  }

  if (
    hasAuthenticationPath(finalUrl) &&
    finalUrl.toString() !== evidence.requestedUrl
  ) {
    return {
      verdict: 'gated',
      reason: 'login_redirect',
      finalUrl: finalUrl.toString(),
    };
  }

  if (
    (evidence.metaRefreshes ?? [])
      .map(getMetaRefreshUrl)
      .some((url) => url !== null && resolvesToAuthenticationPath(url, finalUrl))
  ) {
    return {
      verdict: 'gated',
      reason: 'login_redirect',
      finalUrl: finalUrl.toString(),
    };
  }

  if (hasNoindexDirective(evidence.xRobotsTag)) {
    return {
      verdict: 'not_public',
      reason: 'noindex',
      finalUrl: finalUrl.toString(),
    };
  }

  const contentType = evidence.contentType?.toLowerCase() ?? '';
  if (
    !contentType.includes('text/html') &&
    !contentType.includes('application/xhtml+xml')
  ) {
    return {
      verdict: 'not_public',
      reason: 'not_html',
      finalUrl: finalUrl.toString(),
    };
  }

  if (getMetaRobotsContent(evidence.htmlHead).some(hasNoindexDirective)) {
    return {
      verdict: 'not_public',
      reason: 'noindex',
      finalUrl: finalUrl.toString(),
    };
  }

  if (isLoginDocument(evidence.htmlHead, evidence.formActions ?? [], finalUrl)) {
    return {
      verdict: 'gated',
      reason: 'authentication_required',
      finalUrl: finalUrl.toString(),
    };
  }

  return {
    verdict: 'public',
    reason: 'public_html',
    finalUrl: finalUrl.toString(),
  };
}
