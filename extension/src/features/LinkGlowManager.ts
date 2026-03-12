// ABOUTME: Manages shared link-click glow state for anchor elements on a page.
// ABOUTME: Tracks click counts and recent player colors per destination link.

import { computeGlowStyle, type GlowStyle } from "./link-glow-renderer";

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

export class LinkGlowManager {
  private data: PageLinkData = { links: {}, totalClicks: 0 };
  private observer: IntersectionObserver | null = null;
  private visibleLinks = new Set<HTMLAnchorElement>();
  private cleanups: (() => void)[] = [];
  private handler: any = null;
  private originalStyles = new Map<HTMLAnchorElement, Record<string, string>>();

  constructor(private playerColor: string) {}

  async init(): Promise<void> {
    const anchor = document.createElement("div");
    anchor.id = `playhtml-link-glow-${encodeURIComponent(location.pathname)}`;
    anchor.setAttribute("can-play", "");
    anchor.style.display = "none";
    document.body.appendChild(anchor);

    const el = anchor as any;
    el.defaultData = { links: {}, totalClicks: 0 } as PageLinkData;
    el.updateElement = ({ data }: { data: PageLinkData }) => {
      this.data = data;
      this.renderGlows();
    };
    el.updateElementAwareness = el.updateElement;

    const { playhtml } = await import("playhtml");
    await playhtml.setupPlayElementForTag(anchor, "can-play");

    this.handler =
      playhtml.elementHandlers?.get("can-play")?.get(anchor.id) ?? null;

    this.cleanups.push(() => {
      playhtml.removePlayElement(anchor);
      anchor.remove();
    });

    this.scanLinks();
  }

  recordClick(destPath: string): void {
    if (!this.handler) return;
    this.handler.setData((draft: PageLinkData) => {
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

  private removeGlow(link: HTMLAnchorElement): void {
    const saved = this.originalStyles.get(link);
    if (!saved) return;
    for (const [prop, val] of Object.entries(saved)) {
      link.style.setProperty(prop, val);
    }
    this.originalStyles.delete(link);
  }

  private applyGlow(link: HTMLAnchorElement, style: GlowStyle): void {
    // Save original styles before first modification
    if (!this.originalStyles.has(link)) {
      this.originalStyles.set(link, {
        background: link.style.background,
        "box-decoration-break": link.style.getPropertyValue("box-decoration-break"),
        "-webkit-box-decoration-break": link.style.getPropertyValue("-webkit-box-decoration-break"),
        "text-shadow": link.style.textShadow,
        padding: link.style.padding,
        margin: link.style.margin,
        "border-radius": link.style.borderRadius,
      });
    }

    const allBgs = [style.baseFill, ...style.blobLayers].filter(Boolean);
    const vPad = Math.round(1 + style.vSpread);
    const hPad = Math.round(1 + style.vSpread * 0.7);

    // Build text-shadow for the soft halo effect
    const blur = parseFloat(style.baseFilter.match(/blur\(([\d.]+)px\)/)?.[1] ?? "3");
    const shadows = [
      `0 0 ${(blur * 1.5).toFixed(1)}px ${style.baseFill}`,
      `0 0 ${(blur * 2.5).toFixed(1)}px ${style.baseFill}`,
    ];

    Object.assign(link.style, {
      background: allBgs.join(", "),
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
      textShadow: shadows.join(", "),
      padding: `${vPad}px ${hPad}px`,
      margin: `${-vPad}px ${-hPad}px`,
      borderRadius: "2px",
    });
  }

  private renderGlows(): void {
    let pageMax = 0;
    for (const entry of Object.values(this.data.links)) {
      if (entry.count > pageMax) pageMax = entry.count;
    }

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

      this.applyGlow(link, style);
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
    this.handler = null;
  }
}
