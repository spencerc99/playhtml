// ABOUTME: Ambient indicator showing how many people are on the current page.
// ABOUTME: Includes a jump-to-someone button powered by a domain-wide lobby.

import type { PresenceAPI } from "@playhtml/common";
import {
  isWikipediaPortalArticleUrl,
  type WikiPresenceView,
} from "../custom-sites/wikipedia";

// Concentric ellipses suggesting a portal
const PORTAL_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <ellipse cx="7" cy="7" rx="4.5" ry="6" stroke="currentColor" stroke-width="1.2" fill="none"/>
  <ellipse cx="7" cy="7" rx="2.5" ry="4" stroke="currentColor" stroke-width="0.8" opacity="0.5" fill="none"/>
  <circle cx="7" cy="7" r="1" fill="currentColor" opacity="0.6"/>
</svg>`;

const LOBBY_PAGE_TTL_MS = 30_000;

export class PresenceCountPill {
  private element: HTMLElement | null = null;
  private jumpBtn: HTMLElement | null = null;
  private cleanups: (() => void)[] = [];
  private lastFingerprint = "";
  private isHidden = false;
  private chatOpen = false;
  private chatUnread = false;

  constructor(
    private presence: PresenceAPI,
    private lobbyPresence: PresenceAPI,
    private chatToggle?: () => void,
  ) {}

  init(): void {
    const check = () => {
      const pagePresences = this.presence.getPresences();
      const lobbyPresences = this.lobbyPresence.getPresences();

      const myKey = this.getMyPublicKey(pagePresences, lobbyPresences);
      const pageOtherKeys = this.uniqueOtherKeys(pagePresences, myKey);
      const lobbyOtherPageKeys = this.uniqueOtherPageKeys(lobbyPresences, myKey);

      const pageOthers = pageOtherKeys.size;
      const elsewhere = lobbyOtherPageKeys.size;
      const fingerprint = `${pageOthers}:${elsewhere}`;

      if (fingerprint !== this.lastFingerprint) {
        this.lastFingerprint = fingerprint;
        this.render(pageOthers, elsewhere, pagePresences, pageOtherKeys, myKey);
      }
    };

    const interval = setInterval(check, 1000);
    this.cleanups.push(() => clearInterval(interval));
    check();

    const onHashChange = () => this.updateHiddenState();
    window.addEventListener("hashchange", onHashChange);
    this.cleanups.push(() => window.removeEventListener("hashchange", onHashChange));
    this.updateHiddenState();
  }

  private updateHiddenState(): void {
    const shouldHide = /^#\/media\//.test(location.hash);
    if (shouldHide === this.isHidden) return;
    this.isHidden = shouldHide;
    if (this.element) {
      this.element.style.display = shouldHide ? "none" : "flex";
    }
  }

  private getMyPublicKey(...maps: Map<string, any>[]): string | null {
    // Prefer the lobby's own identity (always populated locally) over scanning
    // presences for isMe — remote tabs of the same human are NOT marked isMe,
    // so relying on isMe alone misses the dedupe case we care about.
    try {
      const fromLobby = this.lobbyPresence.getMyIdentity?.()?.publicKey;
      if (fromLobby) return fromLobby;
    } catch { /* ignore */ }
    try {
      const fromPage = this.presence.getMyIdentity?.()?.publicKey;
      if (fromPage) return fromPage;
    } catch { /* ignore */ }
    for (const m of maps) {
      for (const p of m.values()) {
        if (p.isMe && p.playerIdentity?.publicKey) return p.playerIdentity.publicKey;
      }
    }
    return null;
  }

  // Lobby presences don't carry __playhtml_cursors__ for remote peers, so
  // playerIdentity is undefined there. We piggy-back the pid on the `page`
  // payload (set in wikipedia.ts) and read it back here.
  private pidOf(p: any): string | null {
    return p?.playerIdentity?.publicKey ?? p?.page?.pid ?? null;
  }

  private uniqueOtherKeys(presences: Map<string, any>, myKey: string | null): Set<string> {
    const keys = new Set<string>();
    presences.forEach((p, connectionId) => {
      if (p.isMe) return;
      const key = this.pidOf(p);
      if (key && myKey && key === myKey) return;
      keys.add(key ?? `conn:${connectionId}`);
    });
    return keys;
  }

  private isFreshLobbyPage(
    page: WikiPresenceView["page"],
  ): page is NonNullable<WikiPresenceView["page"]> {
    if (!page?.url) return false;
    if (page.visible !== true) return false;
    if (!isWikipediaPortalArticleUrl(page.url)) return false;
    if (typeof page.lastSeenAt !== "number") return false;
    return Date.now() - page.lastSeenAt <= LOBBY_PAGE_TTL_MS;
  }

  private isCurrentPageUrl(url: string): boolean {
    try {
      const candidate = new URL(url, location.href);
      const current = new URL(location.href);
      return (
        candidate.origin === current.origin &&
        candidate.pathname === current.pathname &&
        candidate.search === current.search
      );
    } catch {
      return url === location.href;
    }
  }

  private uniqueOtherPageKeys(presences: Map<string, any>, myKey: string | null): Set<string> {
    const keys = new Set<string>();
    presences.forEach((p, connectionId) => {
      if (p.isMe) return;
      const key = this.pidOf(p);
      if (key && myKey && key === myKey) return;
      const page = (p as WikiPresenceView).page;
      if (!this.isFreshLobbyPage(page) || this.isCurrentPageUrl(page.url)) return;
      keys.add(key ?? `conn:${connectionId}`);
    });
    return keys;
  }

  destroy(): void {
    this.element?.remove();
    this.element = null;
    this.jumpBtn = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  private render(
    pageOthers: number,
    elsewhere: number,
    pagePresences: Map<string, any>,
    pageOtherKeys: Set<string>,
    myKey: string | null,
  ): void {
    const totalOthers = pageOthers + elsewhere;
    if (totalOthers === 0) {
      this.element?.remove();
      this.element = null;
      this.jumpBtn = null;
      return;
    }

    if (!this.element) {
      this.element = document.createElement("div");
      Object.assign(this.element.style, {
        position: "fixed",
        bottom: "16px",
        right: "16px",
        fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
        fontSize: "11px",
        color: "#8a8279",
        background: "rgba(250, 247, 242, 0.9)",
        border: "1px solid rgba(90, 78, 65, 0.15)",
        borderRadius: "12px",
        padding: "4px 10px",
        zIndex: "2147483640",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        transition: "opacity 0.3s ease",
        opacity: "0",
      });
      document.body.appendChild(this.element);
      if (this.isHidden) this.element.style.display = "none";
      requestAnimationFrame(() => {
        if (this.element) this.element.style.opacity = "1";
      });
    }

    this.element.textContent = "";

    // Colored dots for unique users on this page (up to 5), deduped by publicKey
    const seen = new Set<string>();
    let dotCount = 0;
    pagePresences.forEach((p) => {
      if (p.isMe || dotCount >= 5) return;
      const key = this.pidOf(p);
      if (key && myKey && key === myKey) return;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      const color = p.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#8a8279";
      this.element!.appendChild(this.createDot(color));
      dotCount++;
    });

    // "N here" label
    const hereLabel = document.createElement("span");
    hereLabel.textContent = `${pageOthers + 1} here`;
    this.element.appendChild(hereLabel);

    // "M elsewhere" if there are people on other pages
    if (elsewhere > 0) {
      const elsewhereLabel = document.createElement("span");
      Object.assign(elsewhereLabel.style, { color: "#a09890" });
      elsewhereLabel.textContent = `\u00b7 ${elsewhere} elsewhere`;
      this.element.appendChild(elsewhereLabel);

      // Jump button
      this.jumpBtn = this.createJumpButton();
      this.element.appendChild(this.jumpBtn);
    } else {
      this.jumpBtn = null;
    }

    // Chat segment
    if (this.chatToggle) {
      const sep = document.createElement("span");
      Object.assign(sep.style, { opacity: "0.35", margin: "0 1px" });
      sep.textContent = "\u00b7";
      this.element.appendChild(sep);
      this.element.appendChild(this.createChatSegment());
    }

    // Pill border accent when chat is open
    this.element.style.borderColor = this.chatOpen
      ? "rgba(196, 114, 78, 0.4)"
      : "rgba(90, 78, 65, 0.15)";
  }

  private createChatSegment(): HTMLElement {
    const seg = document.createElement("span");
    Object.assign(seg.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "3px",
      cursor: "pointer",
      padding: "1px 5px",
      borderRadius: "8px",
      transition: "background 120ms ease, color 120ms ease",
      pointerEvents: "auto",
    });
    if (this.chatOpen) {
      seg.style.background = "rgba(196, 114, 78, 0.15)";
      seg.style.color = "#c4724e";
    }

    const icon = document.createElement("span");
    icon.textContent = "\u25a4"; // small square with horizontal lines
    icon.style.fontSize = "11px";
    seg.appendChild(icon);

    const label = document.createElement("span");
    label.textContent = "chat";
    seg.appendChild(label);

    if (this.chatUnread) {
      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "5px",
        height: "5px",
        borderRadius: "50%",
        background: "#c4724e",
        display: "inline-block",
        marginLeft: "2px",
      });
      seg.appendChild(dot);
    }

    seg.addEventListener("click", (e) => {
      e.stopPropagation();
      this.chatToggle?.();
    });
    return seg;
  }

  setChatOpen(open: boolean): void {
    if (open === this.chatOpen) return;
    this.chatOpen = open;
    this.rerender();
  }

  setChatUnread(unread: boolean): void {
    if (unread === this.chatUnread) return;
    this.chatUnread = unread;
    this.rerender();
  }

  private rerender(): void {
    const pagePresences = this.presence.getPresences();
    const lobbyPresences = this.lobbyPresence.getPresences();
    const myKey = this.getMyPublicKey(pagePresences, lobbyPresences);
    const pageOtherKeys = this.uniqueOtherKeys(pagePresences, myKey);
    const lobbyOtherPageKeys = this.uniqueOtherPageKeys(lobbyPresences, myKey);
    const pageOthers = pageOtherKeys.size;
    const elsewhere = lobbyOtherPageKeys.size;
    this.lastFingerprint = "";
    this.render(pageOthers, elsewhere, pagePresences, pageOtherKeys, myKey);
  }

  private createDot(color: string): HTMLElement {
    const dot = document.createElement("span");
    Object.assign(dot.style, {
      display: "inline-block",
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: color,
    });
    return dot;
  }

  private createJumpButton(): HTMLElement {
    const btn = document.createElement("button");
    Object.assign(btn.style, {
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: "2px",
      display: "flex",
      alignItems: "center",
      color: "#4a9a8a",
      opacity: "0.7",
      transition: "opacity 0.2s",
      marginLeft: "2px",
      pointerEvents: "auto",
    });
    btn.innerHTML = PORTAL_SVG;
    btn.title = "jump to someone";
    btn.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.opacity = "0.7"; });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.jumpToSomeone();
    });
    return btn;
  }

  private jumpToSomeone(): void {
    const presences = this.lobbyPresence.getPresences();
    const myKey = this.getMyPublicKey(presences, this.presence.getPresences());
    const otherPages: { url: string; title: string }[] = [];
    const seenKeys = new Set<string>();

    presences.forEach((p) => {
      if (p.isMe) return;
      const key = this.pidOf(p);
      // Same human in another tab — skip so we don't teleport to our own pages.
      if (key && myKey && key === myKey) return;
      const page = (p as WikiPresenceView).page;
      if (!this.isFreshLobbyPage(page) || this.isCurrentPageUrl(page.url)) return;
      if (key && seenKeys.has(key)) return;
      if (key) seenKeys.add(key);
      otherPages.push({ url: page.url, title: page.title });
    });

    if (otherPages.length === 0) {
      this.showToast("no one else around");
      return;
    }

    const target = otherPages[Math.floor(Math.random() * otherPages.length)];
    window.location.href = target.url;
  }

  private showToast(text: string): void {
    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "44px",
      right: "16px",
      fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
      fontSize: "11px",
      color: "#8a8279",
      background: "rgba(250, 247, 242, 0.95)",
      border: "1px solid rgba(90, 78, 65, 0.15)",
      borderRadius: "4px",
      padding: "4px 8px",
      zIndex: "2147483640",
      transition: "opacity 0.3s ease",
      opacity: "0",
    });
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}
