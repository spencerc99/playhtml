// ABOUTME: Publishes and consumes page presence over the realtime presence transport.
// ABOUTME: Rebuilds per-channel PresenceView maps from page-scoped presence peers.

import {
  type Cursor,
  type CursorPresenceView,
  type PlayerIdentity,
  type PresenceAPI,
  type PresenceView,
} from "@playhtml/common";
import type { RealtimePresenceTransport } from "./presence-transport";
import {
  clearPresenceChannel,
  fromPagePresenceChannel,
  getPeerPublicKey,
  isPagePresenceChannel,
  isPresenceRecord,
  isReservedPresenceField,
  publishPresenceValue,
  safeInvoke,
  startPresenceKeepalive,
  toPagePresenceChannel,
  unwrapPagePresenceValue,
  wrapPagePresenceValue,
} from "./presence-utils";

type PresenceClientOptions = {
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

// After a publish, re-send the latest channel state once things quiet down.
// Page presence shares the server's low-frequency `event` budget (20 messages
// per FIXED 1,000ms window). A burst past the budget is dropped for the rest of
// that window, so the trailing re-publish MUST land in a fresh window — schedule
// it just beyond the window, not inside it (a 400ms replay would be dropped too,
// with no further retry).
const PRESENCE_REPUBLISH_DELAY_MS = 1_100;

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
  // Wire channels whose clear may not have reached the server yet (a dropped
  // clear is otherwise permanent: localChannels no longer holds the value, so
  // the trailing republish wouldn't re-send it). Cleared channels are held here
  // until a trailing republish re-issues the clear.
  private pendingClears = new Set<string>();
  private listeners = new Map<string, ChannelListener>();
  private nextListenerId = 0;
  private unsubscribe: () => void;
  private stopKeepalive: () => void;
  private republishTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(options: PresenceClientOptions) {
    this.transport = options.transport;
    this.getIdentity = options.getIdentity;
    this.getPage = options.getPage;
    this.getCursorPresences = options.getCursorPresences;
    this.onCursorPresencesChange = options.onCursorPresencesChange;
    // The shared per-socket PeerStore folds messages; we subscribe to just the
    // presence + identity namespaces so frame-rate cursor traffic never fires
    // page-presence listeners. One shared listener reference means a combined
    // message (presence + identity) emits once; per-channel fingerprinting in
    // emit() further dedupes within the presence namespace. subscribe() replays.
    const onChange = () => this.emit();
    const unsubPresence = this.transport.peers.subscribe("presence", onChange);
    const unsubIdentity = this.transport.peers.subscribe("identity", onChange);
    this.unsubscribe = () => {
      unsubPresence();
      unsubIdentity();
    };
    // Keepalive: re-stamp live channels on a low-frequency timer so a quiet-
    // but-connected peer's presence doesn't age out of peers' views.
    this.stopKeepalive = startPresenceKeepalive(() => {
      if (this.destroyed || this.localChannels.size === 0) return;
      this.republishLiveChannels();
    });
    this.join();
  }

  setMyPresence(channel: string, data: unknown): void {
    if (isReservedPresenceField(channel)) {
      throw new Error(
        `[playhtml] "${channel}" is a reserved presence field and cannot be used as a channel name. ` +
          `playerIdentity, cursor, and isMe are populated by playhtml; choose a different channel name.`,
      );
    }
    const wireChannel = toPagePresenceChannel(channel);
    if (data === null || data === undefined) {
      if (!this.localChannels.has(channel) && this.pendingClears.has(wireChannel)) {
        // Already cleared and the clear is still pending retry — nothing to do.
        return;
      }
      this.localChannels.delete(channel);
      // Track the clear until a trailing republish re-issues it, so a clear
      // dropped over the rate budget is not permanent (localChannels no longer
      // holds the value for the republish to re-send).
      this.pendingClears.add(wireChannel);
      clearPresenceChannel(this.transport, wireChannel, "presence");
    } else {
      this.localChannels.set(channel, data);
      this.pendingClears.delete(wireChannel);
      this.publishChannel(channel, data);
    }
    this.scheduleRepublish();
    this.emit();
  }

  /** Publish a live channel wrapped in the staleness envelope ({at, value}). */
  private publishChannel(channel: string, data: unknown): void {
    publishPresenceValue(
      this.transport,
      toPagePresenceChannel(channel),
      wrapPagePresenceValue(data),
      "presence",
    );
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
      // Isolate the immediate replay (future notifications go through the hub's
      // own isolation).
      safeInvoke(() => callback(this.buildPresences()), "presence subscriber");
      return unsubscribe ?? (() => {});
    }

    const id = String(this.nextListenerId++);
    this.listeners.set(id, {
      channel,
      callback,
      lastFingerprint: this.channelFingerprint(channel),
    });
    // Replay the current snapshot immediately so late subscribers see existing
    // peer state instead of waiting for the next change. Isolate the throw so it
    // doesn't propagate to the subscribing caller (and future emits are already
    // isolated in emit()).
    safeInvoke(() => callback(this.buildPresences()), "presence subscriber");
    return () => {
      this.listeners.delete(id);
    };
  }

  getMyIdentity(): PlayerIdentity {
    return this.getIdentity();
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
   * After a publish burst settles, re-send the latest value of every live
   * channel once, recovering anything the server dropped over its rate budget.
   */
  private scheduleRepublish(): void {
    if (this.destroyed) return;
    if (this.republishTimer !== null) clearTimeout(this.republishTimer);
    this.republishTimer = setTimeout(() => {
      this.republishTimer = null;
      if (this.destroyed) return;
      // Re-send the latest value of every live channel (fresh `at`)...
      this.republishLiveChannels();
      // ...and re-issue any clears that may have been dropped. This lands in a
      // fresh rate window (see PRESENCE_REPUBLISH_DELAY_MS), so treat them as
      // delivered afterwards.
      for (const wireChannel of this.pendingClears) {
        clearPresenceChannel(this.transport, wireChannel, "presence");
      }
      this.pendingClears.clear();
    }, PRESENCE_REPUBLISH_DELAY_MS);
  }

  /** Re-send every live channel with a fresh timestamp. Shared by the burst
   * recovery (scheduleRepublish) and the keepalive re-stamp. */
  private republishLiveChannels(): void {
    for (const [channel, value] of this.localChannels) {
      this.publishChannel(channel, value);
    }
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

  /** The shared PeerStore's folded peer map. Views read all channels and filter
   * to the presence + identity namespaces they care about. */
  private get peers(): Map<string, Record<string, unknown>> {
    return this.transport.peers.getPeers();
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
      // Commit the fingerprint only after successful delivery so a throwing
      // subscriber doesn't permanently swallow the next matching state (and one
      // throw can't skip the remaining listeners).
      const delivered = safeInvoke(
        () => listener.callback(getOnce()),
        "presence subscriber",
      );
      if (delivered) listener.lastFingerprint = fingerprint;
    }
  }

  /** Fingerprint of one channel across self + all remote peers, so a listener
   * only fires when its channel actually changed. Fingerprints the UNWRAPPED
   * payload so a keepalive re-stamp (which only bumps the envelope `at`) does
   * not count as a change and re-fire subscribers. */
  private channelFingerprint(channel: string): string {
    const parts: string[] = [];
    if (this.localChannels.has(channel)) {
      parts.push(`self:${safeStringify(this.localChannels.get(channel))}`);
    }
    const wireChannel = toPagePresenceChannel(channel);
    for (const connectionId of Array.from(this.peers.keys()).sort()) {
      const folded = this.peers.get(connectionId)?.[wireChannel];
      if (folded === undefined) continue;
      parts.push(`${connectionId}:${safeStringify(unwrapPagePresenceValue(folded))}`);
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
      const publicKey = getPeerPublicKey(channels);
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
        const field = fromPagePresenceChannel(channel);
        // Security boundary: a hostile peer can bypass the write-side check and
        // publish presence:playerIdentity (etc.) directly. Never let a stripped
        // key overwrite a trusted PresenceView system field.
        if (isReservedPresenceField(field)) continue;
        // Unwrap the {at, value} staleness envelope back to the user's payload.
        (view as Record<string, unknown>)[field] = unwrapPagePresenceValue(value);
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
      // localChannels can't hold a reserved name (setMyPresence rejects them),
      // but guard anyway so a reserved key can never shadow a trusted field.
      if (isReservedPresenceField(channel)) continue;
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
