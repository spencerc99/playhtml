// ABOUTME: Publishes and consumes element awareness over the realtime presence transport.
// ABOUTME: Rebuilds per-element awareness maps from page-scoped presence peers.

import {
  MAX_PRESENCE_VALUE_BYTES,
  type PlayerIdentity,
} from "@playhtml/common";
import type { RealtimePresenceTransport } from "./presence-transport";
import {
  clearPresenceChannel,
  ELEMENT_CHANNEL_PREFIX,
  getPeerPublicKey,
  isElementChannel,
  isPresenceRecord,
  jsonByteLength,
  publishPresenceValue,
  startPresenceKeepalive,
} from "./presence-utils";

const ELEMENT_PRESENCE_SHARD_CHANNEL_PREFIX = `${ELEMENT_CHANNEL_PREFIX}shard:`;
const ELEMENT_PRESENCE_SHARD_VERSION = 1;

// The server caps channels per connection (identity/page/cursor use some of
// those slots), so element awareness gets a fixed shard budget. Each shard is
// MAX_PRESENCE_VALUE_BYTES (4KB), so 8 shards ~= 32KB of element awareness.
// Overflow past this is dropped with one loud error rather than exceeding the
// server's per-connection channel limit and breaking the under-budget shards.
export const MAX_ELEMENT_PRESENCE_SHARDS = 8;

// Local writes are coalesced across a microtask so N elements initializing in
// one tick produce ONE shard-set publish instead of N. After a publish, a
// trailing re-publish re-sends anything the server dropped under a burst. The
// server budget resets on a FIXED 1,000ms window, so the trailing publish must
// land BEYOND that window — a shorter delay lands in the same exhausted window
// and is dropped too.
const ELEMENT_PRESENCE_REPUBLISH_DELAY_MS = 1_100;

type ElementPresenceEntry = [tag: string, elementId: string, value: unknown];
type ElementPresenceShard = {
  v: typeof ELEMENT_PRESENCE_SHARD_VERSION;
  // Publish timestamp for the client-side staleness backstop (PeerStore reads
  // it via isLiveChannel). Additive and optional — older peers omit it and are
  // treated as fresh. Excluded from the content fingerprint (a keepalive that
  // only bumps `at` must not re-fire awareness callbacks).
  at?: number;
  entries: ElementPresenceEntry[];
};

export type ElementAwarenessEntry = {
  array: any[];
  byStableId: Map<string, any>;
};

export type ElementAwarenessMap = Map<string, ElementAwarenessEntry>;

type ElementAwarenessClientOptions = {
  transport: RealtimePresenceTransport;
  getIdentity: () => PlayerIdentity;
  getPage: () => string | undefined;
  onAwareness: (awareness: ElementAwarenessMap) => void;
};

export class ElementAwarenessClient {
  private transport: RealtimePresenceTransport;
  private getIdentity: () => PlayerIdentity;
  private getPage: () => string | undefined;
  private onAwareness: (awareness: ElementAwarenessMap) => void;
  private localTags = new Map<string, Record<string, unknown>>();
  private publishedChannels = new Set<string>();
  // Shard channels whose clear may not have reached the server yet. A dropped
  // clear is otherwise permanent: publishedChannels is updated immediately, so a
  // later publish wouldn't re-issue it. Held until a trailing republish re-sends.
  private pendingClears = new Set<string>();
  private unsubscribe: () => void;
  private stopKeepalive: () => void;
  private publishScheduled = false;
  private republishTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastAwarenessFingerprint = "";

