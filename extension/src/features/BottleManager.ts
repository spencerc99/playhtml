// ABOUTME: Owns the playhtml-synced bottle channel for the current page + spawn/render coordination.
// ABOUTME: Mirrors the LinkGlowManager pattern — channel.onUpdate drives a render callback.

import type { PageDataChannel } from "@playhtml/common";
import { bottleDebug as debug } from "./bottle-debug";
import {
  pickBottleAnchor,
  resolveBottlePosition,
  type BottleAnchor,
} from "./bottle-anchor";
import { normalizeUrl } from "../utils/urlNormalization";
import { pouchCount, spendLetter } from "./letter-pouch";
import { currentFaviconUrl } from "../components/bottle/salutation";

/** A single note in a bottle's thread. Replies append, never replace. */
export interface BottleNote {
  text: string;
  createdAt: number;
  createdBy: string;
  authorColor: string;
  /** Signed display name — the one place the author's name appears. */
  authorName?: string;
  /** Segment style preset id (see components/bottle/segmentStyles.ts). */
  styleId?: string;
  /** Page this note was written on. Same for all notes while bottles are
   * stationary; carried from the start so travel needs no migration. */
  pageUrl?: string;
  /** Title of the page this note was written on, captured at write time —
   * renders the salutation ("dear <title>,") and future chapter dividers. */
  pageTitle?: string;
  /** Favicon of the page at write time, for the salutation mark. Carried
   * from the start (like pageUrl) so travel needs no migration. */
  faviconUrl?: string;
}

/** A bottle anchored to a spot on the page, holding a thread of notes. */
export interface BottleRecord {
  id: string;
  anchor: BottleAnchor;
  /** Normalized URL of the page this bottle was placed on. Render is
   * page-filtered against this; storage is domain-scoped. */
  pageUrl?: string;
  notes: BottleNote[];
  hidden?: boolean;
}

export interface BottlePageData {
  bottles: Record<string, BottleRecord>;
}

export interface RenderedBottle {
  id: string;
  notes?: BottleNote[]; // undefined for empty bottles
  authorColor?: string; // the latest note's author color (left-edge stripe)
  anchor: BottleAnchor;
  isEmpty: boolean;
  canReply: boolean;
}

export interface BottleRenderRequest {
  bottles: RenderedBottle[];
}

const STORAGE_LAST_SEEN = "bottle:lastSeen:v1";
const ALWAYS_VISIBLE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_VISIBLE_BOTTLES = 3;
const EMPTY_BOTTLE_PROBABILITY = 0.3;

/** Optional metadata attached to a sealed note beyond its text. */
export interface SealMeta {
  authorName?: string;
  styleId?: string;
}

type RenderCallback = (req: BottleRenderRequest) => void;

interface SeenMap {
  [messageId: string]: number; // ms timestamp when first read
}

export class BottleManager {
  private data: BottlePageData = { bottles: {} };
  private channel: PageDataChannel<BottlePageData> | null = null;
  private renderCallback: RenderCallback | null = null;
  private cleanups: (() => void)[] = [];

  // Whether to show an empty bottle at all. The probability roll is made once
  // per page load and kept sticky: re-rolling each render (fires on channel
  // updates and markSeen) would flicker the bottle in and out and change its
  // React key mid-interaction, unmounting an open dialog (destroying the draft).
  // undefined = not yet rolled.
  private showEmpty: boolean | undefined = undefined;

  // The placed empty bottle (id + anchor), cached once it successfully resolves
  // so its id stays stable across renders. Stays null while showEmpty is true
  // but no anchor resolves yet — so a transient early no-anchor doesn't suppress
  // the bottle for the rest of the page's life; it retries on later renders.
  private emptyBottle: RenderedBottle | null = null;

  constructor(
    private playerColor: string,
    private playerPid: string,
    private createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>,
  ) {}

