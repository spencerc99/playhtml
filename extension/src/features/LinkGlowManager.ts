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
    // Will be filled in subsequent tasks
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
    this.glowElements.clear();
    this.handler = null;
  }
}
