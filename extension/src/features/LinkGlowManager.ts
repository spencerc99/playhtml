// ABOUTME: Manages shared link-click glow state for anchor elements on a page.
// ABOUTME: Tracks click counts and recent player colors per destination link.

import { computeGlowStyle } from "./link-glow-renderer";
import type { PageDataChannel } from "@playhtml/common";

export interface LinkClickEntry {
  count: number;
  recentColors: string[];
}

export interface PageLinkData {
  links: Record<string, LinkClickEntry>;
  totalClicks: number;
}

export const MAX_RECENT_COLORS = 8;
const DECAY_EVERY = 100;
const DECAY_AMOUNT = 5;

let nextGlowId = 0;

export class LinkGlowManager {
  private data: PageLinkData = { links: {}, totalClicks: 0 };
  private observer: IntersectionObserver | null = null;
  private visibleLinks = new Set<HTMLAnchorElement>();
  private cleanups: (() => void)[] = [];
  private channel: PageDataChannel<PageLinkData> | null = null;
  private originalStyles = new Map<HTMLAnchorElement, Record<string, string>>();
  private linkClasses = new Map<HTMLAnchorElement, string>();
  private styleEl: HTMLStyleElement | null = null;

  constructor(
    private playerColor: string,
    private createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>,
  ) {}

  init(): void {
    this.styleEl = document.createElement("style");
    this.styleEl.id = "playhtml-link-glow-styles";
    document.head.appendChild(this.styleEl);

    this.channel = this.createPageData<PageLinkData>(
      `link-glows:${location.pathname}`,
      { links: {}, totalClicks: 0 },
    );

    this.channel.onUpdate((data) => {
      this.data = data;
      this.renderGlows();
    });

    this.data = this.channel.getData();

    this.cleanups.push(() => {
      this.channel?.destroy();
      this.styleEl?.remove();
    });

    this.scanLinks();
  }

  recordClick(destPath: string): void {
    if (!this.channel) return;
    this.channel.setData((draft: PageLinkData) => {
      if (!draft.links[destPath]) {
        draft.links[destPath] = { count: 0, recentColors: [] };
      }
      draft.links[destPath].count += 1;
      const colors = draft.links[destPath].recentColors;
      if (!colors.includes(this.playerColor)) {
        colors.push(this.playerColor);
        if (colors.length > MAX_RECENT_COLORS) colors.shift();
      }

      draft.totalClicks = (draft.totalClicks ?? 0) + 1;
      if (draft.totalClicks >= DECAY_EVERY) {
        draft.totalClicks = 0;
        for (const path of Object.keys(draft.links)) {
          draft.links[path].count = Math.max(0, draft.links[path].count - DECAY_AMOUNT);
          if (draft.links[path].count === 0) {
            delete draft.links[path];
          }
        }
      }
    });
  }

