// ABOUTME: Publishes and consumes page presence over the realtime presence transport.
// ABOUTME: Rebuilds per-channel PresenceView maps from page-scoped presence peers.

import {
  MAX_PRESENCE_VALUE_BYTES,
  type Cursor,
  type CursorPresenceView,
  type PlayerIdentity,
  type PresenceAPI,
  type PresenceChangesMessage,
  type PresenceServerMessage,
  type PresenceSnapshot,
  type PresenceView,
} from "@playhtml/common";
import type { RealtimePresenceTransport } from "./presence-transport";
import { isPresenceRecord } from "./presence-utils";

// Custom presence channels are published under this prefix so the server
// classifies them as low-frequency `event` traffic and they never collide with
// the reserved `cursor` / `identity` / `element:*` channels sharing the socket.
export const PAGE_PRESENCE_CHANNEL_PREFIX = "presence:";

/** Channels this client mirrors from peers; everything else (cursor / element
 * traffic on a shared socket) is handled elsewhere or ignored. */
function isPagePresenceChannel(channel: string): boolean {
  return channel.startsWith(PAGE_PRESENCE_CHANNEL_PREFIX);
}

function toPagePresenceChannel(channel: string): string {
  return `${PAGE_PRESENCE_CHANNEL_PREFIX}${channel}`;
}

function fromPagePresenceChannel(channel: string): string {
  return channel.slice(PAGE_PRESENCE_CHANNEL_PREFIX.length);
}

export type PresenceClientOptions = {
  transport: RealtimePresenceTransport;
  getIdentity: () => PlayerIdentity;
  getPage: () => string | undefined;
  getCursorPresences?: () => Map<string, CursorPresenceView>;
  onCursorPresencesChange?: (
    callback: (presences: Map<string, CursorPresenceView>) => void,
  ) => (() => void) | undefined;
};

type ChannelListener = {
  channel: string;
  callback: (presences: Map<string, PresenceView>) => void;
  lastFingerprint: string;
};

/**
 * Page-presence client over the generic presence transport. Mirrors the public
 * PresenceAPI (setMyPresence/getPresences/onPresenceChange/getMyIdentity) but
 * publishes to presence channels instead of Yjs awareness. The cursor channel
 * is served from the shared cursor snapshot (getCursorPresences) exactly like
 * the Yjs-awareness fallback, so cursor rendering keeps one source of truth.
 */
export class PresenceClient implements PresenceAPI {
  private transport: RealtimePresenceTransport;
  private getIdentity: () => PlayerIdentity;
  private getPage: () => string | undefined;
  private getCursorPresences?: () => Map<string, CursorPresenceView>;
  private onCursorPresencesChange?: PresenceClientOptions["onCursorPresencesChange"];

  private localChannels = new Map<string, unknown>();
  private peers = new Map<string, Record<string, unknown>>();
  private listeners = new Map<string, ChannelListener>();
  private nextListenerId = 0;
  private unsubscribe: () => void;

  constructor(options: PresenceClientOptions) {
    this.transport = options.transport;
    this.getIdentity = options.getIdentity;
    this.getPage = options.getPage;
    this.getCursorPresences = options.getCursorPresences;
    this.onCursorPresencesChange = options.onCursorPresencesChange;
    this.unsubscribe = this.transport.subscribe((message) =>
      this.handleMessage(message),
    );
    this.join();
  }

  setMyPresence(channel: string, data: unknown): void {
    const wireChannel = toPagePresenceChannel(channel);
    if (data === null || data === undefined) {
      if (!this.localChannels.has(channel)) return;
      this.localChannels.delete(channel);
      this.clearChannel(wireChannel);
    } else {
      this.localChannels.set(channel, data);
      this.publishChannel(wireChannel, data);
    }
    this.emit();
  }

  getPresences(): Map<string, PresenceView> {
    return this.buildPresences();
  }

  onPresenceChange(
    channel: string,
    callback: (presences: Map<string, PresenceView>) => void,
  ): () => void {
    if (channel === "cursor" && this.onCursorPresencesChange) {
      const unsubscribe = this.onCursorPresencesChange(() => {
        callback(this.buildPresences());
      });
      callback(this.buildPresences());
      return unsubscribe ?? (() => {});
    }

    const id = String(this.nextListenerId++);
    this.listeners.set(id, {
      channel,
      callback,
      lastFingerprint: this.channelFingerprint(channel),
    });
    // Replay the current snapshot immediately so late subscribers see existing
    // peer state instead of waiting for the next change.
    callback(this.buildPresences());
    return () => {
      this.listeners.delete(id);
    };
  }

