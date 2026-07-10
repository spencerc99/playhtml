// ABOUTME: Role-aware event source for installation windows — the master fetches
// ABOUTME: and relays events via IndexedDB; followers read them and never fetch.
import { useCallback, useEffect, useRef, useState } from "react";
import { CollectionEvent } from "../types";
import { parseInstallationRoleFromUrl, parseTimeOfDayFromUrl } from "../config";
import { useArchiveEvents } from "./useArchiveEvents";
import { readEvents, writeEvents } from "../utils/installationEventStore";

type TimeOfDay = ReturnType<typeof parseTimeOfDayFromUrl> | null;

/** Same-origin channel for the tiny `events-ready` nudge. NEVER carries events —
 * the payload lives in IndexedDB; this only tells followers to (re-)read. */
const CHANNEL_NAME = "wewe-installation-data";

interface EventsReadyMessage {
  type: "events-ready";
  version: number;
}

export interface InstallationEventsState {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  /** Force a full refetch (master/standalone). No-op for a pure follower, which
   * never fetches — it re-reads only when the master pings. */
  refresh: () => void;
}

export interface UseInstallationEventsParams {
  selectedDay: string | null;
  timeOfDay: TimeOfDay;
  serverDomain: string;
  activeVisualizations: string[];
}

/** Role-aware event source, keyed off `?role=`:
 *
 * - `master`: fetches via useArchiveEvents; whenever the events change and are
 *   non-empty, writes them to IndexedDB and broadcasts `events-ready`. Returns
 *   the archive events directly.
 * - `follower`: does NOT fetch. Reads events from IndexedDB on mount and on each
 *   `events-ready` ping. Waits (loading) until the first write exists. Falls
 *   back to fetching itself only if IndexedDB is unavailable.
 * - `null` (standalone archive/portrait): passes straight through to
 *   useArchiveEvents — unchanged fetch behavior.
 *
 * Role is read once (via a ref) so it never changes across the window's life. */
export function useInstallationEvents(
  params: UseInstallationEventsParams,
): InstallationEventsState {
  const roleRef = useRef<"master" | "follower" | null>(
    parseInstallationRoleFromUrl(),
  );
  const role = roleRef.current;

  // A follower with a working IndexedDB never fetches, so useArchiveEvents must
  // be inert for it. Passing no active visualizations makes it fetch nothing
  // (deriveRequiredEventTypes is empty → it bails before any request). The
  // master and standalone (null) pass the real params. If a follower's
  // IndexedDB is unavailable it flips this ref and re-runs with real params so
  // it can fall back to fetching.
  const [followerMustFetch, setFollowerMustFetch] = useState(false);
  const useLiveFetch = role !== "follower" || followerMustFetch;

  const archive = useArchiveEvents({
    selectedDay: params.selectedDay,
    timeOfDay: params.timeOfDay,
    serverDomain: params.serverDomain,
    activeVisualizations: useLiveFetch ? params.activeVisualizations : [],
  });

  // ---- Master: relay fetched events to followers via IndexedDB + ping. ----
  useEffect(() => {
    if (role !== "master") return;
    if (archive.events.length === 0) return;

    let cancelled = false;
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;

    writeEvents(archive.events)
      .then((): Promise<void> => {
        if (cancelled) return Promise.resolve();
        // Read back the version we just wrote so the ping carries it.
        return readEvents().then((stored) => {
          if (cancelled || !channel) return;
          const message: EventsReadyMessage = {
            type: "events-ready",
            version: stored?.version ?? 0,
          };
          channel.postMessage(message);
        });
      })
      .catch((err) => {
        console.warn("Failed to relay installation events:", err);
      })
      .finally(() => {
        channel?.close();
      });

    return () => {
      cancelled = true;
    };
  }, [role, archive.events]);

  // ---- Follower: read from IndexedDB on mount + on each ping. ----
  const [followerEvents, setFollowerEvents] = useState<CollectionEvent[]>([]);
  const [followerLoading, setFollowerLoading] = useState(true);

  useEffect(() => {
    if (role !== "follower") return;

    let cancelled = false;
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;

    const load = () => {
      readEvents()
        .then((stored) => {
          if (cancelled) return;
          if (stored) {
            setFollowerEvents(stored.events);
            setFollowerLoading(false);
          }
          // No stored events yet: stay loading and wait for a ping.
        })
        .catch((err) => {
          // IndexedDB unavailable (e.g. private mode): fall back to fetching.
          if (cancelled) return;
          console.warn(
            "Installation follower cannot read IndexedDB, fetching directly:",
            err,
          );
          setFollowerMustFetch(true);
        });
    };

    if (channel) {
      channel.onmessage = (event: MessageEvent<EventsReadyMessage>) => {
        if (event.data?.type === "events-ready") load();
      };
    }
    load();

    return () => {
      cancelled = true;
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    };
  }, [role]);

  const refresh = useCallback(() => {
    archive.refresh();
  }, [archive]);

  // Follower falling back to a direct fetch surfaces archive's state.
  if (role === "follower" && !followerMustFetch) {
    return {
      events: followerEvents,
      loading: followerLoading,
      error: null,
      refresh,
    };
  }

  return {
    events: archive.events,
    loading: archive.loading,
    error: archive.error,
    refresh,
  };
}
