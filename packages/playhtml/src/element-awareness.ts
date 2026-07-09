// ABOUTME: Publishes and consumes element awareness over the realtime presence transport.
// ABOUTME: Rebuilds per-element awareness maps from page-scoped presence peers.

import {
  MAX_PRESENCE_VALUE_BYTES,
  type PlayerIdentity,
  type PresenceChangesMessage,
  type PresenceServerMessage,
  type PresenceSnapshot,
} from "@playhtml/common";
import type { RealtimePresenceTransport } from "./presence-transport";
import { isPresenceRecord } from "./presence-utils";

export const ELEMENT_PRESENCE_CHANNEL_PREFIX = "element:";
const ELEMENT_PRESENCE_SHARD_CHANNEL_PREFIX = `${ELEMENT_PRESENCE_CHANNEL_PREFIX}shard:`;
const ELEMENT_PRESENCE_SHARD_VERSION = 1;

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

export type ElementAwarenessClientOptions = {
  transport: RealtimePresenceTransport;
  getIdentity: () => PlayerIdentity;
  getPage: () => string | undefined;
  onAwareness: (awareness: ElementAwarenessMap) => void;
};

/** Channels this client mirrors from peers; everything else (cursor traffic on
 * a shared socket) is ignored without recomputing. */
function isElementRelevantChannel(channel: string): boolean {
  return (
    channel === "identity" || channel.startsWith(ELEMENT_PRESENCE_CHANNEL_PREFIX)
  );
}

export class ElementAwarenessClient {
  private transport: RealtimePresenceTransport;
  private getIdentity: () => PlayerIdentity;
  private getPage: () => string | undefined;
  private onAwareness: (awareness: ElementAwarenessMap) => void;
  private localTags = new Map<string, Record<string, unknown>>();
  private publishedChannels = new Set<string>();
  private peers = new Map<string, Record<string, unknown>>();
  private unsubscribe: () => void;

  constructor(options: ElementAwarenessClientOptions) {
    this.transport = options.transport;
    this.getIdentity = options.getIdentity;
    this.getPage = options.getPage;
    this.onAwareness = options.onAwareness;
    this.unsubscribe = this.transport.subscribe((message) =>
      this.handleMessage(message),
    );
    this.join();
  }

  setLocalAwareness(tag: string, elementId: string, value: unknown): void {
    const tagMap = this.localTags.get(tag) ?? {};
    if (tagMap[elementId] === value) return;
    const next = { ...tagMap, [elementId]: value };
    this.localTags.set(tag, next);
    this.publishLocalAwareness();
    this.emit();
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
    this.publishLocalAwareness();
    this.emit();
  }

  getLocalAwareness(tag: string, elementId: string): unknown {
    return this.localTags.get(tag)?.[elementId];
  }

  /** Re-join so the server-side identity channel reflects an identity change
   * (e.g. the browser extension injecting a persistent identity). */
  refreshIdentity(): void {
    this.join();
    this.emit();
  }

  refresh(): void {
    this.emit();
  }

  destroy(): void {
    this.unsubscribe();
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
    const shards = buildElementPresenceShards(this.localTags);

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

  private handleMessage(message: PresenceServerMessage): void {
    if (message.type === "presence-sync") {
      this.applySync(message.peers);
      this.emit();
      return;
    }
    if (message.type === "presence-changes") {
      if (this.applyChanges(message)) {
        this.emit();
      }
    }
    // presence-rate / presence-error: cursor client logs these when sharing a
    // socket; element awareness has no pacing to adjust, so ignore.
  }

  private applySync(snapshot: PresenceSnapshot): void {
    this.peers.clear();
    for (const [connectionId, channels] of Object.entries(snapshot)) {
      const kept: Record<string, unknown> = {};
      for (const [channel, value] of Object.entries(channels)) {
        if (isElementRelevantChannel(channel)) kept[channel] = value;
      }
      if (Object.keys(kept).length > 0) this.peers.set(connectionId, kept);
    }
  }

  private applyChanges(message: PresenceChangesMessage): boolean {
    let changed = false;

    for (const [connectionId, channels] of Object.entries(message.updates)) {
      for (const [channel, value] of Object.entries(channels)) {
        if (!isElementRelevantChannel(channel)) continue;
        const peer = this.peers.get(connectionId) ?? {};
        this.peers.set(connectionId, peer);
        peer[channel] = value;
        changed = true;
      }
    }

    for (const [connectionId, channels] of Object.entries(message.removes)) {
      const peer = this.peers.get(connectionId);
      if (!peer) continue;
      for (const channel of channels) {
        if (!(channel in peer)) continue;
        delete peer[channel];
        changed = true;
      }
      if (Object.keys(peer).length === 0) {
        this.peers.delete(connectionId);
      }
    }

    return changed;
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

    for (const connectionId of Array.from(this.peers.keys()).sort()) {
      const channels = this.peers.get(connectionId)!;
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
