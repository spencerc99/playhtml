// ABOUTME: Owns the playhtml-synced bottle channel for the current page + spawn/render coordination.
// ABOUTME: Mirrors the LinkGlowManager pattern — channel.onUpdate drives a render callback.

import type { PageDataChannel } from "@playhtml/common";
import { normalizeUrl } from "../utils/urlNormalization";
import {
  pickBottleAnchor,
  resolveBottlePosition,
  type BottleAnchor,
} from "./bottle-anchor";

export interface BottleMessageRecord {
  id: string;
  text: string;
  createdAt: number;
  createdBy: string;
  authorColor: string;
  anchor: BottleAnchor;
  hidden?: boolean;
}

export interface BottlePageData {
  messages: Record<string, BottleMessageRecord>;
  totalCount: number;
}

export interface RenderedBottle {
  id: string;
  text?: string; // undefined for empty bottles
  authorColor?: string;
  anchor: BottleAnchor;
  isEmpty: boolean;
}

export interface BottleRenderRequest {
  bottles: RenderedBottle[];
}

const STORAGE_LAST_SEEN = "bottle:lastSeen:v1";
const STORAGE_LAST_AUTHORED = "bottle:lastAuthored:v1";
const ALWAYS_VISIBLE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const AUTHOR_RATE_LIMIT_MS = 3 * 24 * 60 * 60 * 1000; // 3 days per domain
const MAX_VISIBLE_BOTTLES = 3;
const EMPTY_BOTTLE_PROBABILITY = 1.0; // TODO: set back to 0.3 for production

type RenderCallback = (req: BottleRenderRequest) => void;

interface SeenMap {
  [messageId: string]: number; // ms timestamp when first read
}

interface AuthoredMap {
  [domain: string]: number; // ms timestamp of last authored message on this domain
}

export class BottleManager {
  private data: BottlePageData = { messages: {}, totalCount: 0 };
  private channel: PageDataChannel<BottlePageData> | null = null;
  private renderCallback: RenderCallback | null = null;
  private cleanups: (() => void)[] = [];

  constructor(
    private playerColor: string,
    private playerPid: string,
    private createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>,
  ) {}

  init(onRender: RenderCallback): void {
    this.renderCallback = onRender;

    const channelName = `bottles:${normalizeUrl(location.href)}`;
    this.channel = this.createPageData<BottlePageData>(channelName, {
      messages: {},
      totalCount: 0,
    });

    this.channel.onUpdate((data: BottlePageData) => {
      this.data = data;
      this.render();
    });

    this.data = this.channel.getData();

    this.cleanups.push(() => {
      this.channel?.destroy();
    });

    // Initial render after a tick so the host page DOM has settled
    setTimeout(() => this.render(), 100);
  }