  constructor(options: ElementAwarenessClientOptions) {
    this.transport = options.transport;
    this.getIdentity = options.getIdentity;
    this.getPage = options.getPage;
    this.onAwareness = options.onAwareness;
    // The shared per-socket PeerStore folds messages; we subscribe to just the
    // element + identity namespaces, so frame-rate cursor traffic on the same
    // socket never triggers an element awareness recompute. One shared listener
    // reference means a combined message (element + identity) recomputes once.
    // The subscribe call replays the current snapshot immediately.
    const onChange = () => this.emit();
    const unsubElement = this.transport.peers.subscribe("element", onChange);
    const unsubIdentity = this.transport.peers.subscribe("identity", onChange);
    this.unsubscribe = () => {
      unsubElement();
      unsubIdentity();
    };
    // Keepalive: re-publish (fresh `at`) on a low-frequency timer so a quiet-
    // but-connected peer's shards don't age out of peers' views. Only re-sends
    // when there IS local awareness — an empty client publishes nothing.
    this.stopKeepalive = startPresenceKeepalive(() => {
      if (this.destroyed || this.localTags.size === 0) return;
      this.publishLocalAwareness();
    });
    this.join();
  }

  setLocalAwareness(tag: string, elementId: string, value: unknown): void {
    if (this.stageLocalAwareness(tag, elementId, value)) {
      this.schedulePublish();
      this.emit();
    }
  }

  /**
   * Sets many elements' awareness at once, coalescing into a single publish and
   * a single local emit. Used to reseed retained handlers after a room change
   * without triggering one full-shard publish per element.
   */
  setLocalAwarenessBatch(
    entries: Iterable<[tag: string, elementId: string, value: unknown]>,
  ): void {
    let changed = false;
    for (const [tag, elementId, value] of entries) {
      if (this.stageLocalAwareness(tag, elementId, value)) changed = true;
    }
    if (!changed) return;
    this.schedulePublish();
    this.emit();
  }

  /** Stages a local write into localTags; returns true if it changed. */
  private stageLocalAwareness(
    tag: string,
    elementId: string,
    value: unknown,
  ): boolean {
    const tagMap = this.localTags.get(tag) ?? {};
    if (tagMap[elementId] === value) return false;
    this.localTags.set(tag, { ...tagMap, [elementId]: value });
    return true;
  }

  removeLocalAwareness(tag: string, elementId: string): void {
    const tagMap = this.localTags.get(tag);
    if (!tagMap || !(elementId in tagMap)) return;
    const next = { ...tagMap };
    delete next[elementId];
    if (Object.keys(next).length === 0) {
      this.localTags.delete(tag);
    } else {
      this.localTags.set(tag, next);
    }
    this.schedulePublish();
    this.emit();
  }

  getLocalAwareness(tag: string, elementId: string): unknown {
    return this.localTags.get(tag)?.[elementId];
  }

