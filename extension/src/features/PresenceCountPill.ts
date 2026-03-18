// ABOUTME: Ambient indicator showing how many people are on the current page.
// ABOUTME: Renders colored dots and a count pill in the top-right corner.

import type { PresenceAPI } from "@playhtml/common";

export class PresenceCountPill {
  private element: HTMLElement | null = null;
  private cleanups: (() => void)[] = [];
  private lastCount = 0;

  constructor(private presence: PresenceAPI) {}

  init(): void {
    const check = () => {
      const presences = this.presence.getPresences();
      let otherCount = 0;
      presences.forEach((p) => {
        if (!p.isMe) otherCount++;
      });

      if (otherCount !== this.lastCount) {
        this.lastCount = otherCount;
        this.render(otherCount, presences);
      }
    };

    const interval = setInterval(check, 1000);
    this.cleanups.push(() => clearInterval(interval));
    check();
  }

  destroy(): void {
    this.element?.remove();
    this.element = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  private render(otherCount: number, presences: Map<string, any>): void {
    if (otherCount === 0) {
      this.element?.remove();
      this.element = null;
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
        pointerEvents: "none",
      });
      document.body.appendChild(this.element);
      requestAnimationFrame(() => {
        if (this.element) this.element.style.opacity = "1";
      });
    }

    this.element.textContent = "";

    // Show up to 5 colored dots for other users
    let dotCount = 0;
    presences.forEach((p) => {
      if (p.isMe || dotCount >= 5) return;
      const color = p.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#8a8279";
      const dot = document.createElement("span");
      Object.assign(dot.style, {
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: color,
      });
      this.element!.appendChild(dot);
      dotCount++;
    });

    const label = document.createElement("span");
    label.textContent = `${otherCount + 1} here`;
    this.element.appendChild(label);
  }
}