  /**
   * Author a new message. Called by the overlay when a user seals a bottle.
   * If `existingId` is provided, replace that empty bottle's anchor; otherwise
   * spawn a fresh anchor.
   */
  seal(text: string, existingAnchor?: BottleAnchor): void {
    if (!this.channel) return;
    if (!text.trim()) return;
    if (this.isRateLimited()) {
      console.log("[bottles] rate limited — skipping author");
      return;
    }

    const anchor = existingAnchor ?? pickBottleAnchor();
    if (!anchor) {
      console.log("[bottles] no anchor available — skipping author");
      return;
    }

    const id = (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    const record: BottleMessageRecord = {
      id,
      text: text.slice(0, 500),
      createdAt: Date.now(),
      createdBy: this.playerPid,
      authorColor: this.playerColor,
      anchor,
    };

    this.channel.setData((draft: BottlePageData) => {
      draft.messages[id] = record;
      draft.totalCount = (draft.totalCount ?? 0) + 1;
    });

    this.markAuthored();
    // Mark our own message seen so we don't see it again ourselves
    this.markSeen(id);
  }

  /**
   * Mark a message id as seen by this user (read-cooldown).
   */
  markSeen(messageId: string): void {
    const map = this.loadSeen();
    map[messageId] = Date.now();
    this.saveSeen(map);
    // Re-render so the seen bottle disappears from this user's view
    this.render();
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.channel = null;
    this.renderCallback = null;
  }

  // ============================
  // Internals
  // ============================

  private render(): void {
    if (!this.renderCallback) return;
    const bottles = this.computeRenderList();
    console.log(
      `[bottles] render: ${bottles.length} bottle(s)`,
      bottles.map((b) => ({
        id: b.id,
        empty: b.isEmpty,
        selector: b.anchor.selector,
      })),
    );
    this.renderCallback({ bottles });
  }

  private computeRenderList(): RenderedBottle[] {
    const seen = this.loadSeen();
    const now = Date.now();

    // Filter visible messages
    const visible: BottleMessageRecord[] = [];
    for (const id of Object.keys(this.data.messages)) {
      const m = this.data.messages[id];
      if (m.hidden) continue;
      const isFresh = now - m.createdAt < ALWAYS_VISIBLE_WINDOW_MS;
      const userHasRead = seen[id] !== undefined;
      // Per Spencer: never re-show what you've read. Fresh window does NOT
      // override personal read state — once you've read it, it's gone.
      if (userHasRead) continue;
      visible.push(m);
      if (visible.length >= MAX_VISIBLE_BOTTLES * 3) break;
    }

    // Sort by recency, prefer fresh
    visible.sort((a, b) => b.createdAt - a.createdAt);
    const top = visible.slice(0, MAX_VISIBLE_BOTTLES);

    if (top.length > 0) {
      // Render real bottles. Resolve anchors at render-time (skip if anchor broken)
      const out: RenderedBottle[] = [];
      for (const m of top) {
        if (resolveBottlePosition(m.anchor) === null) continue;
        out.push({
          id: m.id,
          text: m.text,
          authorColor: m.authorColor,
          anchor: m.anchor,
          isEmpty: false,
        });
      }
      return out;
    }

    // No filled bottles for this user — maybe an empty
    if (this.shouldShowEmpty()) {
      const anchor = pickBottleAnchor();
      if (!anchor) {
        console.log("[bottles] no anchor candidates on this page");
        return [];
      }
      const pos = resolveBottlePosition(anchor);
      if (pos === null) {
        console.log("[bottles] anchor resolved offscreen or overlapping", anchor);
        return [];
      }
      return [
        {
          id: `empty-${Date.now()}`,
          anchor,
          isEmpty: true,
        },
      ];
    } else {
      console.log(
        "[bottles] skipping empty bottle this load (rate-limited or rolled below threshold)",
      );
    }

    return [];
  }

  private shouldShowEmpty(): boolean {
    if (this.isRateLimited()) return false; // can't author anyway, don't tease
    return Math.random() < EMPTY_BOTTLE_PROBABILITY;
  }

  private isRateLimited(): boolean {
    const map = this.loadAuthored();
    const domain = location.hostname;
    const last = map[domain];
    if (!last) return false;
    return Date.now() - last < AUTHOR_RATE_LIMIT_MS;
  }

  private markAuthored(): void {
    const map = this.loadAuthored();
    map[location.hostname] = Date.now();
    try {
      localStorage.setItem(STORAGE_LAST_AUTHORED, JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  private loadSeen(): SeenMap {
    try {
      const raw = localStorage.getItem(STORAGE_LAST_SEEN);
      if (raw) return JSON.parse(raw) as SeenMap;
    } catch {
      // fall through
    }
    return {};
  }

  private saveSeen(map: SeenMap): void {
    try {
      localStorage.setItem(STORAGE_LAST_SEEN, JSON.stringify(map));
    } catch {
      // ignore
    }
  }

  private loadAuthored(): AuthoredMap {
    try {
      const raw = localStorage.getItem(STORAGE_LAST_AUTHORED);
      if (raw) return JSON.parse(raw) as AuthoredMap;
    } catch {
      // fall through
    }
    return {};
  }
}
