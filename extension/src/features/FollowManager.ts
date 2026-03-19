// ABOUTME: Handles the "follow someone" interaction on shared pages.
// ABOUTME: Follow state, scroll tethering, and cross-page navigation via presence API.

import type { PresenceAPI } from "@playhtml/common";
import { isWikiArticleUrl } from "../custom-sites/wikipedia";
import { OffscreenIndicator } from "./OffscreenIndicator";

export interface FollowState {
  targetPublicKey: string;
  targetColor: string;
  mutualFollow: boolean;
  scrollTetherActive: boolean;
  userOverrideUntil: number;
}

const HINT_DISMISS_MS = 4000;

function colorDot(color: string, extraStyles?: Partial<CSSStyleDeclaration>): HTMLSpanElement {
  const dot = document.createElement("span");
  Object.assign(dot.style, {
    display: "inline-block",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: color,
    ...extraStyles,
  });
  return dot;
}

function kbd(text: string): HTMLElement {
  const el = document.createElement("kbd");
  Object.assign(el.style, {
    border: "1px solid rgba(90,78,65,0.3)",
    borderRadius: "2px",
    padding: "1px 4px",
    fontFamily: "monospace",
    fontSize: "11px",
  });
  el.textContent = text;
  return el;
}

function muted(text: string, extraStyles?: Partial<CSSStyleDeclaration>): HTMLSpanElement {
  const el = document.createElement("span");
  Object.assign(el.style, { color: "#8a8279", ...extraStyles });
  el.textContent = text;
  return el;
}

export class FollowManager {
  private followState: FollowState | null = null;
  private hintElement: HTMLElement | null = null;
  private nearbyCursors = new Map<string, { color: string; dist: number }>();
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;
  private nearestTarget: { publicKey: string; color: string } | null = null;
  private cleanups: (() => void)[] = [];

  // UI elements
  private vignetteElement: HTMLElement | null = null;
  private statusBarElement: HTMLElement | null = null;
  private navToastElement: HTMLElement | null = null;
  private pendingNavUrl: string | null = null;

  // Navigation watching
  private navWatchInterval: ReturnType<typeof setInterval> | null = null;
  private leftToastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Scroll tether
  private tetherRafId: number | null = null;
  private userOverrideUntil = 0;

  // Mutual follow callback
  private onMutualFollow: ((active: boolean) => void) | null = null;

  // "Being followed" state
  private followerBarElement: HTMLElement | null = null;
  private currentFollowers = new Set<string>();

  // Off-screen cursor indicators
  private offscreenIndicator = new OffscreenIndicator();

  constructor(private presence: PresenceAPI) {}

  init(): void {
    // Check for stored follow intent from cross-page navigation
    const stored = sessionStorage.getItem("playhtml-follow-target");
    if (stored) {
      sessionStorage.removeItem("playhtml-follow-target");
      try {
        const { publicKey, color } = JSON.parse(stored);
        this.presence.setMyPresence("navigatingTo", null);
        setTimeout(() => this.follow(publicKey, color), 1000);
      } catch {
        /* ignore invalid stored data */
      }
    }

    // Keyboard handler
    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    document.addEventListener("keydown", onKeyDown);
    this.cleanups.push(() =>
      document.removeEventListener("keydown", onKeyDown),
    );

    this.watchForFollowers();
  }

  // Called by cursor options onProximityEntered
  onProximityEntered(
    identity: any,
    positions?: { ours: { x: number; y: number }; theirs: { x: number; y: number } },
  ): void {
    if (this.followState) return;
    const publicKey = identity?.publicKey;
    const color = identity?.playerStyle?.colorPalette?.[0] ?? "#4a9a8a";
    if (!publicKey) return;

    // Track all nearby cursors, pick the closest
    const dist = positions
      ? Math.sqrt(
          (positions.ours.x - positions.theirs.x) ** 2 +
          (positions.ours.y - positions.theirs.y) ** 2,
        )
      : Infinity;

    this.nearbyCursors.set(publicKey, { color, dist });
    this.updateNearestAndHint(positions);
  }