  init(onRender: RenderCallback): void {
    this.renderCallback = onRender;

    // The room is already extension-owned and per-page (set when the WWO
    // playhtml instance inits), so the channel key only needs to name the
    // feature within that room — no `wwo:` prefix, no URL. `bottles` stays
    // distinct from sibling keys (e.g. link-glows) on the custom-cursor-site
    // pages where bottles share the site's room.
    this.channel = this.createPageData<BottlePageData>("bottles", {
      bottles: {},
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
   * Seal a note into a bottle. Called by the overlay when a user finishes
   * writing. If `target` names an existing bottle, the note is appended to that
   * bottle's thread (a reply, same anchor); otherwise a new bottle is created
   * at the target anchor (e.g. sealing into an empty prompt or a fresh spot).
   */
  /** Returns true if the note was persisted, false if dropped (no channel,
   * empty text, or pouch empty) so the caller can avoid marking the bottle
   * seen and losing the user's reply. */
  seal(
    text: string,
    target: { id: string; anchor: BottleAnchor },
    meta?: SealMeta,
  ): boolean {
    if (!this.channel) return false;
    if (!text.trim()) return false;
    if (pouchCount() < 1) {
      debug("[bottles] pouch empty — skipping author");
      return false;
    }

    const existing = this.data.bottles[target.id];
    // You can't leave the last word twice: replying to a bottle whose latest
    // note is your own is rejected until someone else passes through.
    if (
      existing &&
      existing.notes.length > 0 &&
      existing.notes[existing.notes.length - 1].createdBy === this.playerPid
    ) {
      debug("[bottles] latest note is ours — self-reply blocked");
      return false;
    }

    const note: BottleNote = {
      text: text.slice(0, 500),
      createdAt: Date.now(),
      createdBy: this.playerPid,
      authorColor: this.playerColor,
      pageUrl: window.location.href,
      ...(document.title ? { pageTitle: document.title } : {}),
      ...(currentFaviconUrl() ? { faviconUrl: currentFaviconUrl()! } : {}),
      ...(meta?.authorName ? { authorName: meta.authorName } : {}),
      ...(meta?.styleId ? { styleId: meta.styleId } : {}),
    };

    const bottleId = existing
      ? target.id
      : (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    this.channel.setData((draft: BottlePageData) => {
      const bottle = draft.bottles[bottleId];
      if (bottle) {
        // Reply: append to the thread. push() is the CRDT-safe array op.
        bottle.notes.push(note);
      } else {
        draft.bottles[bottleId] = {
          id: bottleId,
          anchor: target.anchor,
          pageUrl: normalizeUrl(window.location.href),
          notes: [note],
        };
      }
    });

    // The empty bottle (if any) is now filled by our own message; suppress it
    // so it isn't re-rendered as empty.
    this.showEmpty = false;
    this.emptyBottle = null;

    spendLetter();
    // Mark our own bottle seen so we don't see it again ourselves
    this.markSeen(bottleId);
    return true;
  }

  /**
   * Mark a bottle id as seen by this user (read-cooldown).
   */
  markSeen(bottleId: string): void {
    const map = this.loadSeen();
    map[bottleId] = Date.now();
    this.saveSeen(map);
    // Re-render so the seen bottle disappears from this user's view
    this.render();
  }

  /**
   * The overlay found this bottle's anchor element genuinely gone from the
   * DOM (not merely scrolled off-screen — see resolveBottlePosition). If
   * it's the cached empty bottle, drop the cache and re-render so it
   * re-places at a fresh anchor instead of vanishing for good.
   */
  notifyAnchorLost(bottleId: string): void {
    if (this.emptyBottle && this.emptyBottle.id === bottleId) {
      this.emptyBottle = null;
      this.render();
    }
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
    debug(
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
    const here = normalizeUrl(window.location.href);

    // Filter visible bottles.
    const visible: BottleRecord[] = [];
    for (const id of Object.keys(this.data.bottles)) {
      const b = this.data.bottles[id];
      if (b.hidden || b.notes.length === 0) continue;
      if (this.recordPageUrl(b) !== here) continue; // domain book, page view
      const userHasRead = seen[id] !== undefined;
      // Per Spencer: never re-show what you've read. Fresh window does NOT
      // override personal read state — once you've read it, it's gone.
      if (userHasRead) continue;
      visible.push(b);
      if (visible.length >= MAX_VISIBLE_BOTTLES * 3) break;
    }

    // Sort by recency of the latest note, prefer fresh
    visible.sort((a, b) => latestNoteAt(b) - latestNoteAt(a));

    // Resolve anchors BEFORE capping, so newest bottles whose anchor element
    // was actually removed from the DOM don't consume the visible slots and
    // hide older renderable ones. A bottle merely scrolled off-screen still
    // resolves here — it keeps its slot and stays anchored to its page spot.
    const out: RenderedBottle[] = [];
    for (const b of visible) {
      if (resolveBottlePosition(b.anchor) === null) continue;
      const latest = b.notes[b.notes.length - 1];
      out.push({
        id: b.id,
        notes: b.notes,
        authorColor: latest.authorColor,
        anchor: b.anchor,
        isEmpty: false,
        canReply: latest.createdBy !== this.playerPid,
      });
      if (out.length >= MAX_VISIBLE_BOTTLES) break;
    }

    if (out.length > 0) return out;

    // No filled bottles for this user — maybe an empty one. Decided once per
    // page load and cached so re-renders don't re-roll / re-anchor / re-id it.
    const empty = this.resolveEmptyBottle();
    return empty ? [empty] : [];
  }

  /** The page a bottle record lives on. Falls back to its first note, then to
   * the current page (safe: stationary bottles never moved). */
  private recordPageUrl(b: BottleRecord): string {
    const raw = b.pageUrl ?? b.notes[0]?.pageUrl ?? window.location.href;
    return normalizeUrl(raw);
  }

  /** Whether any filled bottle in the domain book lives on the current page. */
  private anyBottleOnThisPage(): boolean {
    const here = normalizeUrl(window.location.href);
    return Object.values(this.data.bottles).some(
      (b) => !b.hidden && b.notes.length > 0 && this.recordPageUrl(b) === here,
    );
  }

  /**
   * Whether to show an empty bottle and, if so, where. The probability roll is
   * sticky (cached in showEmpty); the placement retries each render until an
   * anchor resolves, then caches the placed bottle so its id stays stable.
   */
  private resolveEmptyBottle(): RenderedBottle | null {
    if (this.emptyBottle) {
      // Re-validate the cached anchor: if its element was actually removed
      // from the DOM, drop the cache so we re-place below rather than
      // returning a bottle the overlay will silently hide forever. showEmpty
      // stays true, so the probability roll isn't repeated — only placement.
      if (resolveBottlePosition(this.emptyBottle.anchor) !== null) {
        return this.emptyBottle;
      }
      this.emptyBottle = null;
    }

    if (this.showEmpty === undefined) {
      this.showEmpty = this.shouldShowEmpty();
      if (!this.showEmpty) {
        debug(
          "[bottles] skipping empty bottle this load (pouch empty or rolled below threshold)",
        );
      }
    }
    if (!this.showEmpty) return null;

    const anchor = pickBottleAnchor();
    if (!anchor) {
      debug("[bottles] no anchor candidates yet — will retry next render");
      return null;
    }
    if (resolveBottlePosition(anchor) === null) {
      debug("[bottles] freshly-picked anchor already gone — will retry next render");
      return null;
    }
    const id = (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    this.emptyBottle = { id: `empty-${id}`, anchor, isEmpty: true, canReply: true };
    return this.emptyBottle;
  }

  private shouldShowEmpty(): boolean {
    if (pouchCount() < 1) return false; // can't author anyway, don't tease
    // Frontier: nobody has written on this page — always invite the first letter.
    if (!this.anyBottleOnThisPage()) return true;
    return Math.random() < EMPTY_BOTTLE_PROBABILITY;
  }

  private loadSeen(): SeenMap {
    return parseTimestampMap(localStorage.getItem(STORAGE_LAST_SEEN));
  }

  private saveSeen(map: SeenMap): void {
    try {
      localStorage.setItem(STORAGE_LAST_SEEN, JSON.stringify(map));
    } catch {
      // ignore
    }
  }
}

/** Timestamp of a bottle's most recent note (0 if somehow empty). */
function latestNoteAt(b: BottleRecord): number {
  return b.notes.length ? b.notes[b.notes.length - 1].createdAt : 0;
}

/**
 * Parse a stored `{ key: timestamp }` map, tolerating any malformed payload.
 * A bare `null`, an array, or non-number values would otherwise be trusted as
 * a map and crash later lookups (`seen[id]` on `null` throws), so anything that
 * isn't a plain object of numbers degrades to an empty map.
 */
function parseTimestampMap(raw: string | null): Record<string, number> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
