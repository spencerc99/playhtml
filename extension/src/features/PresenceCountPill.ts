// ABOUTME: Ambient indicator showing how many people are on the current page.
// ABOUTME: Includes a jump-to-someone button powered by a domain-wide lobby.

import type { PresenceAPI } from "@playhtml/common";
import type { WikiPresenceView } from "../custom-sites/wikipedia";

// Concentric ellipses suggesting a portal
const PORTAL_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <ellipse cx="7" cy="7" rx="4.5" ry="6" stroke="currentColor" stroke-width="1.2" fill="none"/>
  <ellipse cx="7" cy="7" rx="2.5" ry="4" stroke="currentColor" stroke-width="0.8" opacity="0.5" fill="none"/>
  <circle cx="7" cy="7" r="1" fill="currentColor" opacity="0.6"/>
</svg>`;

export class PresenceCountPill {
  private element: HTMLElement | null = null;
  private jumpBtn: HTMLElement | null = null;
  private cleanups: (() => void)[] = [];
  private lastFingerprint = "";

  constructor(
    private presence: PresenceAPI,
    private lobbyPresence: PresenceAPI,
  ) {}

  init(): void {
    const check = () => {
      const pagePresences = this.presence.getPresences();
      const lobbyPresences = this.lobbyPresence.getPresences();

      let pageOthers = 0;
      pagePresences.forEach((p) => { if (!p.isMe) pageOthers++; });

      let lobbyOthers = 0;
      lobbyPresences.forEach((p) => { if (!p.isMe) lobbyOthers++; });

      const elsewhere = Math.max(0, lobbyOthers - pageOthers);
      const fingerprint = `${pageOthers}:${elsewhere}`;

      if (fingerprint !== this.lastFingerprint) {
        this.lastFingerprint = fingerprint;
        this.render(pageOthers, elsewhere, pagePresences, lobbyPresences);
      }
    };

    const interval = setInterval(check, 1000);
    this.cleanups.push(() => clearInterval(interval));
    check();
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
    lobbyPresences: Map<string, any>,
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
        top: "16px",
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
      requestAnimationFrame(() => {
        if (this.element) this.element.style.opacity = "1";
      });
    }

    this.element.textContent = "";

    // Colored dots for users on this page (up to 5)
    let dotCount = 0;
    pagePresences.forEach((p) => {
      if (p.isMe || dotCount >= 5) return;
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
    const otherPages: { url: string; title: string }[] = [];

    presences.forEach((p) => {
      if (p.isMe) return;
      const page = (p as WikiPresenceView).page;
      if (page?.url && page.url !== location.href) {
        otherPages.push({ url: page.url, title: page.title });
      }
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
      top: "44px",
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
