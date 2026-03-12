// ABOUTME: Manages shared link-click glow state for anchor elements on a page.
// ABOUTME: Tracks click counts and recent player colors per destination link.

export interface LinkClickEntry {
  count: number;
  recentColors: string[];
}

export interface PageLinkData {
  links: Record<string, LinkClickEntry>;
}

export const MAX_RECENT_COLORS = 8;

export class LinkGlowManager {
  private data: PageLinkData = { links: {} };
  private observer: IntersectionObserver | null = null;
  private visibleLinks = new Set<HTMLAnchorElement>();
  private cleanups: (() => void)[] = [];
  private handler: any = null;
  private glowElements = new Map<HTMLAnchorElement, HTMLElement[]>();

  constructor(private playerColor: string) {}

  async init(): Promise<void> {
    const anchor = document.createElement("div");
    anchor.id = `playhtml-link-glow-${encodeURIComponent(location.pathname)}`;
    anchor.setAttribute("can-play", "");
    anchor.style.display = "none";
    document.body.appendChild(anchor);

    const el = anchor as any;
    el.defaultData = { links: {} } as PageLinkData;
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
    });
  }

  private scanLinks(): void {
    const content = document.querySelector("#mw-content-text");
    if (!content) return;

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

  private removeGlow(_link: HTMLAnchorElement): void {}

  private renderGlows(): void {}

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
    this.glowElements.clear();
    this.handler = null;
  }
}