  refresh(): void {
    this.emit();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.republishTimer !== null) {
      clearTimeout(this.republishTimer);
      this.republishTimer = null;
    }
    this.stopKeepalive();
    this.unsubscribe();
  }

  /**
   * Coalesce publishes: multiple local writes in one tick collapse into a single
   * shard-set publish on the next microtask. Bursts (e.g. every element on a
   * heavy page initializing at once) thus cost one publish, not O(N).
   */
  private schedulePublish(): void {
    if (this.publishScheduled || this.destroyed) return;
    this.publishScheduled = true;
    queueMicrotask(() => {
      this.publishScheduled = false;
      if (this.destroyed) return;
      this.publishLocalAwareness();
      this.scheduleRepublish();
    });
  }

  /**
   * After a publish, re-send the latest snapshot once things quiet down. The
   * server drops updates past its per-connection budget under a burst and never
   * tells us which; a single trailing re-publish re-sends whatever was dropped.
   */
  private scheduleRepublish(): void {
    if (this.destroyed) return;
    if (this.republishTimer !== null) clearTimeout(this.republishTimer);
    this.republishTimer = setTimeout(() => {
      this.republishTimer = null;
      if (this.destroyed) return;
      // Re-issue any clears that may have been dropped, in a fresh rate window,
      // BEFORE republishing (publishLocalAwareness only clears channels still in
      // publishedChannels — an already-dropped clear is tracked separately).
      for (const channel of this.pendingClears) {
        clearPresenceChannel(this.transport, channel, "element awareness");
      }
      this.pendingClears.clear();
      this.publishLocalAwareness();
    }, ELEMENT_PRESENCE_REPUBLISH_DELAY_MS);
  }

  private join(): void {
    try {
      this.transport.join({
        identity: this.getIdentity(),
        page: this.getPage(),
      });
    } catch (error) {
      console.warn("[playhtml] Failed to join element awareness room:", error);
    }
  }

  private publishLocalAwareness(): void {
    const nextChannels = new Set<string>();
    const allShards = buildElementPresenceShards(this.localTags);

    // Cap the number of shards so element awareness never exceeds the server's
    // per-connection channel budget. Overflow is dropped, not throttled — the
    // under-budget shards keep syncing.
    const shards = allShards.slice(0, MAX_ELEMENT_PRESENCE_SHARDS);
    if (allShards.length > MAX_ELEMENT_PRESENCE_SHARDS) {
      const droppedTags = collectShardTags(
        allShards.slice(MAX_ELEMENT_PRESENCE_SHARDS),
      );
      console.error(
        `[playhtml] Element awareness exceeded ${MAX_ELEMENT_PRESENCE_SHARDS} shards ` +
          `(~${MAX_ELEMENT_PRESENCE_SHARDS * MAX_PRESENCE_VALUE_BYTES} bytes); ` +
          `dropping overflow so under-budget elements keep syncing. ` +
          `Affected tags: ${droppedTags.join(", ")}.`,
      );
    }

    for (let i = 0; i < shards.length; i += 1) {
      const channel = `${ELEMENT_PRESENCE_SHARD_CHANNEL_PREFIX}${i}`;
      if (
        publishPresenceValue(
          this.transport,
          channel,
          // Each shard already carries an `at` stamp (createElementPresenceShard)
          // so it ages out client-side if this peer disconnects ungracefully.
          shards[i],
          "element awareness",
        )
      ) {
        nextChannels.add(channel);
      }
      // This channel now carries live data, so it's no longer pending a clear.
      this.pendingClears.delete(channel);
    }

    for (const channel of this.publishedChannels) {
      if (!nextChannels.has(channel)) {
        // Track the clear until a trailing republish confirms it: a clear
        // dropped over the rate budget is otherwise permanent, since
        // publishedChannels drops the channel here and won't re-clear it.
        this.pendingClears.add(channel);
        clearPresenceChannel(this.transport, channel, "element awareness");
      }
    }

    this.publishedChannels = nextChannels;
  }

  private emit(): void {
    const awareness = this.buildElementAwareness();
    // Fire only when the awareness CONTENT changed. The map excludes `at`
    // (addShardEntries reads only entries), so a keepalive re-stamp — or the
    // periodic sweep touching an unrelated peer — produces an identical
    // fingerprint and does not re-fire the awareness callback.
    const fingerprint = fingerprintAwareness(awareness);
    if (fingerprint === this.lastAwarenessFingerprint) return;
    this.lastAwarenessFingerprint = fingerprint;
    this.onAwareness(awareness);
  }

  private buildElementAwareness(): ElementAwarenessMap {
    const result: ElementAwarenessMap = new Map();
    const myPublicKey = this.getIdentity().publicKey;

    for (const [tag, tagMap] of this.localTags) {
      for (const [elementId, value] of Object.entries(tagMap)) {
        addEntry(result, tag, elementId, value, myPublicKey);
      }
    }

    // Read the shared PeerStore's folded peer map; iterate only element channels
    // (cursor/presence channels on the same socket are ignored here).
    const peers = this.transport.peers.getPeers();
    for (const connectionId of Array.from(peers.keys()).sort()) {
      const channels = peers.get(connectionId)!;
      const publicKey = getPeerPublicKey(channels);
      // Our own server echo (and other tabs sharing our identity): the local
      // tag map is canonical, so skip to avoid duplicate entries.
      if (publicKey === myPublicKey) continue;
      const stableId = publicKey ?? connectionId;

      for (const [channel, value] of Object.entries(channels)) {
        if (!isElementChannel(channel)) continue;
        if (channel.startsWith(ELEMENT_PRESENCE_SHARD_CHANNEL_PREFIX)) {
          addShardEntries(result, value, stableId);
        } else if (isPresenceRecord(value)) {
          const tag = channel.slice(ELEMENT_CHANNEL_PREFIX.length);
          for (const [elementId, awarenessValue] of Object.entries(value)) {
            addEntry(result, tag, elementId, awarenessValue, stableId);
          }
        }
      }
    }

    return result;
  }
}

