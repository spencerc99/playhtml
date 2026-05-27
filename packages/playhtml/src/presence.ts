// ABOUTME: Implements the PresenceAPI — unified per-user presence with named channels.
// ABOUTME: Wraps a Yjs awareness instance, exposing custom fields alongside cursor/identity data.

import type { PresenceAPI, PresenceView, PlayerIdentity, Cursor } from "@playhtml/common";
import { getStableIdForAwareness } from "./awareness-utils";

const PRESENCE_FIELD = "__presence__";
const CURSOR_FIELD = "__playhtml_cursors__";
const IDENTITY_FIELD = "__playhtml_identity__";
const SYSTEM_FIELDS = new Set(["playerIdentity", "cursor", "isMe"]);

/** Minimal awareness interface matching YPartyKitProvider.awareness */
interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface PresenceDeps {
  getAwareness: () => AwarenessLike;
  getPlayerIdentity: () => PlayerIdentity;
}

interface ChannelListener {
  channel: string;
  callback: (presences: Map<string, PresenceView>) => void;
  lastFingerprint: string;
}

export function createPresenceAPI(deps: PresenceDeps): PresenceAPI {
  const listeners = new Map<string, ChannelListener>();
  let awarenessListenerAttached = false;
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
    const awareness = getAwareness();
    if (awareness.getLocalState()?.[IDENTITY_FIELD]) return;
    awareness.setLocalStateField(IDENTITY_FIELD, deps.getPlayerIdentity());
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

  function attachAwarenessListener(): void {
    if (awarenessListenerAttached) return;
    awarenessListenerAttached = true;

    getAwareness().on("change", () => {
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
    });
  }

  function buildViewFromState(state: Record<string, unknown>, isMe: boolean): PresenceView {
    const cursorState = state[CURSOR_FIELD] as
      | { cursor?: Cursor | null; playerIdentity?: PlayerIdentity; zone?: unknown }
      | undefined;

    const playerIdentity =
      cursorState?.playerIdentity ??
      (state[IDENTITY_FIELD] as PlayerIdentity | undefined);
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

    return presences;
  }

  return {
    setMyPresence(channel: string, data: unknown): void {
      ensureIdentityWritten();
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
      return buildPresences();
    },

    onPresenceChange(
      channel: string,
      callback: (presences: Map<string, PresenceView>) => void,
    ): () => void {
      ensureIdentityWritten();
      const id = String(nextListenerId++);
      listeners.set(id, { channel, callback, lastFingerprint: "" });
      attachAwarenessListener();

      return () => {
        listeners.delete(id);
      };
    },

    getMyIdentity(): PlayerIdentity {
      return deps.getPlayerIdentity();
    },
  };
}
