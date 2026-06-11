// ABOUTME: Custom React hooks for playhtml functionality
// ABOUTME: Cursor, presence, page-data, and presence-room hooks that safely no-op pre-sync

import { useCallback, useContext, useEffect, useMemo, useRef, useState, RefObject } from "react";
import { PlayContext } from "./PlayProvider";
import playhtml from "./playhtml-singleton";
import {
  CursorPresenceView,
  PageDataChannel,
  PlayerIdentity,
  PresenceRoom,
  PresenceView,
} from "@playhtml/common";
import type { PermissionAction } from "@playhtml/common";
import type { CursorZoneOptions, MeState } from "playhtml";

// Stable protocol event names (duplicated from playhtml so this module only
// has type-level imports from it — keeps vi.mock("playhtml") setups working).
const IDENTITY_CHANGE_EVENT = "playhtml:identitychange";
const PERMISSIONS_CHANGE_EVENT = "playhtml:permissionschange";

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
  ref: RefObject<HTMLElement | null>,
  options?: CursorZoneOptions,
): void {
  const { registerCursorZone, unregisterCursorZone } = useContext(PlayContext);

  useEffect(() => {
    const element = ref.current;
    if (!element || !element.id) return;

    registerCursorZone(element, options);

    return () => {
      unregisterCursorZone(element.id);
    };
  }, [ref.current, ref.current?.id]);
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

/**
 * Read the local player's identity — cursor color, participant id (PID), and
 * name — from the playhtml context. Values update reactively: the cursor
 * client emits a `color` event when identity changes (including when the
 * "we were online" extension injects its identity via the
 * `playhtml:configure-identity` event), which re-renders consumers, at which
 * point the freshly-read `getMyPlayerIdentity()` reflects the new PID.
 *
 * `verified` and `roles` come from playhtml's auth/permissions system and
 * update on the `playhtml:identitychange` / `playhtml:permissionschange`
 * events (key handshake completion, extension identity injection, server
 * permissions arriving).
 *
 * `pid` is undefined until cursors have synced. Requires a `PlayProvider`
 * with `cursors: { enabled: true }`.
 */
export function usePlayerIdentity(): {
  color: string;
  pid: string | undefined;
  name: string | undefined;
  verified: boolean;
  roles: string[];
  /** Server-attested distinct days seen in this room (earned roles). */
  visitDays: number | undefined;
} {
  const { cursors, getMyPlayerIdentity } = useContext(PlayContext);
  const me = useMeState();
  return {
    color: cursors.color,
    pid: getMyPlayerIdentity()?.publicKey ?? me?.pid,
    name: cursors.name,
    verified: me?.verified ?? false,
    roles: me?.roles ?? [],
    visitDays: me?.visitDays,
  };
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
  target: string | HTMLElement | RefObject<HTMLElement | null>,
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