  private scanLinks(): void {
    const content = document.querySelector("#mw-content-text .mw-parser-output");
    if (!content) {
      return;
    }

    const wikiLinks = content.querySelectorAll<HTMLAnchorElement>(
      'a[href^="/wiki/"]:not([href*=":"])'
    );
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const link = entry.target as HTMLAnchorElement;
          if (entry.isIntersecting) {
            this.visibleLinks.add(link);
          } else {
            this.visibleLinks.delete(link);
            this.removeGlow(link);
          }
        }
        this.renderGlows();
      },
      { rootMargin: "100px 0px" }
    );

    for (const link of wikiLinks) {
      const destPath = new URL(link.href).pathname;
      const onClick = () => this.recordClick(destPath);
      link.addEventListener("click", onClick);
      this.cleanups.push(() => link.removeEventListener("click", onClick));
      this.observer.observe(link);
    }
  }

  private getOrCreateClass(link: HTMLAnchorElement): string {
    let cls = this.linkClasses.get(link);
    if (!cls) {
      cls = `plh-glow-${nextGlowId++}`;
      this.linkClasses.set(link, cls);
    }
    return cls;
  }

  private removeGlow(link: HTMLAnchorElement): void {
    const saved = this.originalStyles.get(link);
    if (!saved) return;
    for (const [prop, val] of Object.entries(saved)) {
      link.style.setProperty(prop, val);
    }
    const cls = this.linkClasses.get(link);
    if (cls) link.classList.remove(cls);
    this.originalStyles.delete(link);
  }

  private applyGlow(
    link: HTMLAnchorElement,
    style: NonNullable<ReturnType<typeof computeGlowStyle>>,
    wraps: boolean,
  ): void {
    // Save original styles before first modification
    if (!this.originalStyles.has(link)) {
      this.originalStyles.set(link, {
        background: link.style.background,
        "box-decoration-break": link.style.getPropertyValue("box-decoration-break"),
        "-webkit-box-decoration-break": link.style.getPropertyValue("-webkit-box-decoration-break"),
        filter: link.style.filter,
        padding: link.style.padding,
        margin: link.style.margin,
        "border-radius": link.style.borderRadius,
      });
    }

    const hPad = Math.round(1 + style.vSpread * 0.7);

    if (wraps) {
      // Multi-line: inline backgrounds + drop-shadow fallback
      const dropShadows = [
        `drop-shadow(0 0 ${style.blur.toFixed(1)}px ${style.baseFill})`,
        `drop-shadow(0 0 ${(style.blur * 0.5).toFixed(1)}px ${style.baseFill})`,
      ];
      Object.assign(link.style, {
        background: style.bgLayers.length > 0 ? style.bgLayers.join(", ") : undefined,
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
        filter: dropShadows.join(" "),
        padding: `0.5px ${hPad}px`,
        margin: `-0.5px ${-hPad}px`,
        borderRadius: "2px",
      });
    } else {
      // Single-line: pseudo-elements with blur via injected stylesheet
      const cls = this.getOrCreateClass(link);
      link.classList.add(cls);
      Object.assign(link.style, {
        position: "relative",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      });
    }
  }

  private renderGlows(): void {
    let pageMax = 0;
    for (const entry of Object.values(this.data.links)) {
      if (entry.count > pageMax) pageMax = entry.count;
    }

    // Collect pseudo-element CSS rules for single-line links
    const cssRules: string[] = [];

    for (const link of this.visibleLinks) {
      const destPath = new URL(link.href).pathname;
      const entry = this.data.links[destPath];

      if (!entry || entry.count === 0) {
        this.removeGlow(link);
        continue;
      }

      const style = computeGlowStyle(entry.recentColors, entry.count, pageMax);
      if (!style) {
        this.removeGlow(link);
        continue;
      }

      const wraps = link.getClientRects().length > 1;
      this.applyGlow(link, style, wraps);

      if (!wraps) {
        const cls = this.linkClasses.get(link)!;
        const hInset = style.hInsetPct;
        const vSpread = style.vSpread;
        cssRules.push(`
          .${cls}::before {
            content: "";
            position: absolute;
            left: ${hInset}%;
            right: ${hInset}%;
            top: ${-vSpread}px;
            bottom: ${-vSpread}px;
            background: ${style.baseFill};
            filter: blur(${style.blur.toFixed(1)}px);
            border-radius: 2px;
            pointer-events: none;
            z-index: 0;
          }
        `);
        if (style.blobLayers.length > 0) {
          cssRules.push(`
            .${cls}::after {
              content: "";
              position: absolute;
              left: ${hInset}%;
              right: ${hInset}%;
              top: ${-vSpread}px;
              bottom: ${-vSpread}px;
              background: ${style.blobLayers.join(", ")};
              filter: blur(${(style.blur * 0.7).toFixed(1)}px);
              border-radius: 2px;
              pointer-events: none;
              z-index: 0;
            }
          `);
        }
      }
    }

    // Update the injected stylesheet
    if (this.styleEl) {
      this.styleEl.textContent = cssRules.join("\n");
    }
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];

    this.visibleLinks.clear();
    this.originalStyles.clear();
    this.linkClasses.clear();
    this.channel = null;
  }
}
