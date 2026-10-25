// ABOUTME: Builds the public presence API (one presence object per person) for the page and presence rooms.
// ABOUTME: Wraps the channel-based PresenceAPI: each top-level key of a person's presence is one channel.

import type {
  PagePresence,
  PresenceAPI,
  PresenceEntry,
  PresenceScope,
  PresenceView,
  User,
} from "@playhtml/common";
import { isReservedPresenceField, safeInvoke } from "./presence-utils";

/**
 * Channel name that subscribes to every page presence channel at once (cursor
 * excluded). Understood by PresenceClient and passed through PresenceFacade.
 */
export const ALL_PRESENCE_CHANNELS = "*";

// Mirrors the server's low-frequency budget for page presence messages.
const PRESENCE_WRITE_BUDGET = 20;
const PRESENCE_WRITE_WINDOW_MS = 1_000;

/**
 * Pairs a person with their presence. `live` is the 2.15 name, kept as a
 * non-enumerable alias so old code works and logged entries stay clean.
 */
export function createPresenceEntry<V>(user: User, presence: V): PresenceEntry<V> {
  const entry = { user, presence } as PresenceEntry<V>;
  Object.defineProperty(entry, "live", {
    get() {
      return (this as PresenceEntry<V>).presence;
    },
    enumerable: false,
  });
  return entry;
}

type PresenceScopeOptions = {
  /** The channel-based presence client this scope reads and writes. */
  getSource: () => PresenceAPI;
  /** Stable person order (pids), normally `users.getAll()` order. */
  getUserOrder?: () => string[];
  /** Whether to emit development-only warnings. */
  isDevMode?: () => boolean;
};

function assertPresenceKey(key: string): void {
  if (key === "cursor") {
    throw new Error(
      `[playhtml] "cursor" is not a presence key. Read cursors with playhtml.users.cursors.`,
    );
  }
  if (key === ALL_PRESENCE_CHANNELS || isReservedPresenceField(key)) {
    throw new Error(
      `[playhtml] "${key}" is reserved by playhtml and cannot be used as a presence key.`,
    );
  }
}

function presenceFromView(view: PresenceView): PagePresence {
  const presence: PagePresence = {};
  for (const [key, value] of Object.entries(view)) {
    if (isReservedPresenceField(key)) continue;
    presence[key] = value;
  }
  return presence;
}

export function presenceFingerprint(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

export function createPresenceScope(options: PresenceScopeOptions): PresenceScope {
  const { getSource, getUserOrder, isDevMode } = options;
  const recentWrites: number[] = [];
  let warnedAboutRate = false;

  function orderedViews(): PresenceView[] {
    const views = Array.from(getSource().getPresences().values()).filter(
      (view) => view.user !== undefined,
    );
    const order = getUserOrder?.();
    if (!order) return views;
    const rank = new Map(order.map((pid, index) => [pid, index]));
    return views
      .map((view, index) => ({ view, index }))
      .sort((a, b) => {
        const rankA = rank.get(a.view.user!.pid) ?? order.length + a.index;
        const rankB = rank.get(b.view.user!.pid) ?? order.length + b.index;
        return rankA - rankB;
      })
      .map(({ view }) => view);
  }

  function everyoneSelected<S>(
    select: (presence: PagePresence) => S,
  ): PresenceEntry<S>[] {
    return orderedViews().map((view) =>
      createPresenceEntry(view.user!, select(presenceFromView(view))),
    );
  }

  function selectorFor(
    keyOrSelect?: string | ((presence: PagePresence) => unknown),
  ): (presence: PagePresence) => unknown {
    if (keyOrSelect === undefined) return (presence) => presence;
    if (typeof keyOrSelect === "string") {
      assertPresenceKey(keyOrSelect);
      return (presence) => presence[keyOrSelect];
    }
    return keyOrSelect;
  }

  function noteWrites(count: number): void {
    if (warnedAboutRate || !isDevMode?.()) return;
    const now = Date.now();
    for (let i = 0; i < count; i++) recentWrites.push(now);
    while (recentWrites.length && now - recentWrites[0] > PRESENCE_WRITE_WINDOW_MS) {
      recentWrites.shift();
    }
    if (recentWrites.length > PRESENCE_WRITE_BUDGET) {
      warnedAboutRate = true;
      console.warn(
        `[playhtml] setPresence() was called more than ${PRESENCE_WRITE_BUDGET} times per second. ` +
          `Presence is for state changes, not per-frame streams; extra writes are dropped. ` +
          `Throttle the writes, or use cursors for pointer position.`,
      );
    }
  }

  function getEveryone(): PresenceEntry<PagePresence>[];
  function getEveryone<V = unknown>(key: string): PresenceEntry<V | undefined>[];
  function getEveryone(key?: string): PresenceEntry<unknown>[] {
    return everyoneSelected(selectorFor(key));
  }

  function setPresence(partial: PagePresence): void {
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
      throw new Error(
        "[playhtml] setPresence() takes an object of keys to merge, e.g. setPresence({ status: \"typing\" }).",
      );
    }
    const entries = Object.entries(partial);
    for (const [key] of entries) assertPresenceKey(key);
    noteWrites(entries.length);
    const source = getSource();
    for (const [key, value] of entries) {
      source.setMyPresence(key, value);
    }
  }

  function onPresenceChange(
    callback: (everyone: PresenceEntry<PagePresence>[]) => void,
  ): () => void;
  function onPresenceChange<V = unknown>(
    key: string,
    callback: (everyone: PresenceEntry<V | undefined>[]) => void,
  ): () => void;
  function onPresenceChange<S>(
    select: (presence: PagePresence) => S,
    callback: (everyone: PresenceEntry<S>[]) => void,
  ): () => void;
  function onPresenceChange(
    first: string | ((arg: any) => unknown),
    second?: (everyone: PresenceEntry<any>[]) => void,
  ): () => void {
    const callback = (second ?? first) as (everyone: PresenceEntry<any>[]) => void;
    const keyOrSelect = second ? (first as string | ((p: PagePresence) => unknown)) : undefined;
    const select = selectorFor(keyOrSelect);
    // A key maps to one wire channel; a selector or the whole object watches all.
    const channel =
      typeof keyOrSelect === "string" ? keyOrSelect : ALL_PRESENCE_CHANNELS;
    let lastFingerprint: string | null = null;
    return getSource().onPresenceChange(channel, () => {
      const everyone = everyoneSelected(select);
      const next = presenceFingerprint(
        everyone.map(({ user, presence }) => [user.pid, user.name, user.color, presence]),
      );
      if (next === lastFingerprint) return;
      if (safeInvoke(() => callback(everyone), "presence subscriber")) {
        lastFingerprint = next;
      }
    });
  }

  return { getEveryone, setPresence, onPresenceChange };
}
