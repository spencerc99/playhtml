// ABOUTME: Implements the PresenceAPI — unified per-user presence with named channels.
// ABOUTME: Wraps a Yjs awareness instance, exposing custom fields alongside cursor/identity data.

import type {
  Cursor,
  CursorPresenceView,
  PlayerIdentity,
  PresenceAPI,
  PresenceView,
} from "@playhtml/common";
import { getStableIdForAwareness } from "./awareness-utils";

const PRESENCE_FIELD = "__presence__";
const CURSOR_FIELD = "__playhtml_cursors__";
const IDENTITY_FIELD = "__playhtml_identity__";
const SYSTEM_FIELDS = new Set(["playerIdentity", "cursor", "isMe"]);

/** Minimal awareness interface matching YPartyKitProvider.awareness */
export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface PresenceDeps {
  getAwareness: () => AwarenessLike;
  getPlayerIdentity: () => PlayerIdentity;
  getCursorPresences?: () => Map<string, CursorPresenceView>;
  onCursorPresencesChange?: (
    callback: (presences: Map<string, CursorPresenceView>) => void,
  ) => () => void;
}

interface ChannelListener {
  channel: string;
  callback: (presences: Map<string, PresenceView>) => void;
  lastFingerprint: string;
}

export function createPresenceAPI(deps: PresenceDeps): PresenceAPI {
  const listeners = new Map<string, ChannelListener>();
  const attachedAwarenessObjects = new WeakSet<AwarenessLike>();
  let currentAwareness: AwarenessLike | null = null;
  let nextListenerId = 0;

  function getAwareness(): AwarenessLike {
    return deps.getAwareness();
  }

  // Write our identity into a dedicated awareness field so remote peers can
  // resolve playerIdentity even on rooms where no cursor client is running.
  // Idempotency keyed on the current awareness's local state (not a closure
  // boolean) so SPA navigation that rebuilds the provider — and with it the
  // awareness object — re-arms the write on the new awareness.
  function ensureIdentityWritten(): void {
    ensureAwarenessIdentity(getAwareness(), deps.getPlayerIdentity());
  }

  function channelFingerprint(
    states: Map<number, Record<string, unknown>>,
    channel: string,
  ): string {
    const parts: string[] = [];
    const clientIds = Array.from(states.keys()).sort((a, b) => a - b);
    for (const clientId of clientIds) {
      const state = states.get(clientId);
      if (!state) continue;

      let channelValue: unknown;
      if (channel === "cursor") {
        const cursorState = state[CURSOR_FIELD] as
          | { cursor?: unknown }
          | undefined;
        channelValue = cursorState?.cursor;
      } else {
        const presence = state[PRESENCE_FIELD] as Record<string, unknown> | undefined;
        channelValue = presence?.[channel];
      }

      try {
        parts.push(`${clientId}:${JSON.stringify(channelValue ?? null)}`);
      } catch {
        parts.push(`${clientId}:null`);
      }
    }
    return parts.join("|");
  }

  function handleAwarenessChange(): void {
    if (listeners.size === 0) return;
    const states = getAwareness().getStates();

    // Cache buildPresences() so multiple listeners in the same event share the result
    let cachedPresences: Map<string, PresenceView> | null = null;
    const getPresencesOnce = () => {
      if (!cachedPresences) cachedPresences = buildPresences();
      return cachedPresences;
    };

    for (const listener of listeners.values()) {
      const fingerprint = channelFingerprint(
        states as Map<number, Record<string, unknown>>,
        listener.channel,
      );
      if (fingerprint === listener.lastFingerprint) continue;
      listener.lastFingerprint = fingerprint;
      listener.callback(getPresencesOnce());
    }
  }

  function attachAwarenessListener(): void {
    const awareness = getAwareness();
    if (currentAwareness === awareness) return;
    currentAwareness = awareness;
    if (attachedAwarenessObjects.has(awareness)) return;
    attachedAwarenessObjects.add(awareness);
    awareness.on("change", handleAwarenessChange);
  }

  function attachAwarenessListenerIfSubscribed(): void {
    if (listeners.size > 0) attachAwarenessListener();
  }

  function buildViewFromState(state: Record<string, unknown>, isMe: boolean): PresenceView {
    const cursorState = state[CURSOR_FIELD] as
      | { cursor?: Cursor | null; playerIdentity?: PlayerIdentity; zone?: unknown }
      | undefined;

    const playerIdentity =
      (state[IDENTITY_FIELD] as PlayerIdentity | undefined) ??
      cursorState?.playerIdentity;
    const cursor = cursorState?.cursor ?? null;
    const customChannels = (state[PRESENCE_FIELD] as Record<string, unknown>) ?? {};

    const view: PresenceView = {
      playerIdentity,
      cursor,
      isMe,
    };

    for (const [key, value] of Object.entries(customChannels)) {
      if (!SYSTEM_FIELDS.has(key) && value != null) {
        (view as Record<string, unknown>)[key] = value;
      }
    }

    return view;
  }

  // Stable ID for self, consistent with getStableIdForAwareness
  function getSelfStableId(): string {
    const awareness = getAwareness();
    const localState = awareness.getLocalState();
    if (localState) {
      return getStableIdForAwareness(localState, awareness.clientID);
    }
    return deps.getPlayerIdentity().publicKey;
  }

  function buildPresences(): Map<string, PresenceView> {
    const presences = new Map<string, PresenceView>();
    const awareness = getAwareness();
    const states = awareness.getStates();
    const myClientId = awareness.clientID;
    const mySelfStableId = getSelfStableId();
    let selfSeen = false;

    // Multiple tabs of the same user share a publicKey (stableId) but have
    // distinct clientIDs. When collapsing into one entry per stableId:
    //  - For self: always prefer the local clientID's state so the consumer
    //    sees what THIS tab broadcast, not a non-deterministic other tab.
    //  - For remote peers: prefer the highest clientID, a stable tiebreaker
    //    that avoids flapping based on Map iteration order.
    const winningClientIdByStableId = new Map<string, number>();
    states.forEach((state: Record<string, unknown>, clientId: number) => {
      const stableId = getStableIdForAwareness(state, clientId);
      const isSelf = stableId === mySelfStableId;
      const existing = winningClientIdByStableId.get(stableId);
      if (existing === undefined) {
        winningClientIdByStableId.set(stableId, clientId);
        return;
      }
      // Self always wins via the local clientID
      if (isSelf && clientId === myClientId) {
        winningClientIdByStableId.set(stableId, clientId);
        return;
      }
      if (isSelf && existing === myClientId) return;
      // Remote: highest clientID wins
      if (clientId > existing) winningClientIdByStableId.set(stableId, clientId);
    });

    for (const [stableId, clientId] of winningClientIdByStableId) {
      const state = states.get(clientId);
      if (!state) continue;
      const isMe = stableId === mySelfStableId;
      if (isMe) selfSeen = true;
      presences.set(stableId, buildViewFromState(state, isMe));
    }

    // Ensure self is always present even if awareness hasn't synced
    if (!selfSeen) {
      const localState = awareness.getLocalState() ?? {};
      const view = buildViewFromState(localState, true);
      // Use identity for playerIdentity since cursor state may not be set
      view.playerIdentity = deps.getPlayerIdentity();
      presences.set(mySelfStableId, view);
    }

    mergeCursorPresences(presences, mySelfStableId);

    return presences;
  }

  function mergeCursorPresences(
    presences: Map<string, PresenceView>,
    selfStableId: string,
  ): void {
    const cursorPresences = deps.getCursorPresences?.();
    if (!cursorPresences) return;

    for (const [stableId, cursorPresence] of cursorPresences) {
      const existing = presences.get(stableId);
      presences.set(stableId, {
        ...existing,
        playerIdentity:
          cursorPresence.playerIdentity ?? existing?.playerIdentity,
        cursor: cursorPresence.cursor ?? null,
        isMe: stableId === selfStableId,
      });
    }
  }

  return {
    setMyPresence(channel: string, data: unknown): void {
      ensureIdentityWritten();
      attachAwarenessListenerIfSubscribed();
      const awareness = getAwareness();
      const currentState = awareness.getLocalState() ?? {};
      const currentPresence = (currentState[PRESENCE_FIELD] as Record<string, unknown>) ?? {};

      let newPresence: Record<string, unknown>;
      if (data === null || data === undefined) {
        const { [channel]: _, ...rest } = currentPresence;
        newPresence = rest;
      } else {
        newPresence = { ...currentPresence, [channel]: data };
      }

      awareness.setLocalStateField(PRESENCE_FIELD, newPresence);
    },

    getPresences(): Map<string, PresenceView> {
      ensureIdentityWritten();
      attachAwarenessListenerIfSubscribed();
      return buildPresences();
    },

    onPresenceChange(
      channel: string,
      callback: (presences: Map<string, PresenceView>) => void,
    ): () => void {
      ensureIdentityWritten();
      if (channel === "cursor" && deps.onCursorPresencesChange) {
        const unsubscribe = deps.onCursorPresencesChange(() => {
          callback(buildPresences());
        });
        callback(buildPresences());
        return unsubscribe;
      }

      const id = String(nextListenerId++);
      // Seed lastFingerprint with the current channel state so the listener
      // isn't re-fired redundantly on the next awareness change if nothing
      // actually changed for this channel.
      const currentStates = getAwareness().getStates() as Map<
        number,
        Record<string, unknown>
      >;
      const initialFingerprint = channelFingerprint(currentStates, channel);
      listeners.set(id, { channel, callback, lastFingerprint: initialFingerprint });
      attachAwarenessListener();

      // Replay the current snapshot immediately so late subscribers receive
      // existing peer state instead of waiting for the next change. Consumers
      // assume "subscribe = current state + future changes"; without this, a
      // peer who set their state before we subscribed stays invisible to us.
      callback(buildPresences());

      return () => {
        listeners.delete(id);
      };
    },

    getMyIdentity(): PlayerIdentity {
      return deps.getPlayerIdentity();
    },
  };
}

export function ensureAwarenessIdentity(
  awareness: AwarenessLike,
  identity: PlayerIdentity,
): void {
  if (awareness.getLocalState()?.[IDENTITY_FIELD]) return;
  awareness.setLocalStateField(IDENTITY_FIELD, identity);
}