  // Called by cursor options onProximityLeft
  onProximityLeft(connectionId: string): void {
    this.nearbyCursors.delete(connectionId);
    if (this.nearestTarget?.publicKey === connectionId) {
      this.updateNearestAndHint();
    }
  }

  private updateNearestAndHint(
    positions?: { ours: { x: number; y: number }; theirs: { x: number; y: number } },
  ): void {
    // Find the closest nearby cursor
    let closest: { publicKey: string; color: string; dist: number } | null = null;
    for (const [key, val] of this.nearbyCursors) {
      if (!closest || val.dist < closest.dist) {
        closest = { publicKey: key, color: val.color, dist: val.dist };
      }
    }

    if (!closest) {
      this.nearestTarget = null;
      this.removeHint();
      return;
    }

    this.nearestTarget = { publicKey: closest.publicKey, color: closest.color };

    // Position hint near the other cursor (offset slightly)
    const hintX = positions?.theirs?.x ?? window.innerWidth / 2;
    const hintY = positions?.theirs?.y ?? window.innerHeight / 2;
    this.showHint(hintX, hintY, closest.color);
  }

  destroy(): void {
    this.removeHint();
    this.removeFollowUI();
    this.removeNavToast();
    this.stopNavWatch();
    this.stopScrollTether();
    this.offscreenIndicator.destroy();
    this.followerBarElement?.remove();
    this.followerBarElement = null;
    this.currentFollowers.clear();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  setMutualFollowCallback(cb: (active: boolean) => void): void {
    this.onMutualFollow = cb;
  }

  hasFollowers(): boolean {
    return this.currentFollowers.size > 0;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    )
      return;

    if (e.key === "f" || e.key === "F") {
      this.handleFollowKey();
    }
    if (e.key === "Escape" && this.followState) {
      this.unfollow();
    }
  }

  private handleFollowKey(): void {
    if (this.followState) {
      this.unfollow();
      return;
    }
    if (this.nearestTarget) {
      this.removeHint();
      this.follow(this.nearestTarget.publicKey, this.nearestTarget.color);
    }
  }

  private follow(publicKey: string, color: string): void {
    this.followState = {
      targetPublicKey: publicKey,
      targetColor: color,
      mutualFollow: false,
      scrollTetherActive: true,
      userOverrideUntil: 0,
    };
    this.presence.setMyPresence("following", publicKey);
    this.showFollowUI();
    this.startScrollTether();
    this.watchTargetNavigation();
  }

  private unfollow(): void {
    this.followState = null;
    this.presence.setMyPresence("following", null);
    this.removeFollowUI();
    this.removeNavToast();
    this.stopNavWatch();
    this.stopScrollTether();
    this.offscreenIndicator.destroy();
    if (this.leftToastTimeout) {
      clearTimeout(this.leftToastTimeout);
      this.leftToastTimeout = null;
    }
  }

  // --- Hint UI ---

  private showHint(x: number, y: number, color: string): void {
    // If hint exists, just update position
    if (this.hintElement) {
      this.hintElement.style.left = `${x + 20}px`;
      this.hintElement.style.top = `${y - 30}px`;
      return;
    }

    const hint = document.createElement("div");
    Object.assign(hint.style, {
      position: "fixed",
      left: `${x + 20}px`,
      top: `${y - 30}px`,
      fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
      fontSize: "12px",
      color: "#3d3833",
      background: "rgba(250, 247, 242, 0.95)",
      border: "1px solid rgba(90, 78, 65, 0.2)",
      borderRadius: "4px",
      padding: "6px 10px",
      zIndex: "2147483647",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.3s ease, left 0.1s ease, top 0.1s ease",
      whiteSpace: "nowrap",
    });
    hint.append(
      colorDot(color, { marginRight: "6px", verticalAlign: "middle" }),
      "press ",
      kbd("F"),
      " to follow",
    );

    document.body.appendChild(hint);
    this.hintElement = hint;
    requestAnimationFrame(() => {
      hint.style.opacity = "1";
    });
    this.hintTimeout = setTimeout(() => this.removeHint(), HINT_DISMISS_MS);
  }

