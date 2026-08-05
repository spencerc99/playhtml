// ABOUTME: Custom React hooks for playhtml functionality
// ABOUTME: Cursor, presence, page-data, and presence-room hooks that safely no-op pre-sync

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { PlayContext } from "./PlayProvider";
import playhtml from "./playhtml-singleton";
import {
  CursorPresenceView,
  PageDataChannel,
  PlayerIdentity,
  PresenceRoom,
  PresenceView,
  User,
} from "playhtml";
import type { CursorZoneOptions, MeState, PermissionAction } from "playhtml";

// Stable protocol event names (duplicated from playhtml so this module only
// has type-level imports from it — keeps vi.mock("playhtml") setups working).
const IDENTITY_CHANGE_EVENT = "playhtml:identitychange";
const PERMISSIONS_CHANGE_EVENT = "playhtml:permissionschange";

type SelectedPresenceView<
  Channel extends string,
  Payload extends Record<string, unknown>,
> = PresenceView<Partial<Record<Channel, Payload>>>;
type SelectedPresences<
  Channel extends string,
  Payload extends Record<string, unknown>,
> = Map<string, SelectedPresenceView<Channel, Payload>>;

function warnPreInit(call: string): void {
  console.warn(`[@playhtml/react] ${call} called before init — ignored.`);
}

function usePlayhtmlSubscription<T>(
  isLoading: boolean,
  initialValue: () => T,
  subscribe: (setValue: (value: T) => void) => void | (() => void),
  dependencies: React.DependencyList,
): T {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    setValue(initialValue());
    if (isLoading) return;
    return subscribe(setValue);
  }, [isLoading, ...dependencies]);

  return value;
}

/**
 * Hook to access cursor presences from the playhtml context
 * Returns a Map of stable ID -> CursorPresenceView
 */
export function useCursorPresences(): Map<string, CursorPresenceView> {
  const { isLoading } = useContext(PlayContext);
  return usePlayhtmlSubscription(
    isLoading,
    () => new Map(),
    (setPresences) => {
      const client = playhtml.cursorClient;
      if (!client) return;
      setPresences(client.getCursorPresences());
      return client.onCursorPresencesChange((next) => setPresences(new Map(next)));
    },
    [],
  );
}

/**
 * Register an element as a cursor zone. When the local user's cursor enters
 * this element, other clients see the cursor positioned relative to their
 * own copy of the same element (matched by element id).
 */
export function useCursorZone(
  ref: React.RefObject<HTMLElement | null>,
  options?: CursorZoneOptions,
): void {
  const { registerCursorZone, unregisterCursorZone } = useContext(PlayContext);

  useEffect(() => {
    const element = ref.current;
    if (!element || !element.id) return;
    const elementId = element.id;

    registerCursorZone(element, options);

    return () => {
      unregisterCursorZone(elementId);
    };
  }, [ref, options, registerCursorZone, unregisterCursorZone]);
}

/**
 * Subscribe to a presence channel. Safe to call before playhtml has initialized:
 * returns an empty map, a setter that warns and no-ops, and `null` identity
 * until sync completes — then wires up automatically.
 *
 * Type parameters describe the selected channel and its payload. No runtime
 * validation is performed.
 */
export function usePresence<
  Channel extends string,
  Payload extends Record<string, unknown> = Record<string, unknown>,
>(
  channel: Channel,
): {
  presences: SelectedPresences<Channel, Payload>;
  setMyPresence: (data: Payload) => void;
  myIdentity: PlayerIdentity | null;
} {
  const { isLoading } = useContext(PlayContext);
  const presences = usePlayhtmlSubscription(
    isLoading,
    () => new Map() as SelectedPresences<Channel, Payload>,
    (setPresences) => {
      setPresences(
        playhtml.presence.getPresences() as SelectedPresences<Channel, Payload>,
      );
      return playhtml.presence.onPresenceChange(channel, (next) => {
        setPresences(new Map(next) as SelectedPresences<Channel, Payload>);
      });
    },
    [channel],
  );

  const setMyPresence = useCallback(
    (data: Payload) => {
      if (isLoading) {
        warnPreInit(`usePresence("${channel}").setMyPresence`);
        return;
      }
      playhtml.presence.setMyPresence(channel, data);
    },
    [isLoading, channel],
  );

  const myIdentity = useMemo(
    () => (isLoading ? null : playhtml.presence.getMyIdentity()),
    [isLoading],
  );

  return { presences, setMyPresence, myIdentity };
}

/**
 * Subscribe to a page-data channel. Safe to call before playhtml has initialized:
 * returns the default value and a setter that warns and no-ops until sync
 * completes — then wires up automatically.
 *
 * Shape mirrors `useState` — `[data, setData]`.
 *
 * `defaultValue` is only read on first mount and when `name` changes.
 */
