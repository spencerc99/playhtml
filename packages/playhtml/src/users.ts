// ABOUTME: Owns durable user identity (name/color) independent of cursors.
// ABOUTME: Persists to localStorage, discovers peers through presence transport, and notifies subscribers.

import {
  generatePersistentPlayerIdentity,
  savePlayerIdentityToStorage,
  User,
  type CursorPresenceView,
  type PlayerIdentity,
} from "@playhtml/common";
import type { PeerChannels } from "./peer-store";

interface UsersDeps {
  getIdentityPeers: () => Map<string, PeerChannels>;
  onIdentityPeersChange: (callback: () => void) => () => void;
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
 * object and owning localStorage persistence. Remote identities come from the
 * page-room presence transport; cursor snapshots are merged in so domain and
 * custom cursor rooms keep contributing their correctly scoped participants.
 */
export function createUsersAPI(
  seedIdentity: PlayerIdentity,
  deps: UsersDeps,
): UsersAPI {
  let identity = seedIdentity;
  assertValidPlayerIdentity(identity);
  const selfChangeListeners = new Set<(identity: PlayerIdentity) => void>();
  const usersChangeListeners = new Set<(users: User[]) => void>();
  let identityPeersUnsubscribe: (() => void) | null = null;
  let cursorPresencesUnsubscribe: (() => void) | null = null;
  let notifiedUsers: User[] | null = null;

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

  function usersEqual(a: User[], b: User[]): boolean {
    return (
      a.length === b.length &&
      a.every(
        (user, index) =>
          user.pid === b[index].pid &&
          user.name === b[index].name &&
          user.color === b[index].color &&
          user.isMe === b[index].isMe,
      )
    );
  }

  function notifyUsersChange(force = false): void {
    if (usersChangeListeners.size === 0) return;
    const users = getAll();
    if (!force && notifiedUsers && usersEqual(notifiedUsers, users)) return;
    notifiedUsers = users;
    notifySubscribers(usersChangeListeners, users, "users change");
  }

  function ensureSubscribed(): void {
    identityPeersUnsubscribe ??= deps.onIdentityPeersChange(notifyUsersChange);
    if (!cursorPresencesUnsubscribe && deps.onCursorPresencesChange) {
      const unsubscribe = deps.onCursorPresencesChange(() => {
        notifyUsersChange();
      });
      if (unsubscribe) {
        cursorPresencesUnsubscribe = unsubscribe;
      }
    }
  }

  function getAll(): User[] {
    const usersByStableId = new Map<string, User>();
    const mySelfStableId = identity.publicKey;

    const peers = deps.getIdentityPeers();
    for (const connectionId of Array.from(peers.keys()).sort()) {
      const channels = peers.get(connectionId)!;
      const remoteIdentity = channels.identity as PlayerIdentity | undefined;
      if (!remoteIdentity || remoteIdentity.publicKey === mySelfStableId) {
        continue;
      }
      try {
        usersByStableId.set(
          remoteIdentity.publicKey,
          toUser(remoteIdentity, false),
        );
      } catch {
        // Skip malformed remote identities rather than surfacing invalid users.
      }
    }

    // Self is always present, even before the transport has connected.
    usersByStableId.set(mySelfStableId, toUser(identity, true));

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
    notifySelfChange();
    notifyUsersChange(true);
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

  return {
    me,
    getAll(): User[] {
      ensureSubscribed();
      return getAll();
    },
    onChange(callback: (users: User[]) => void): () => void {
      ensureSubscribed();
      notifyUsersChange();
      usersChangeListeners.add(callback);
      const users = getAll();
      notifiedUsers = users;
      callback(users);
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
      identityPeersUnsubscribe?.();
      identityPeersUnsubscribe = null;
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
