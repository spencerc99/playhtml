// ABOUTME: The playhtml.fun site nav shared by the docs header and the docs mobile menu.
// ABOUTME: Mirrors the homepage header in website/index.html; keep the two in sync.

export interface SiteNavLink {
  key: string;
  label: string;
  href: string;
  // Rendered in italic serif with the we were online icon.
  wwo?: boolean;
}

export const siteNavLinks: SiteNavLink[] = [
  { key: "docs", label: "docs", href: "/docs/" },
  { key: "examples", label: "examples", href: "/docs/examples/" },
  { key: "gallery", label: "gallery", href: "/gallery/" },
  { key: "events", label: "events", href: "/events/walking-together/" },
  {
    key: "wwo",
    label: "we were online",
    href: "https://wewere.online",
    wwo: true,
  },
];

export const discordHref = "https://discord.gg/SKbsSf4ptU";
export const githubHref = "https://github.com/spencerc99/playhtml";
export const supportHref = "https://github.com/sponsors/spencerc99";

// Examples pages light up "examples"; every other docs page lights up "docs".
export function activeNavKey(pathname: string): string {
  return /^\/docs\/examples(\/|$)/.test(pathname) ? "examples" : "docs";
}
