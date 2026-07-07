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
import type { CursorZoneOptions } from "playhtml";

function warnPreInit(call: string): void {
  console.warn(`[@playhtml/react] ${call} called before init — ignored.`);
}

/**
 * Hook to access cursor presences from the playhtml context
 * Returns a Map of stable ID -> CursorPresenceView
 */
export function useCursorPresences(): Map<string, CursorPresenceView> {
  const { cursorPresences } = useContext(PlayContext);
  return cursorPresences;
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
 * Type parameter `T` is an assertion about the shape of presence values; no
 * runtime validation is performed.
 */
export function usePresence<T extends Record<string, unknown> = Record<string, unknown>>(
  channel: string,
): {
  presences: Map<string, PresenceView<T>>;
  setMyPresence: (data: T) => void;
  myIdentity: PlayerIdentity | null;
} {
  const { isLoading } = useContext(PlayContext);
  const [presences, setPresences] = useState<Map<string, PresenceView<T>>>(() => new Map());

  useEffect(() => {
    if (isLoading) return;
    setPresences(playhtml.presence.getPresences() as Map<string, PresenceView<T>>);
    const unsub = playhtml.presence.onPresenceChange(channel, (next) => {
      setPresences(new Map(next) as Map<string, PresenceView<T>>);
    });
    return unsub;
  }, [isLoading, channel]);

  const setMyPresence = useCallback(
    (data: T) => {
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
  const [data, setDataState] = useState<T>(defaultValue);
  const channelRef = useRef<PageDataChannel<T> | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const channel = playhtml.createPageData<T>(name, defaultValue);
    channelRef.current = channel;
    setDataState(channel.getData());
    const unsub = channel.onUpdate((next) => setDataState(next));
    return () => {
      unsub();
      channel.destroy();
      channelRef.current = null;
    };
    // defaultValue intentionally excluded — it only seeds the initial state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, name]);

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
  const [room, setRoom] = useState<PresenceRoom | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const r = playhtml.createPresenceRoom(name);
    setRoom(r);
    return () => {
      r.destroy();
      setRoom(null);
    };
  }, [isLoading, name]);

  return room;
}

const EMPTY_PLAYER_IDENTITY = {
  color: "",
  pid: undefined as string | undefined,
  name: undefined as string | undefined,
  custom: {} as Record<string, unknown>,
};

/**
 * Read the local player's identity — color, participant id (PID), name, and
 * custom properties — from `playhtml.users`. Values update reactively:
 * `playhtml.users` notifies on any self identity change, including when the
 * "we were online" extension injects its identity via the
 * `playhtml:configure-identity` event.
 *
 * Backed by the users module, so it works without `cursors: { enabled: true }`.
 * Returns empty/undefined values until playhtml has synced.
 */
export function usePlayerIdentity(): {
  color: string;
  pid: string | undefined;
  name: string | undefined;
  custom: Record<string, unknown>;
} {
  const { isLoading } = useContext(PlayContext);
  const [identity, setIdentity] = useState(EMPTY_PLAYER_IDENTITY);

  useEffect(() => {
    if (isLoading) {
      setIdentity(EMPTY_PLAYER_IDENTITY);
      return;
    }
    const readIdentity = () => {
      const me = playhtml.users.me;
      setIdentity({ color: me.color, pid: me.pid, name: me.name, custom: me.custom });
    };
    readIdentity();
    return playhtml.users.onChange(readIdentity);
  }, [isLoading]);

  return identity;
}

/**
 * Subscribe to all known users — the union of main-room awareness identities
 * and (when cursors are enabled) cursor-room identities, keyed by pid. Self is
 * always present. Returns an empty map until playhtml has synced.
 */
export function useUsers(): Map<string, User> {
  const { isLoading } = useContext(PlayContext);
  const [users, setUsers] = useState<Map<string, User>>(() => new Map());

  useEffect(() => {
    if (isLoading) return;
    return playhtml.users.onChange((next) => setUsers(new Map(next)));
  }, [isLoading]);

  return users;
}
