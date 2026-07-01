// ABOUTME: Shared URLs and active-path helpers for the extension website.
// ABOUTME: Keeps site navigation state consistent across standalone pages.

export const LIVE_PORTRAIT_URL = "/portrait/";
export const CHANGELOG_URL = "/changelog/";

export function isNavigationPathActive(pathname: string, href: string) {
  return normalizePath(pathname) === normalizePath(href);
}

function normalizePath(path: string) {
  const [pathname] = path.split(/[?#]/);

  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}