/** Content fingerprint of a built awareness map (per element key, per stableId,
 * by value). Excludes `at` by construction — the map never carries it — so a
 * keepalive re-stamp yields an unchanged fingerprint. */
function fingerprintAwareness(awareness: ElementAwarenessMap): string {
  const parts: string[] = [];
  for (const key of Array.from(awareness.keys()).sort()) {
    const entry = awareness.get(key)!;
    for (const stableId of Array.from(entry.byStableId.keys()).sort()) {
      let serialized: string;
      try {
        serialized = JSON.stringify(entry.byStableId.get(stableId)) ?? "null";
      } catch {
        serialized = "null";
      }
      parts.push(`${key}:${stableId}:${serialized}`);
    }
  }
  return parts.join("|");
}

function addEntry(
  result: ElementAwarenessMap,
  tag: string,
  elementId: string,
  value: unknown,
  stableId: string,
): void {
  const key = `${tag}:${elementId}`;
  let entry = result.get(key);
  if (!entry) {
    entry = { array: [], byStableId: new Map() };
    result.set(key, entry);
  }
  entry.array.push(value);
  entry.byStableId.set(stableId, value);
}

function buildElementPresenceShards(
  localTags: Map<string, Record<string, unknown>>,
): ElementPresenceShard[] {
  const shards: ElementPresenceShard[] = [];
  let entries: ElementPresenceEntry[] = [];

  for (const entry of getSortedElementPresenceEntries(localTags)) {
    const candidate = [...entries, entry];
    if (
      entries.length > 0 &&
      jsonByteLength(createElementPresenceShard(candidate)) >
        MAX_PRESENCE_VALUE_BYTES
    ) {
      shards.push(createElementPresenceShard(entries));
      entries = [entry];
    } else {
      entries = candidate;
    }
  }

  if (entries.length > 0) {
    shards.push(createElementPresenceShard(entries));
  }

  return shards;
}

function getSortedElementPresenceEntries(
  localTags: Map<string, Record<string, unknown>>,
): ElementPresenceEntry[] {
  const entries: ElementPresenceEntry[] = [];
  for (const tag of Array.from(localTags.keys()).sort()) {
    const tagMap = localTags.get(tag)!;
    for (const elementId of Object.keys(tagMap).sort()) {
      entries.push([tag, elementId, tagMap[elementId]]);
    }
  }
  return entries;
}

function createElementPresenceShard(
  entries: ElementPresenceEntry[],
): ElementPresenceShard {
  return {
    v: ELEMENT_PRESENCE_SHARD_VERSION,
    // Stamp the publish time here (not at send) so shard sizing accounts for the
    // `at` field and a near-4KB shard can't tip over the cap once stamped. The
    // exact value doesn't affect byte length (always a ~13-digit epoch ms).
    at: Date.now(),
    entries,
  };
}

/** Distinct tags present across the given shards, for a dropped-overflow log. */
function collectShardTags(shards: ElementPresenceShard[]): string[] {
  const tags = new Set<string>();
  for (const shard of shards) {
    for (const [tag] of shard.entries) tags.add(tag);
  }
  return Array.from(tags).sort();
}

function addShardEntries(
  result: ElementAwarenessMap,
  value: unknown,
  stableId: string,
): void {
  if (!isElementPresenceShard(value)) return;
  for (const entry of value.entries) {
    const [tag, elementId, awarenessValue] = entry;
    addEntry(result, tag, elementId, awarenessValue, stableId);
  }
}

function isElementPresenceShard(value: unknown): value is ElementPresenceShard {
  if (!isPresenceRecord(value)) return false;
  if (value.v !== ELEMENT_PRESENCE_SHARD_VERSION) return false;
  if (!Array.isArray(value.entries)) return false;
  return value.entries.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 3 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string",
  );
}