export function usePageData<T>(
  name: string,
  defaultValue: T,
): [T, (data: T | ((draft: T) => void)) => void] {
  const { isLoading } = useContext(PlayContext);
  const channelRef = useRef<PageDataChannel<T> | null>(null);
  const data = usePlayhtmlSubscription(
    isLoading,
    () => defaultValue,
    (setDataState) => {
      const channel = playhtml.createPageData<T>(name, defaultValue);
      channelRef.current = channel;
      setDataState(channel.getData());
      const unsubscribe = channel.onUpdate(setDataState);
      return () => {
        unsubscribe();
        channel.destroy();
        channelRef.current = null;
      };
    },
    [name],
  );

  const setData = useCallback(
    (next: T | ((draft: T) => void)) => {
      const channel = channelRef.current;
      if (isLoading || !channel) {
        warnPreInit(`usePageData("${name}").setData`);
        return;
      }
      channel.setData(next);
    },
    [isLoading, name],
  );

  return [data, setData];
}

/**
 * Join a presence room. Safe to call before playhtml has initialized:
 * returns `null` until sync completes. When `name` changes, briefly returns
 * `null` during the transition between rooms.
 */
export function usePresenceRoom(name: string): PresenceRoom | null {
  const { isLoading } = useContext(PlayContext);
  return usePlayhtmlSubscription<PresenceRoom | null>(
    isLoading,
    () => null,
    (setRoom) => {
      const room = playhtml.createPresenceRoom(name);
      setRoom(room);
      return () => room.destroy();
    },
    [name],
  );
}

const EMPTY_PLAYER_IDENTITY = {
  color: "",
  pid: undefined as string | undefined,
  name: undefined as string | undefined,
};

/**
 * Read the local player's identity — color, participant id (PID), and name —
 * from `playhtml.users`. Values update reactively:
 * `playhtml.users` notifies on any self identity change, including when the
 * "we were online" extension injects its identity via the
 * `playhtml:configure-identity` event.
 *
 * `verified` and `roles` come from playhtml's auth/permissions system and
 * update on the `playhtml:identitychange` / `playhtml:permissionschange`
 * events (key handshake completion, extension identity injection, server
 * permissions arriving).
 *
 * Backed by the users module, so it works without `cursors: { enabled: true }`.
 * Returns empty/undefined values until playhtml has synced.
 */
export function usePlayerIdentity(): {
  color: string;
  pid: string | undefined;
  name: string | undefined;
  verified: boolean;
  roles: string[];
} {
  const { isLoading } = useContext(PlayContext);
  const [identity, setIdentity] = useState(EMPTY_PLAYER_IDENTITY);
  const me = useMeState();

  useEffect(() => {
    if (isLoading) {
      setIdentity(EMPTY_PLAYER_IDENTITY);
      return;
    }
    const readIdentity = () => {
      const me = playhtml.users.me;
      setIdentity({ color: me.color, pid: me.pid, name: me.name });
    };
    readIdentity();
    return playhtml.users.onChange(readIdentity);
  }, [isLoading]);

  return {
    ...identity,
    pid: identity.pid ?? me?.pid,
    verified: me?.verified ?? false,
    roles: me?.roles ?? [],
  };
}

/**
 * Subscribe to all known users — the union of main-room awareness identities
 * and (when cursors are enabled) cursor-room identities. Self is always
 * present. Returns an empty array until playhtml has synced.
 */
export function useUsers(): User[] {
  const { isLoading } = useContext(PlayContext);
  return usePlayhtmlSubscription<User[]>(
    isLoading,
    () => [],
    (setUsers) => playhtml.users.onChange(setUsers),
    [],
  );
}

/** Subscribes to playhtml.me across identity/permissions change events. */
function useMeState(): MeState | null {
  const [me, setMe] = useState<MeState | null>(() => readMe());

  useEffect(() => {
    const update = () => setMe(readMe());
    update();
    document.addEventListener(IDENTITY_CHANGE_EVENT, update);
    document.addEventListener(PERMISSIONS_CHANGE_EVENT, update);
    return () => {
      document.removeEventListener(IDENTITY_CHANGE_EVENT, update);
      document.removeEventListener(PERMISSIONS_CHANGE_EVENT, update);
    };
  }, []);

  return me;
}

function readMe(): MeState | null {
  try {
    return playhtml.me ?? null;
  } catch {
    return null;
  }
}

/**
 * Synchronous permission check that re-evaluates when identity, verification,
 * or server permissions change. Pass an element id ("#guestbook"), an
 * element, or a ref; for creator-scoped collection entries, pass the entry
 * itself (`{ entry }` — its `createdBy` is read) or its creator pid.
 *
 * This is UX gating (show/hide affordances) — the server independently
 * enforces rules published in the domain's `/.well-known/playhtml.json`.
 */
export function useCan(
  action: PermissionAction,
  target: string | HTMLElement | React.RefObject<HTMLElement | null>,
  options?: { creator?: string; entry?: unknown },
): boolean {
  const me = useMeState();
  const creator = options?.creator;
  const entry = options?.entry;
  return useMemo(() => {
    const resolved =
      typeof target === "string" || target instanceof HTMLElement
        ? target
        : target.current;
    if (!resolved) return true; // ref not mounted yet — default to ungated
    try {
      return playhtml.can(action, resolved, { creator, entry });
    } catch {
      return true;
    }
    // me is the reactive dependency: it changes whenever permission inputs do.
  }, [action, target, creator, entry, me]);
}
