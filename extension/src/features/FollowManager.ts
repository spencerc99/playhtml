// ABOUTME: Handles the "follow someone" interaction on shared pages.
// ABOUTME: Proximity detection, follow state, scroll tethering, and cross-page navigation.

export interface FollowState {
  targetPublicKey: string;
  targetColor: string;
  mutualFollow: boolean;
  scrollTetherActive: boolean;
  userOverrideUntil: number;
}

const PROXIMITY_THRESHOLD = 400; // px
const HINT_DISMISS_MS = 4000;

export class FollowManager {
  private followState: FollowState | null = null;
  private hintShownForKeys = new Set<string>();
  private hintElement: HTMLElement | null = null;
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;
  private nearestTarget: { publicKey: string; color: string } | null = null;
  private mousePos = { x: 0, y: 0 };
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

  constructor(
    private getPresences: () => Map<string, any>,
    private getMyPublicKey: () => string,
    private setMyAwareness: (fields: Record<string, any>) => void,
  ) {}

  init(): void {
    // Check for stored follow intent from cross-page navigation
    const stored = sessionStorage.getItem("playhtml-follow-target");
    if (stored) {
      sessionStorage.removeItem("playhtml-follow-target");
      try {
        const { publicKey, color } = JSON.parse(stored);
        setTimeout(() => this.follow(publicKey, color), 1000);
      } catch {
        /* ignore invalid stored data */
      }
    }

    // Mouse tracking
    const onMouseMove = (e: MouseEvent) => {
      this.mousePos = { x: e.pageX, y: e.pageY };
      this.checkProximity();
    };
    document.addEventListener("mousemove", onMouseMove);
    this.cleanups.push(() =>
      document.removeEventListener("mousemove", onMouseMove),
    );

    // Keyboard handler
    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    document.addEventListener("keydown", onKeyDown);
    this.cleanups.push(() =>
      document.removeEventListener("keydown", onKeyDown),
    );
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

  private checkProximity(): void {
    if (this.followState) return;

    const presences = this.getPresences();
    const myKey = this.getMyPublicKey();
    let nearest: { key: string; color: string; dist: number } | null = null;

    for (const [stableId, presence] of presences) {
      if (stableId === myKey || !presence.cursor) continue;
      const dx = presence.cursor.x - this.mousePos.x;
      const dy = presence.cursor.y - this.mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PROXIMITY_THRESHOLD) {
        const color =
          presence.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#4a9a8a";
        if (!nearest || dist < nearest.dist) {
          nearest = { key: stableId, color, dist };
        }
      }
    }

    if (nearest && !this.hintShownForKeys.has(nearest.key)) {
      this.nearestTarget = { publicKey: nearest.key, color: nearest.color };
      this.hintShownForKeys.add(nearest.key);
      this.showHint(this.mousePos.x, this.mousePos.y, nearest.color);
    } else if (!nearest) {
      this.nearestTarget = null;
    }
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
    this.setMyAwareness({ following: publicKey });
    this.showFollowUI();
    this.startScrollTether();
    this.watchTargetNavigation();
  }

  private unfollow(): void {
    this.followState = null;
    this.setMyAwareness({ following: undefined });
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
    hint.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>press <kbd style="border:1px solid rgba(90,78,65,0.3);border-radius:2px;padding:1px 4px;font-family:monospace;font-size:11px">F</kbd> to follow`;

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
    bar.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>following <span style="color:#8a8279;margin-left:4px">esc to stop</span>`;
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
    const onScroll = () => {
      this.userOverrideUntil = Date.now() + 2000;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    this.cleanups.push(() => window.removeEventListener("scroll", onScroll));

    const tick = () => {
      this.tetherRafId = requestAnimationFrame(tick);

      if (!this.followState) return;
      if (Date.now() < this.userOverrideUntil) return;

      const presences = this.getPresences();
      const target = presences.get(this.followState.targetPublicKey);
      if (!target?.cursor) return;

      const targetY = target.cursor.y;
      const viewTop = window.scrollY;
      const viewBottom = viewTop + window.innerHeight;
      const margin = window.innerHeight * 0.2;

      if (targetY > viewTop + margin && targetY < viewBottom - margin) return;

      const targetScroll = targetY - window.innerHeight / 2;
      const diff = targetScroll - window.scrollY;
      const speed = Math.min(Math.abs(diff) * 0.03, 4);
      window.scrollBy(0, Math.sign(diff) * speed);
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
    const check = () => {
      if (!this.followState) return;
      const presences = this.getPresences();
      const target = presences.get(this.followState.targetPublicKey);

      if (target?.navigatingTo && !this.pendingNavUrl) {
        this.showNavToast(target.navigatingTo.url, target.navigatingTo.title);
      }

      // Mutual follow detection
      if (
        target?.following === this.getMyPublicKey() &&
        this.followState &&
        !this.followState.mutualFollow
      ) {
        this.followState.mutualFollow = true;
        this.onMutualFollowStart();
      } else if (
        target?.following !== this.getMyPublicKey() &&
        this.followState?.mutualFollow
      ) {
        this.followState.mutualFollow = false;
        this.onMutualFollowEnd();
      }

      // Target went offline
      if (!target && this.followState) {
        this.showLostToast();
        this.unfollow();
      }
    };

    const interval = setInterval(check, 200);
    this.cleanups.push(() => clearInterval(interval));
  }

  private onMutualFollowStart(): void {
    this.onMutualFollow?.(true);
    if (this.statusBarElement && this.followState) {
      const color = this.followState.targetColor;
      this.statusBarElement.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>following together <span style="color:#8a8279;margin-left:2px">/ to chat</span> <span style="color:#8a8279;margin-left:4px">esc to stop</span>`;
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
    toast.innerHTML = `went to <strong>${displayTitle}</strong> <span style="color:#8a8279;margin-left:6px">press <kbd style="border:1px solid rgba(90,78,65,0.3);border-radius:2px;padding:1px 4px;font-family:monospace;font-size:11px">F</kbd> to follow</span>`;

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

  private showLostToast(): void {
    if (this.statusBarElement) {
      this.statusBarElement.innerHTML = `<span style="color:#8a8279">lost them</span>`;
      setTimeout(() => this.removeFollowUI(), 2000);
    }
  }
}
