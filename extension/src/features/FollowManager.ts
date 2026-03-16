// ABOUTME: Handles the "follow someone" interaction on shared pages.
// ABOUTME: Follow state, scroll tethering, and cross-page navigation via presence API.

import type { PresenceAPI } from "@playhtml/common";
import { isWikiArticleUrl } from "../custom-sites/wikipedia";

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
  private hintShownForKeys = new Set<string>();
  private hintElement: HTMLElement | null = null;
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;
  private nearestTarget: { publicKey: string; color: string } | null = null;
  private cleanups: (() => void)[] = [];

  // UI elements
  private vignetteElement: HTMLElement | null = null;
  private statusBarElement: HTMLElement | null = null;
  private navToastElement: HTMLElement | null = null;
  private navToastTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingNavUrl: string | null = null;

  // Scroll tether
  private tetherRafId: number | null = null;
  private userOverrideUntil = 0;

  // Mutual follow callback
  private onMutualFollow: ((active: boolean) => void) | null = null;

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

    this.nearestTarget = { publicKey, color };

    // Show hint near the midpoint between the two cursors
    if (!this.hintElement) {
      const hintX = positions
        ? (positions.ours.x + positions.theirs.x) / 2
        : window.innerWidth / 2;
      const hintY = positions
        ? (positions.ours.y + positions.theirs.y) / 2
        : window.innerHeight / 2;
      this.showHint(hintX, hintY, color);
    }
  }

  // Called by cursor options onProximityLeft
  onProximityLeft(connectionId: string): void {
    if (this.nearestTarget?.publicKey === connectionId) {
      this.nearestTarget = null;
      this.removeHint();
    }
  }

  destroy(): void {
    this.removeHint();
    this.removeFollowUI();
    this.removeNavToast();
    this.stopScrollTether();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  setMutualFollowCallback(cb: (active: boolean) => void): void {
    this.onMutualFollow = cb;
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
    // If nav toast is showing, follow to that URL
    if (this.pendingNavUrl && this.followState) {
      const url = this.pendingNavUrl;
      const targetKey = this.followState.targetPublicKey;
      const targetColor = this.followState.targetColor;
      this.removeNavToast();
      sessionStorage.setItem(
        "playhtml-follow-target",
        JSON.stringify({
          publicKey: targetKey,
          color: targetColor,
        }),
      );
      window.location.href = url;
      return;
    }

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
    this.stopScrollTether();
  }

  // --- Hint UI ---

  private showHint(x: number, y: number, color: string): void {
    this.removeHint();

    const hint = document.createElement("div");
    Object.assign(hint.style, {
      position: "fixed",
      left: `${x + 20}px`,
      top: `${y + 20}px`,
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
      transition: "opacity 0.3s ease",
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
            this.showNavToast(nav.url, nav.title);
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
            this.showNavToast(lastSeenNav.url, lastSeenNav.title);
          } else {
            this.showLeftToast();
          }
        } else if (!this.pendingNavUrl) {
          this.showLostToast();
          this.unfollow();
        }
      }
    };

    const interval = setInterval(check, 150);
    this.cleanups.push(() => clearInterval(interval));
  }

  private onMutualFollowStart(): void {
    this.onMutualFollow?.(true);
    if (this.statusBarElement && this.followState) {
      const color = this.followState.targetColor;
      this.statusBarElement.textContent = "";
      this.statusBarElement.append(
        colorDot(color),
        "following together ",
        muted("/ to chat", { marginLeft: "2px" }),
        muted(" "),
        muted("esc to stop", { marginLeft: "4px" }),
      );
    }
  }

  private onMutualFollowEnd(): void {
    this.onMutualFollow?.(false);
  }

  // --- Nav toast ---

  private showNavToast(url: string, title: string): void {
    this.removeNavToast();
    this.pendingNavUrl = url;

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
    const displayTitle =
      title.length > 40 ? title.slice(0, 40) + "..." : title;
    const strong = document.createElement("strong");
    strong.textContent = displayTitle;
    const followHint = document.createElement("span");
    Object.assign(followHint.style, { color: "#8a8279", marginLeft: "6px" });
    followHint.append("press ", kbd("F"), " to follow");
    toast.append("went to ", strong, followHint);

    document.body.appendChild(toast);
    this.navToastElement = toast;
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
    });

    this.navToastTimeout = setTimeout(() => {
      this.removeNavToast();
      this.unfollow();
    }, 8000);
  }

  private removeNavToast(): void {
    if (this.navToastTimeout) {
      clearTimeout(this.navToastTimeout);
      this.navToastTimeout = null;
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
      setTimeout(() => this.unfollow(), 3000);
    }
  }

  private showLostToast(): void {
    if (this.statusBarElement) {
      this.statusBarElement.textContent = "";
      this.statusBarElement.append(muted("lost them"));
      setTimeout(() => this.removeFollowUI(), 2000);
    }
  }
}
