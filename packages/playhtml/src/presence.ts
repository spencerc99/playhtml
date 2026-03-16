// ABOUTME: Implements the PresenceAPI — unified per-user presence with named channels.
// ABOUTME: Wraps a Yjs awareness instance, exposing custom fields alongside cursor/identity data.

import type { PresenceAPI, PresenceView, PlayerIdentity, Cursor } from "@playhtml/common";
import { getStableIdForAwareness } from "./awareness-utils";

const PRESENCE_FIELD = "__presence__";
const CURSOR_FIELD = "__playhtml_cursors__";
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

  // Build a fingerprint scoped to a specific channel across all users.
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
        // Cursor channel reads from __playhtml_cursors__.cursor
        const cursorState = state[CURSOR_FIELD] as
          | { cursor?: unknown }
          | undefined;
        channelValue = cursorState?.cursor;
      } else {
        // Custom channels read from __presence__[channel]
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

      // Check each channel listener's fingerprint independently
      for (const listener of listeners.values()) {
        const fingerprint = channelFingerprint(
          states as Map<number, Record<string, unknown>>,
          listener.channel,
        );
        if (fingerprint === listener.lastFingerprint) continue;
        listener.lastFingerprint = fingerprint;
        listener.callback(buildPresences());
      }
    });
  }

  function buildViewFromState(state: Record<string, unknown>, isMe: boolean): PresenceView {
    const cursorState = state[CURSOR_FIELD] as
      | { cursor?: Cursor | null; playerIdentity?: PlayerIdentity; zone?: unknown }
      | undefined;

    const playerIdentity = cursorState?.playerIdentity;
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

  function buildPresences(): Map<string, PresenceView> {
    const presences = new Map<string, PresenceView>();
    const awareness = getAwareness();
    const states = awareness.getStates();
    const myClientId = awareness.clientID;
    let selfSeen = false;

    states.forEach((state: Record<string, unknown>, clientId: number) => {
      const isMe = clientId === myClientId;
      if (isMe) selfSeen = true;

      const stableId = getStableIdForAwareness(state, clientId);
      const view = buildViewFromState(state, isMe);
      presences.set(stableId, view);
    });

    // Ensure self is always present even if awareness hasn't synced
    if (!selfSeen) {
      const myIdentity = deps.getPlayerIdentity();
      const localState = awareness.getLocalState() ?? {};
      const customChannels = (localState[PRESENCE_FIELD] as Record<string, unknown>) ?? {};
      const view: PresenceView = {
        playerIdentity: myIdentity,
        cursor: null,
        isMe: true,
      };
      for (const [key, value] of Object.entries(customChannels)) {
        if (!SYSTEM_FIELDS.has(key) && value != null) {
          (view as Record<string, unknown>)[key] = value;
        }
      }
      presences.set(myIdentity.publicKey, view);
    }

    return presences;
  }

  return {
    setMyPresence(channel: string, data: unknown): void {
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
      return buildPresences();
    },

    onPresenceChange(
      channel: string,
      callback: (presences: Map<string, PresenceView>) => void,
    ): () => void {
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
