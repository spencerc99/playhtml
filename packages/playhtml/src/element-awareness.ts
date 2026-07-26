// ABOUTME: Publishes and consumes element awareness over the realtime presence transport.
// ABOUTME: Rebuilds per-element awareness maps from page-scoped presence peers.

import {
  MAX_PRESENCE_VALUE_BYTES,
  type PlayerIdentity,
} from "@playhtml/common";
import type { RealtimePresenceTransport } from "./presence-transport";
import { isPresenceRecord } from "./presence-utils";

export const ELEMENT_PRESENCE_CHANNEL_PREFIX = "element:";
const ELEMENT_PRESENCE_SHARD_CHANNEL_PREFIX = `${ELEMENT_PRESENCE_CHANNEL_PREFIX}shard:`;
const ELEMENT_PRESENCE_SHARD_VERSION = 1;

// The server caps channels per connection (identity/page/cursor use some of
// those slots), so element awareness gets a fixed shard budget. Each shard is
// MAX_PRESENCE_VALUE_BYTES (4KB), so 8 shards ~= 32KB of element awareness.
// Overflow past this is dropped with one loud error rather than exceeding the
// server's per-connection channel limit and breaking the under-budget shards.
export const MAX_ELEMENT_PRESENCE_SHARDS = 8;

// Local writes are coalesced across a microtask so N elements initializing in
// one tick produce ONE shard-set publish instead of N. After a publish, a
// trailing re-publish is scheduled so anything the server dropped under a burst
// (it rejects updates past its per-second budget) is re-sent once things quiet.
const ELEMENT_PRESENCE_REPUBLISH_DELAY_MS = 400;

type ElementPresenceEntry = [tag: string, elementId: string, value: unknown];
type ElementPresenceShard = {
  v: typeof ELEMENT_PRESENCE_SHARD_VERSION;
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
  private unsubscribe: () => void;
  private publishScheduled = false;
  private republishTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

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
      if (this.publishChannel(channel, shards[i])) {
        nextChannels.add(channel);
      }
    }

    for (const channel of this.publishedChannels) {
      if (!nextChannels.has(channel)) this.clearChannel(channel);
    }

    this.publishedChannels = nextChannels;
  }

  private publishChannel(channel: string, value: unknown): boolean {
    if (jsonByteLength(value) > MAX_PRESENCE_VALUE_BYTES) {
      console.warn(
        "[playhtml] Failed to publish element awareness:",
        new Error(
          `Presence value must be ${MAX_PRESENCE_VALUE_BYTES} bytes or less`,
        ),
      );
      return false;
    }

    try {
      this.transport.update(channel, value);
      return true;
    } catch (error) {
      console.warn("[playhtml] Failed to publish element awareness:", error);
      return false;
    }
  }

  private clearChannel(channel: string): void {
    try {
      this.transport.clear(channel);
    } catch (error) {
      console.warn("[playhtml] Failed to clear element awareness:", error);
    }
  }

  private emit(): void {
    this.onAwareness(this.buildElementAwareness());
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
      const identity = channels.identity;
      const publicKey =
        isPresenceRecord(identity) && typeof identity.publicKey === "string"
          ? identity.publicKey
          : undefined;
      // Our own server echo (and other tabs sharing our identity): the local
      // tag map is canonical, so skip to avoid duplicate entries.
      if (publicKey === myPublicKey) continue;
      const stableId = publicKey ?? connectionId;

      for (const [channel, value] of Object.entries(channels)) {
        if (!channel.startsWith(ELEMENT_PRESENCE_CHANNEL_PREFIX)) continue;
        if (channel.startsWith(ELEMENT_PRESENCE_SHARD_CHANNEL_PREFIX)) {
          addShardEntries(result, value, stableId);
        } else if (isPresenceRecord(value)) {
          const tag = channel.slice(ELEMENT_PRESENCE_CHANNEL_PREFIX.length);
          for (const [elementId, awarenessValue] of Object.entries(value)) {
            addEntry(result, tag, elementId, awarenessValue, stableId);
          }
        }
      }
    }

    return result;
  }
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

function jsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return Infinity;
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return Infinity;
  }
}
