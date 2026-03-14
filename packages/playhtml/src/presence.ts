// ABOUTME: Implements the PresenceAPI — unified per-user presence with named channels.
// ABOUTME: Wraps a Yjs awareness instance, exposing custom fields alongside cursor/identity data.

import type { PresenceAPI, PresenceView, PlayerIdentity, Cursor } from "@playhtml/common";
import { getStableIdForAwareness } from "./awareness-utils";

const PRESENCE_FIELD = "__presence__";
const CURSOR_FIELD = "__playhtml_cursors__";
const SYSTEM_FIELDS = new Set(["playerIdentity", "cursor"]);

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

export function createPresenceAPI(deps: PresenceDeps): PresenceAPI {
  const listeners = new Map<string, (presences: Map<string, PresenceView>) => void>();
  let awarenessListenerAttached = false;
  let lastPresenceFingerprint = "";

  function getAwareness(): AwarenessLike {
    return deps.getAwareness();
  }

  // Build a fingerprint of just the presence-relevant fields to avoid
  // firing callbacks on every cursor movement (awareness changes at ~60fps).
  function presenceFingerprint(states: Map<number, Record<string, unknown>>): string {
    const parts: string[] = [];
    const clientIds = Array.from(states.keys()).sort((a, b) => a - b);
    for (const clientId of clientIds) {
      const state = states.get(clientId);
      if (!state) continue;
      const presence = state[PRESENCE_FIELD];
      const cursorData = state[CURSOR_FIELD] as
        | { playerIdentity?: { publicKey?: string } }
        | undefined;
      const identity = cursorData?.playerIdentity?.publicKey ?? "";
      try {
        parts.push(`${clientId}:${identity}:${JSON.stringify(presence ?? {})}`);
      } catch {
        parts.push(`${clientId}:${identity}:{}`);
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
      const fingerprint = presenceFingerprint(states as Map<number, Record<string, unknown>>);
      if (fingerprint === lastPresenceFingerprint) return;
      lastPresenceFingerprint = fingerprint;

      const presences = buildPresences();
      listeners.forEach((cb) => cb(presences));
    });
  }

  function buildPresences(): Map<string, PresenceView> {
    const presences = new Map<string, PresenceView>();
    const awareness = getAwareness();
    const states = awareness.getStates();
    const myClientId = awareness.clientID;

    states.forEach((state: Record<string, unknown>, clientId: number) => {
      // Exclude self
      if (clientId === myClientId) return;

      const stableId = getStableIdForAwareness(state, clientId);

      // Extract cursor data
      const cursorState = state[CURSOR_FIELD] as
        | { cursor?: Cursor | null; playerIdentity?: PlayerIdentity; zone?: unknown }
        | undefined;

      const playerIdentity = cursorState?.playerIdentity;
      const cursor = cursorState?.cursor ?? null;

      // Extract custom presence channels
      const customChannels = (state[PRESENCE_FIELD] as Record<string, unknown>) ?? {};

      // Build flattened view: system fields + custom channels (system fields win on collision)
      const view: PresenceView = {
        playerIdentity,
        cursor,
      };

      // Flatten custom channels, skipping system field collisions
      for (const [key, value] of Object.entries(customChannels)) {
        if (!SYSTEM_FIELDS.has(key) && value != null) {
          (view as Record<string, unknown>)[key] = value;
        }
      }

      presences.set(stableId, view);
    });

    return presences;
  }

  return {
    setMyPresence(channel: string, data: unknown): void {
      const awareness = getAwareness();
      const currentState = awareness.getLocalState() ?? {};
      const currentPresence = (currentState[PRESENCE_FIELD] as Record<string, unknown>) ?? {};

      let newPresence: Record<string, unknown>;
      if (data === null || data === undefined) {
        // Remove the channel
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
      callback: (presences: Map<string, PresenceView>) => void,
    ): () => void {
      const id = Math.random().toString(36).slice(2);
      listeners.set(id, callback);
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
