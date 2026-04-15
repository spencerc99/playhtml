// ABOUTME: Custom React hooks for playhtml functionality
// ABOUTME: Cursor, presence, page-data, and presence-room hooks that safely no-op pre-sync

import { useCallback, useContext, useEffect, useRef, useState, RefObject } from "react";
import { PlayContext } from "./PlayProvider";
import playhtml from "./playhtml-singleton";
import {
  CursorPresenceView,
  PageDataChannel,
  PlayerIdentity,
  PresenceRoom,
  PresenceView,
} from "@playhtml/common";
import type { CursorZoneOptions } from "playhtml";

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
 * returns an empty map and a no-op setter until sync completes, then wires up.
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
        console.warn(
          `[@playhtml/react] usePresence("${channel}").setMyPresence called before init — ignored.`,
        );
        return;
      }
      playhtml.presence.setMyPresence(channel, data);
    },
    [isLoading, channel],
  );

  const myIdentity = isLoading ? null : playhtml.presence.getMyIdentity();

  return { presences, setMyPresence, myIdentity };
}

/**
 * Subscribe to a page-data channel. Safe to call before playhtml has initialized:
 * returns the default value and a no-op setter until sync completes, then wires up.
 *
 * Shape mirrors `useState` — `[data, setData]`.
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
      if (!channel) {
        console.warn(
          `[@playhtml/react] usePageData("${name}") setData called before init — ignored.`,
        );
        return;
      }
      channel.setData(next);
    },
    [name],
  );

  return [data, setData];
}

/**
 * Join a presence room. Safe to call before playhtml has initialized:
 * returns `null` until sync completes.
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
