// ABOUTME: Wikipedia-specific collaborative browsing features.
// ABOUTME: Link glow visualization, cursor following, and navigation broadcast for article links.

import type { CustomSiteDeps } from "./index";
import { FollowManager } from "../features/FollowManager";

// Matches /wiki/ArticleName but not /wiki/Special: /wiki/Talk: etc.
export function isWikiArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url, location.origin);
    return /\/wiki\//.test(parsed.pathname) && !/\/wiki\/[A-Za-z_]+:/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export async function initWikipedia(deps: CustomSiteDeps): Promise<() => void> {
  const cleanups: (() => void)[] = [];

  // Link glow
  const { LinkGlowManager } = await import("../features/LinkGlowManager");
  const glowManager = new LinkGlowManager(deps.playerColor, deps.createPageData);
  glowManager.init();
  cleanups.push(() => glowManager.destroy());

  // Follow manager
  const followManager = new FollowManager(deps.presence);
  followManager.init();
  cleanups.push(() => followManager.destroy());

  // Wire proximity detection into the cursor client
  if (deps.cursorClient) {
    deps.cursorClient.configure({
      proximityThreshold: 250,
      onProximityEntered: (identity: any, positions: any) => {
        followManager.onProximityEntered(identity, positions);
      },
      onProximityLeft: (connectionId: string) => {
        followManager.onProximityLeft(connectionId);
      },
    });
  }

  // Domain-wide lobby for cross-page awareness
  let lobbyPresence = deps.presence; // fallback to page presence if lobby unavailable
  if (typeof deps.createPresenceRoom === "function") {
    const lobby = deps.createPresenceRoom("lobby");
    lobby.presence.setMyPresence("page", {
      url: location.href,
      title: document.title.replace(/ - Wikipedia$/, ""),
      color: deps.playerColor,
    });
    lobbyPresence = lobby.presence;
    cleanups.push(() => lobby.destroy());
  }

  // Ambient presence count + jump-to-someone
  const { PresenceCountPill } = await import("../features/PresenceCountPill");
  const presencePill = new PresenceCountPill(deps.presence, lobbyPresence);
  presencePill.init();
  cleanups.push(() => presencePill.destroy());

  // Broadcast navigatingTo on Wikipedia article link clicks.
  // Only delay navigation when someone is following — solo users get instant clicks.
  const onClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!link || !link.href || link.target === "_blank") return;

    try {
      const url = new URL(link.href);
      if (url.origin !== location.origin) return;
      if (!isWikiArticleUrl(url.href)) return;

      console.log("[Wiki] link click:", url.pathname, "hasFollowers:", followManager.hasFollowers());
      if (followManager.hasFollowers()) {
        // Delay navigation so followers see the navigatingTo awareness update
        e.preventDefault();
        deps.presence.setMyPresence("navigatingTo", {
          url: url.href,
          title: link.textContent?.trim().slice(0, 100) ?? url.pathname,
        });
        console.log("[Wiki] broadcasting navigatingTo, delaying 200ms");
        setTimeout(() => {
          window.location.href = url.href;
        }, 200);
      }
    } catch { /* ignore invalid URLs */ }
  };
  document.addEventListener("click", onClick, { capture: true });
  cleanups.push(() => document.removeEventListener("click", onClick, { capture: true }));

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
