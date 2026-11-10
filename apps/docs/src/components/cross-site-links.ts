// ABOUTME: Single source of truth for the cross-site nav link list.
// ABOUTME: Imported by Playground.tsx (the React playground shell). The docs header uses header/site-nav.ts.

export type SurfaceKey = "home" | "docs" | "play";

export interface CrossSiteLink {
  key: SurfaceKey;
  label: string;
  href: string;
}

// Link targets follow the production layout (Astro `base: "/docs"` + the website
// Vite build serving `/`):
//   home  → `/`              (the website Vite build's root)
//   docs  → `/docs/`         (Starlight base)
//   /play → `/docs/play`     (Astro page emitted under the docs base)
// The label "/play" is the friendly name; the href is the real built path.
export const crossSiteLinks: CrossSiteLink[] = [
  { key: "home", label: "home", href: "/" },
  { key: "docs", label: "docs", href: "/docs/" },
  { key: "play", label: "/play", href: "/docs/play" },
];