  getMyIdentity(): PlayerIdentity {
    return this.getIdentity();
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
      console.warn("[playhtml] Failed to join presence room:", error);
    }
  }

  private publishChannel(channel: string, value: unknown): void {
    if (jsonByteLength(value) > MAX_PRESENCE_VALUE_BYTES) {
      console.warn(
        "[playhtml] Failed to publish presence:",
        new Error(
          `Presence value must be ${MAX_PRESENCE_VALUE_BYTES} bytes or less`,
        ),
      );
      return;
    }
    try {
      this.transport.update(channel, value);
    } catch (error) {
      console.warn("[playhtml] Failed to publish presence:", error);
    }
  }

  private clearChannel(channel: string): void {
    try {
      this.transport.clear(channel);
    } catch (error) {
      console.warn("[playhtml] Failed to clear presence:", error);
    }
  }

  private handleMessage(message: PresenceServerMessage): void {
    if (message.type === "presence-sync") {
      this.applySync(message.peers);
      this.emit();
      return;
    }
    if (message.type === "presence-changes") {
      if (this.applyChanges(message)) this.emit();
    }
    // presence-rate / presence-error: cursor client logs these when sharing a
    // socket; page presence has no pacing to adjust, so ignore.
  }

  private applySync(snapshot: PresenceSnapshot): void {
    this.peers.clear();
    for (const [connectionId, channels] of Object.entries(snapshot)) {
      const kept = this.keepRelevantChannels(channels);
      if (Object.keys(kept).length > 0) this.peers.set(connectionId, kept);
    }
  }

  private keepRelevantChannels(
    channels: Record<string, unknown>,
  ): Record<string, unknown> {
    const kept: Record<string, unknown> = {};
    for (const [channel, value] of Object.entries(channels)) {
      if (channel === "identity" || isPagePresenceChannel(channel)) {
        kept[channel] = value;
      }
    }
    return kept;
  }

  private applyChanges(message: PresenceChangesMessage): boolean {
    let changed = false;

    for (const [connectionId, channels] of Object.entries(message.updates)) {
      for (const [channel, value] of Object.entries(channels)) {
        if (channel !== "identity" && !isPagePresenceChannel(channel)) continue;
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
      if (Object.keys(peer).length === 0) this.peers.delete(connectionId);
    }

    return changed;
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    let cached: Map<string, PresenceView> | null = null;
    const getOnce = () => {
      if (!cached) cached = this.buildPresences();
      return cached;
    };
    for (const listener of this.listeners.values()) {
      const fingerprint = this.channelFingerprint(listener.channel);
      if (fingerprint === listener.lastFingerprint) continue;
      listener.lastFingerprint = fingerprint;
      listener.callback(getOnce());
    }
  }

  /** Fingerprint of one channel across self + all remote peers, so a listener
   * only fires when its channel actually changed. */
  private channelFingerprint(channel: string): string {
    const parts: string[] = [];
    if (this.localChannels.has(channel)) {
      parts.push(`self:${safeStringify(this.localChannels.get(channel))}`);
    }
    const wireChannel = toPagePresenceChannel(channel);
    for (const connectionId of Array.from(this.peers.keys()).sort()) {
      const value = this.peers.get(connectionId)?.[wireChannel];
      if (value === undefined) continue;
      parts.push(`${connectionId}:${safeStringify(value)}`);
    }
    return parts.join("|");
  }

  private buildPresences(): Map<string, PresenceView> {
    const presences = new Map<string, PresenceView>();
    const myPublicKey = this.getIdentity().publicKey;

    // Self: always present, sourced from local channel values.
    presences.set(myPublicKey, this.buildSelfView());

    // Remote peers keyed by identity publicKey (multi-tab collapse). Our own
    // server echo (and other tabs sharing our identity) is skipped — the local
    // channel map is canonical for self.
    for (const connectionId of Array.from(this.peers.keys()).sort()) {
      const channels = this.peers.get(connectionId)!;
      const identity = channels.identity;
      const publicKey =
        isPresenceRecord(identity) && typeof identity.publicKey === "string"
          ? identity.publicKey
          : undefined;
      if (publicKey === myPublicKey) continue;
      const stableId = publicKey ?? connectionId;

      const view: PresenceView = presences.get(stableId) ?? {
        playerIdentity: isPresenceRecord(identity)
          ? (identity as unknown as PlayerIdentity)
          : undefined,
        cursor: null,
        isMe: false,
      };
      if (!view.playerIdentity && isPresenceRecord(identity)) {
        view.playerIdentity = identity as unknown as PlayerIdentity;
      }

      for (const [channel, value] of Object.entries(channels)) {
        if (!isPagePresenceChannel(channel)) continue;
        (view as Record<string, unknown>)[fromPagePresenceChannel(channel)] =
          value;
      }
      presences.set(stableId, view);
    }

    this.mergeCursorPresences(presences, myPublicKey);
    return presences;
  }

  private buildSelfView(): PresenceView {
    const view: PresenceView = {
      playerIdentity: this.getIdentity(),
      cursor: null,
      isMe: true,
    };
    for (const [channel, value] of this.localChannels) {
      (view as Record<string, unknown>)[channel] = value;
    }
    return view;
  }

  private mergeCursorPresences(
    presences: Map<string, PresenceView>,
    selfPublicKey: string,
  ): void {
    const cursorPresences = this.getCursorPresences?.();
    if (!cursorPresences) return;
    for (const [stableId, cursorPresence] of cursorPresences) {
      const existing = presences.get(stableId);
      presences.set(stableId, {
        ...existing,
        playerIdentity:
          cursorPresence.playerIdentity ?? existing?.playerIdentity,
        cursor: (cursorPresence.cursor as Cursor | null) ?? null,
        isMe: stableId === selfPublicKey,
      });
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
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
