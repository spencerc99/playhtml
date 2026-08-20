// ABOUTME: Owns durable user identity (name/color) independent of cursors.
// ABOUTME: Persists to localStorage, publishes to main-room awareness, and notifies subscribers.

import {
  generatePersistentPlayerIdentity,
  savePlayerIdentityToStorage,
  User,
  type CursorPresenceView,
  type PlayerIdentity,
} from "@playhtml/common";
import { getStableIdForAwareness } from "./awareness-utils";

const IDENTITY_FIELD = "__playhtml_identity__";
const CURSOR_FIELD = "__playhtml_cursors__";

/** Minimal awareness interface matching YPartyKitProvider.awareness */
export interface UsersAwarenessLike {
  clientID: number;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  setLocalStateField(field: string, value: unknown): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface UsersDeps {
  getAwareness: () => UsersAwarenessLike;
  getCursorPresences?: () => Map<string, CursorPresenceView>;
  onCursorPresencesChange?: (
    callback: (presences: Map<string, CursorPresenceView>) => void,
  ) => (() => void) | undefined;
}

/** Returns primary color from player identity; throws if missing (no default). */
function getPrimaryColor(identity: PlayerIdentity): string {
  const color = identity.playerStyle?.colorPalette?.[0];
  if (color == null || color === "") {
    throw new Error(
      "[playhtml] Player identity must have playerStyle.colorPalette[0] (primary color).",
    );
  }
  return color;
}

/** Validates identity has publicKey and primary color; throws if not. */
function assertValidPlayerIdentity(identity: PlayerIdentity): void {
  if (!identity.publicKey) {
    throw new Error("[playhtml] Player identity must have publicKey.");
  }
  getPrimaryColor(identity);
}

function toUser(identity: PlayerIdentity, isMe: boolean): User {
  return {
    pid: identity.publicKey,
    name: identity.name,
    color: getPrimaryColor(identity),
    isMe,
  };
}

export interface UsersSelfIdentity {
  readonly pid: string;
  name: string | undefined;
  color: string;
}

export interface UsersAPI {
  readonly me: UsersSelfIdentity;
  getAll(): User[];
  onChange(callback: (users: User[]) => void): () => void;
  /** Adopts a whole new identity object (init option / configure() injection). */
  adoptIdentity(identity: PlayerIdentity): void;
  /** Returns the live identity reference (cursor client keeps reading this). */
  getIdentity(): PlayerIdentity;
  /** Subscribe to any self identity mutation (color/name/whole-identity). */
  onSelfChange(callback: (identity: PlayerIdentity) => void): () => void;
  destroy(): void;
}

/**
 * Creates the users module: the single mutator of the shared PlayerIdentity
 * object, owning localStorage persistence and publication of
 * `__playhtml_identity__` to main-room awareness. `deps.getAwareness` may
 * return a different awareness instance across calls (e.g. after SPA
 * navigation rebuilds the provider) — identity is republished on every self
 * change and re-attached lazily on read.
 */
export function createUsersAPI(
  seedIdentity: PlayerIdentity,
  deps: UsersDeps,
): UsersAPI {
  let identity = seedIdentity;
  assertValidPlayerIdentity(identity);
  const selfChangeListeners = new Set<(identity: PlayerIdentity) => void>();
  const usersChangeListeners = new Set<(users: User[]) => void>();
  const attachedAwarenessObjects = new WeakSet<UsersAwarenessLike>();
  let currentAwareness: UsersAwarenessLike | null = null;
  let cursorPresencesUnsubscribe: (() => void) | null = null;
  let lastIdentityFingerprint = "";

  function publishIdentity(): void {
    deps.getAwareness().setLocalStateField(IDENTITY_FIELD, identity);
  }

  // Idempotent: writes identity into the current awareness's local state if
  // it isn't already there. Keyed on the current awareness object's local
  // state (not a closure boolean) so a rebuilt awareness (e.g. SPA navigation)
  // re-arms the write — same rationale as presence.ts's ensureAwarenessIdentity.
  function ensureIdentityWritten(): void {
    const awareness = deps.getAwareness();
    if (awareness.getLocalState()?.[IDENTITY_FIELD]) return;
    publishIdentity();
  }

  function notifySubscribers<T>(
    listeners: Set<(value: T) => void>,
    value: T,
    subscriberType: string,
  ): void {
    for (const callback of listeners) {
      try {
        callback(value);
      } catch (error) {
        console.error(`[playhtml] ${subscriberType} subscriber threw:`, error);
      }
    }
  }

  function notifySelfChange(): void {
    notifySubscribers(selfChangeListeners, identity, "users self-change");
  }

  function notifyUsersChange(): void {
    if (usersChangeListeners.size === 0) return;
    const users = getAll();
    notifySubscribers(usersChangeListeners, users, "users change");
  }

  function attachAwarenessListener(): void {
    const awareness = deps.getAwareness();
    if (currentAwareness === awareness) return;
    currentAwareness = awareness;
    if (attachedAwarenessObjects.has(awareness)) return;
    attachedAwarenessObjects.add(awareness);
    lastIdentityFingerprint = identityFingerprint(awareness.getStates());
    awareness.on("change", handleAwarenessChange);
  }

  // Fingerprint of __playhtml_identity__ and __playhtml_cursors__.playerIdentity
  // across all awareness states. Presence API channel fingerprints only cover
  // PRESENCE_FIELD/cursor position, so identity changes need their own listener.
  function identityFingerprint(
    states: Map<number, Record<string, unknown>>,
  ): string {
    const parts: string[] = [];
    const clientIds = Array.from(states.keys()).sort((a, b) => a - b);
    for (const clientId of clientIds) {
      const state = states.get(clientId);
      if (!state) continue;
      const value =
        state[IDENTITY_FIELD] ??
        (state[CURSOR_FIELD] as { playerIdentity?: unknown } | undefined)
          ?.playerIdentity;
      try {
        parts.push(`${clientId}:${JSON.stringify(value ?? null)}`);
      } catch {
        parts.push(`${clientId}:null`);
      }
    }
    return parts.join("|");
  }

  function handleAwarenessChange(): void {
    const states = deps.getAwareness().getStates();
    const fingerprint = identityFingerprint(states);
    if (fingerprint === lastIdentityFingerprint) return;
    lastIdentityFingerprint = fingerprint;
    notifyUsersChange();
  }

  function ensureSubscribed(): void {
    ensureIdentityWritten();
    attachAwarenessListener();
    if (!cursorPresencesUnsubscribe && deps.onCursorPresencesChange) {
      const unsubscribe = deps.onCursorPresencesChange(() => {
        notifyUsersChange();
      });
      if (unsubscribe) {
        cursorPresencesUnsubscribe = unsubscribe;
      }
    }
  }

  function getSelfStableId(): string {
    const awareness = deps.getAwareness();
    const localState = awareness.getLocalState();
    if (localState) {
      return getStableIdForAwareness(localState, awareness.clientID);
    }
    return identity.publicKey;
  }

  function getAll(): User[] {
    const usersByStableId = new Map<string, User>();
    const awareness = deps.getAwareness();
    const states = awareness.getStates();
    const mySelfStableId = getSelfStableId();

    // Collapse multiple tabs of the same user (same stableId, different
    // clientId) into one entry — prefer self's local clientID, otherwise the
    // highest clientID (stable tiebreaker, avoids flapping on iteration order).
    const winningClientIdByStableId = new Map<string, number>();
    states.forEach((state: Record<string, unknown>, clientId: number) => {
      const stableId = getStableIdForAwareness(state, clientId);
      const isSelf = stableId === mySelfStableId;
      const existing = winningClientIdByStableId.get(stableId);
      if (existing === undefined) {
        winningClientIdByStableId.set(stableId, clientId);
        return;
      }
      if (isSelf && clientId === awareness.clientID) {
        winningClientIdByStableId.set(stableId, clientId);
        return;
      }
      if (isSelf && existing === awareness.clientID) return;
      if (clientId > existing) winningClientIdByStableId.set(stableId, clientId);
    });

    for (const [stableId, clientId] of winningClientIdByStableId) {
      const state = states.get(clientId);
      if (!state) continue;
      const isMe = stableId === mySelfStableId;
      const cursorState = state[CURSOR_FIELD] as
        | { playerIdentity?: PlayerIdentity }
        | undefined;
      const remoteIdentity =
        (state[IDENTITY_FIELD] as PlayerIdentity | undefined) ??
        cursorState?.playerIdentity;
      if (isMe) {
        usersByStableId.set(stableId, toUser(identity, true));
      } else if (remoteIdentity) {
        try {
          usersByStableId.set(stableId, toUser(remoteIdentity, false));
        } catch {
          // Remote identity missing a primary color (old client, corrupted
          // state) — skip rather than surface an invalid User.
        }
      }
    }

    // Self is always present, even if awareness hasn't synced yet.
    if (!usersByStableId.has(mySelfStableId)) {
      usersByStableId.set(mySelfStableId, toUser(identity, true));
    }

    const cursorPresences = deps.getCursorPresences?.();
    if (cursorPresences) {
      for (const [stableId, presence] of cursorPresences) {
        if (!presence.playerIdentity) continue;
        const isMe = stableId === mySelfStableId;
        try {
          usersByStableId.set(
            stableId,
            isMe ? toUser(identity, true) : toUser(presence.playerIdentity, false),
          );
        } catch {
          // Skip cursor presences with an invalid identity (no primary color).
        }
      }
    }

    return Array.from(usersByStableId.values());
  }

  function applyIdentityMutation(mutate: () => void): void {
    mutate();
    savePlayerIdentityToStorage(identity);
    publishIdentity();
    notifySelfChange();
    notifyUsersChange();
  }

  const me: UsersSelfIdentity = {
    get pid() {
      return identity.publicKey;
    },
    get name() {
      return identity.name;
    },
    set name(newName: string | undefined) {
      if (identity.name === newName) return;
      applyIdentityMutation(() => {
        identity.name = newName;
      });
    },
    get color() {
      return getPrimaryColor(identity);
    },
    set color(newColor: string) {
      if (newColor == null || newColor === "") {
        throw new Error(
          "[playhtml] users.me.color cannot be set to empty; player identity must have a primary color.",
        );
      }
      if (identity.playerStyle.colorPalette[0] === newColor) return;
      applyIdentityMutation(() => {
        identity.playerStyle.colorPalette[0] = newColor;
      });
    },
  };

  ensureIdentityWritten();

  return {
    me,
    getAll(): User[] {
      ensureSubscribed();
      return getAll();
    },
    onChange(callback: (users: User[]) => void): () => void {
      ensureSubscribed();
      usersChangeListeners.add(callback);
      callback(getAll());
      return () => {
        usersChangeListeners.delete(callback);
      };
    },
    onSelfChange(callback: (identity: PlayerIdentity) => void): () => void {
      selfChangeListeners.add(callback);
      return () => {
        selfChangeListeners.delete(callback);
      };
    },
    adoptIdentity(newIdentity: PlayerIdentity): void {
      assertValidPlayerIdentity(newIdentity);
      if (identity === newIdentity) return;
      applyIdentityMutation(() => {
        identity = newIdentity;
      });
    },
    getIdentity(): PlayerIdentity {
      return identity;
    },
    destroy(): void {
      selfChangeListeners.clear();
      usersChangeListeners.clear();
      cursorPresencesUnsubscribe?.();
      cursorPresencesUnsubscribe = null;
      currentAwareness = null;
    },
  };
}

/** Default seed identity when no init option / cursors.playerIdentity is provided. */
export function defaultSeedIdentity(): PlayerIdentity {
  return generatePersistentPlayerIdentity();
}

export function selectAllColors(users: User[]): string[] {
  return Array.from(new Set(users.map((user) => user.color)));
}