  private removeHint(): void {
    if (this.hintTimeout) {
      clearTimeout(this.hintTimeout);
      this.hintTimeout = null;
    }
    if (this.hintElement) {
      this.hintElement.remove();
      this.hintElement = null;
    }
  }

  // --- Follow UI (vignette + status bar) ---

  private showFollowUI(): void {
    if (!this.followState) return;
    const color = this.followState.targetColor;

    const vignette = document.createElement("div");
    Object.assign(vignette.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646",
      boxShadow: `inset 0 0 120px 30px ${color}25`,
      transition: "opacity 0.5s ease",
      opacity: "0",
    });
    document.body.appendChild(vignette);
    this.vignetteElement = vignette;
    requestAnimationFrame(() => {
      vignette.style.opacity = "1";
    });

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "fixed",
      bottom: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
      fontSize: "12px",
      color: "#3d3833",
      background: "rgba(250, 247, 242, 0.95)",
      border: "1px solid rgba(90, 78, 65, 0.2)",
      borderRadius: "6px",
      padding: "8px 16px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      boxShadow: "0 2px 8px rgba(90, 78, 65, 0.1)",
      transition: "opacity 0.3s ease",
      opacity: "0",
    });
    bar.append(colorDot(color), "following ", muted("esc to stop", { marginLeft: "4px" }));
    document.body.appendChild(bar);
    this.statusBarElement = bar;
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
  }

  private removeFollowUI(): void {
    if (this.vignetteElement) {
      this.vignetteElement.style.opacity = "0";
      const el = this.vignetteElement;
      setTimeout(() => el.remove(), 500);
      this.vignetteElement = null;
    }
    if (this.statusBarElement) {
      this.statusBarElement.style.opacity = "0";
      const el = this.statusBarElement;
      setTimeout(() => el.remove(), 300);
      this.statusBarElement = null;
    }
  }

  // --- Scroll tether ---

  private startScrollTether(): void {
    let programmaticScroll = false;
    let lastTargetY: number | null = null;

    const onScroll = () => {
      if (programmaticScroll) return;
      // Follower scrolled manually — pause until followed cursor moves
      this.userOverrideUntil = Date.now() + 60000;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    this.cleanups.push(() => window.removeEventListener("scroll", onScroll));

    const tick = () => {
      this.tetherRafId = requestAnimationFrame(tick);
      if (!this.followState) return;

      const presences = this.presence.getPresences();
      const target = presences.get(this.followState.targetPublicKey);
      if (!target?.cursor) return;

      const targetY = target.cursor.y;

      // Update off-screen indicator for the followed cursor
      const targetClientY = targetY - window.scrollY;
      this.offscreenIndicator.update(
        this.followState.targetPublicKey,
        target.cursor.x,
        targetClientY,
        this.followState.targetColor,
      );

      // If the followed person's cursor moved vertically, re-engage tether
      if (lastTargetY !== null && Math.abs(targetY - lastTargetY) > 5) {
        this.userOverrideUntil = 0;
      }
      lastTargetY = targetY;

      if (Date.now() < this.userOverrideUntil) return;

      // Keep target cursor centered in viewport
      const desiredScroll = targetY - window.innerHeight / 2;
      const diff = desiredScroll - window.scrollY;

      if (Math.abs(diff) > 2) {
        programmaticScroll = true;
        window.scrollTo({
          top: window.scrollY + diff * 0.15,
          behavior: "instant",
        });
        requestAnimationFrame(() => { programmaticScroll = false; });
      }
    };

    this.tetherRafId = requestAnimationFrame(tick);
  }

  private stopScrollTether(): void {
    if (this.tetherRafId != null) {
      cancelAnimationFrame(this.tetherRafId);
      this.tetherRafId = null;
    }
  }

  // --- Navigation watching ---

  private watchTargetNavigation(): void {
    let lastSeenNav: { url: string; title: string } | null = null;

    const check = () => {
      if (!this.followState) return;
      const presences = this.presence.getPresences();
      const target = presences.get(this.followState.targetPublicKey);

      // Track the latest navigatingTo value
      const nav = (target as any)?.navigatingTo;
      if (nav) {
        lastSeenNav = nav;
        if (!this.pendingNavUrl) {
          if (isWikiArticleUrl(nav.url)) {
            this.showNavCountdown(nav.url, nav.title);
          } else {
            this.showLeftToast();
          }
        }
      }

      // Mutual follow detection
      if (
        (target as any)?.following === this.presence.getMyIdentity().publicKey &&
        this.followState &&
        !this.followState.mutualFollow
      ) {
        this.followState.mutualFollow = true;
        this.onMutualFollowStart();
      } else if (
        (target as any)?.following !== this.presence.getMyIdentity().publicKey &&
        this.followState?.mutualFollow
      ) {
        this.followState.mutualFollow = false;
        this.onMutualFollowEnd();
      }

      // Target went offline — check lastSeenNav before declaring lost
      if (!target && this.followState) {
        if (lastSeenNav && !this.pendingNavUrl) {
          if (isWikiArticleUrl(lastSeenNav.url)) {
            this.showNavCountdown(lastSeenNav.url, lastSeenNav.title);
          } else {
            this.showLeftToast();
          }
        } else if (!this.pendingNavUrl) {
          this.showLostToast();
          this.unfollow();
        }
      }
    };

    this.stopNavWatch();
    this.navWatchInterval = setInterval(check, 150);
  }

  private stopNavWatch(): void {
    if (this.navWatchInterval) {
      clearInterval(this.navWatchInterval);
      this.navWatchInterval = null;
    }
  }

  private onMutualFollowStart(): void {
    this.onMutualFollow?.(true);
    if (this.statusBarElement && this.followState) {
      const color = this.followState.targetColor;
      this.statusBarElement.textContent = "";
      this.statusBarElement.append(
        colorDot(color),
        " browsing together ",
        muted("esc to leave", { marginLeft: "4px" }),
      );
    }
  }

  private onMutualFollowEnd(): void {
    this.onMutualFollow?.(false);
  }

  // --- Nav countdown ---

  private navCountdownInterval: ReturnType<typeof setInterval> | null = null;

  private showNavCountdown(url: string, title: string): void {
    this.removeNavToast();
    this.pendingNavUrl = url;

    const displayTitle = title.length > 40 ? title.slice(0, 40) + "..." : title;
    let remaining = 3;

    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "56px",
      left: "50%",
      transform: "translateX(-50%)",
      fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
      fontSize: "13px",
      color: "#3d3833",
      background: "rgba(250, 247, 242, 0.97)",
      border: `1px solid ${this.followState?.targetColor ?? "rgba(90,78,65,0.2)"}`,
      borderRadius: "6px",
      padding: "10px 18px",
      zIndex: "2147483647",
      boxShadow: "0 4px 16px rgba(90, 78, 65, 0.15)",
      transition: "opacity 0.3s ease",
      opacity: "0",
      whiteSpace: "nowrap",
    });

    const updateText = () => {
      toast.textContent = "";
      const strong = document.createElement("strong");
      strong.textContent = displayTitle;
      toast.append("following to ", strong, ` ${remaining}...`);
      toast.append(document.createElement("br"));
      toast.append(muted("esc to cancel", { fontSize: "11px" }));
    };
    updateText();

    document.body.appendChild(toast);
    this.navToastElement = toast;
    requestAnimationFrame(() => { toast.style.opacity = "1"; });

    this.navCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.navigateToFollowed(url);
      } else {
        updateText();
      }
    }, 1000);
  }

  private navigateToFollowed(url: string): void {
    if (!this.followState) return;
    const targetKey = this.followState.targetPublicKey;
    const targetColor = this.followState.targetColor;
    this.removeNavToast();
    sessionStorage.setItem(
      "playhtml-follow-target",
      JSON.stringify({ publicKey: targetKey, color: targetColor }),
    );
    window.location.href = url;
  }

  private removeNavToast(): void {
    if (this.navCountdownInterval) {
      clearInterval(this.navCountdownInterval);
      this.navCountdownInterval = null;
    }
    if (this.navToastElement) {
      this.navToastElement.remove();
      this.navToastElement = null;
    }
    this.pendingNavUrl = null;
  }

  private showLeftToast(): void {
    if (this.statusBarElement && this.followState) {
      this.statusBarElement.textContent = "";
      this.statusBarElement.append(
        colorDot(this.followState.targetColor),
        " left Wikipedia",
      );
      this.leftToastTimeout = setTimeout(() => this.unfollow(), 3000);
    }
  }

  private showLostToast(): void {
    if (this.statusBarElement) {
      this.statusBarElement.textContent = "";
      this.statusBarElement.append(muted("lost them"));
      setTimeout(() => this.removeFollowUI(), 2000);
    }
  }

  // --- "Being followed" detection ---

  private watchForFollowers(): void {
    const check = () => {
      const presences = this.presence.getPresences();
      const myKey = this.presence.getMyIdentity().publicKey;
      const followers = new Set<string>();

      presences.forEach((p, id) => {
        if ((p as any).following === myKey && !p.isMe) {
          followers.add(id);
        }
      });

      // Detect changes
      const gained = [...followers].filter(id => !this.currentFollowers.has(id));
      const lost = [...this.currentFollowers].filter(id => !followers.has(id));

      if (gained.length > 0 || lost.length > 0) {
        // Remove off-screen indicators for followers who left
        for (const id of lost) {
          this.offscreenIndicator.remove(id);
        }
        this.currentFollowers = followers;
        this.updateFollowerBar(presences);
      }

      // Update off-screen indicators for current followers
      presences.forEach((p, id) => {
        if ((p as any).following === myKey && !p.isMe && p.cursor) {
          const color = p.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#8a8279";
          const clientY = p.cursor.y - window.scrollY;
          this.offscreenIndicator.update(id, p.cursor.x, clientY, color);
        }
      });
    };

    const interval = setInterval(check, 500);
    this.cleanups.push(() => clearInterval(interval));
  }

  private updateFollowerBar(presences: Map<string, any>): void {
    if (this.currentFollowers.size === 0) {
      this.followerBarElement?.remove();
      this.followerBarElement = null;
      return;
    }

    if (!this.followerBarElement) {
      this.followerBarElement = document.createElement("div");
      Object.assign(this.followerBarElement.style, {
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
        fontSize: "11px",
        color: "#8a8279",
        background: "rgba(250, 247, 242, 0.9)",
        border: "1px solid rgba(90, 78, 65, 0.15)",
        borderRadius: "4px",
        padding: "4px 10px",
        zIndex: "2147483645",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        transition: "opacity 0.3s ease",
        opacity: "0",
      });
      document.body.appendChild(this.followerBarElement);
      requestAnimationFrame(() => {
        if (this.followerBarElement) this.followerBarElement.style.opacity = "1";
      });
    }

    this.followerBarElement.textContent = "";
    for (const id of this.currentFollowers) {
      const p = presences.get(id);
      const color = p?.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#8a8279";
      this.followerBarElement.append(colorDot(color, { width: "6px", height: "6px" }));
    }
    const count = this.currentFollowers.size;
    this.followerBarElement.append(
      muted(`${count} following you`, { fontSize: "11px" }),
    );
  }
}
