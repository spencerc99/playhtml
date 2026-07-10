// ABOUTME: Derives the guestbook salutation ("dear ___,") address for a letter
// ABOUTME: from its page URL + title, plus the current page's favicon URL.

const MAX_ADDRESS_LENGTH = 48;

/** Strip a trailing " | Site Name" / " — Site Name" style suffix. Plain
 * hyphens are left alone (too common inside real titles). */
function stripSiteSuffix(title: string): string {
  const stripped = title.replace(/\s+[|·–—]\s+[^|·–—]+$/, "").trim();
  return stripped || title.trim();
}

/** Truncate at a word boundary, appending an ellipsis. */
function truncate(text: string): string {
  if (text.length <= MAX_ADDRESS_LENGTH) return text;
  const cut = text.slice(0, MAX_ADDRESS_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > MAX_ADDRESS_LENGTH / 2 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}…`;
}

export interface SalutationParts {
  label: string;
  domain?: string;
}

/**
 * The addressee for a letter's salutation. Root pages address the site itself
 * (bare domain); other pages address the page by its cleaned title, paired
 * with the domain so the salutation carries the URL's texture, falling back
 * to hostname + path when no title was captured.
 */
export function salutationParts(pageUrl: string, pageTitle?: string): SalutationParts {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return { label: pageTitle ? truncate(stripSiteSuffix(pageTitle)) : pageUrl };
  }
  const hostname = url.hostname.replace(/^www\./, "");
  const isRoot = url.pathname === "/" || /^\/index\.html?$/.test(url.pathname);
  if (isRoot) return { label: hostname };
  if (pageTitle && pageTitle.trim()) {
    return { label: truncate(stripSiteSuffix(pageTitle)), domain: hostname };
  }
  return { label: truncate(`${hostname}${url.pathname.replace(/\/$/, "")}`) };
}

/** The current page's favicon URL, if it declares one. */
export function currentFaviconUrl(): string | null {
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel~="icon"], link[rel="shortcut icon"]',
  );
  return link?.href || null;
}
