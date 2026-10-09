// ABOUTME: "Join the walk": people opt in, and their pages draw as trails behind the walk stage.
// ABOUTME: Trails reuse the portrait's live cursor-trail drawing, with URL stops as the path.
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePageData, usePlayerIdentity } from "@playhtml/react";
import { LiveTrails } from "@movement/components/LiveTrails";
import { DEFAULT_SETTINGS } from "@movement/components/settingsDefaults";
import { useLiveEvents } from "@movement/hooks/useLiveEvents";
import { RECENT_EVENTS_URL } from "@movement/config";
import type { CollectionEvent } from "@movement/types";
import { useStickyState } from "../../../hooks/useStickyState";
import {
  freezeSteps,
  stepsByWalker,
  stopPoint,
  walkerTrailState,
  walkSteps,
  type WalkersData,
  type WalkStep,
} from "./walkTrails";
import { extensionStatus, onExtensionDetected } from "./extensionSignal";
import { isAdmin } from "../admin";
import "./walk.scss";

const WALKERS_DATA_NAME = "walking-together-walkers";
const EMPTY_WALKERS: WalkersData = { walkers: {} };
/** How often to re-read each walker's pages from storage, in case the live
 * stream dropped some while this tab was asleep. */
const BACKFILL_MS = 60_000;

const TRAIL_SETTINGS = {
  ...DEFAULT_SETTINGS,
  strokeWidth: 3,
  trailOpacity: 0.8,
  clickMaxRadius: 36,
};

function isEventPage(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.host === window.location.host &&
      url.pathname.startsWith("/events/walking-together")
    );
  } catch {
    return false;
  }
}

function useViewportSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const read = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

/** Each walker's stored pages since they joined, refreshed now and then.
 * Pass no walkers to skip fetching (an ended walk draws from its snapshot). */
function useBackfill(walkerKey: string, walkers: WalkersData["walkers"]) {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  useEffect(() => {
    const list = Object.values(walkers);
    if (list.length === 0) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const batches = await Promise.all(
        list.map((w) => {
          const params = new URLSearchParams({
            pid: w.pid,
            type: "navigation",
            from: new Date(w.joinedAt).toISOString(),
            limit: "500",
          });
          return fetch(`${RECENT_EVENTS_URL}?${params}`)
            .then((r) => (r.ok ? (r.json() as Promise<CollectionEvent[]>) : []))
            .catch(() => [] as CollectionEvent[]);
        }),
      );
      if (!cancelled) setEvents(batches.flat());
    };
    void load();
    const timer = window.setInterval(load, BACKFILL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // walkerKey captures who joined and when; the object itself changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkerKey]);
  return events;
}

export function WalkStage({ active }: { active: boolean }) {
  const [data, setData] = usePageData<WalkersData>(
    WALKERS_DATA_NAME,
    EMPTY_WALKERS,
  );
  const walkers = data?.walkers ?? {};
  const ended = data?.endedAt !== undefined;
  const { pid, name, color } = usePlayerIdentity();
  const extension = useSyncExternalStore(onExtensionDetected, extensionStatus);
  const [watching, setWatching] = useStickyState<boolean>(
    "walk-just-watching",
    false,
  );
  const size = useViewportSize();

  const walkerKey = Object.values(walkers)
    .map((w) => `${w.pid}:${w.joinedAt}`)
    .sort()
    .join(",");
  const backfill = useBackfill(ended ? "" : walkerKey, ended ? {} : walkers);
  const { events: live } = useLiveEvents({
    types: ["navigation"],
    maxEvents: 2000,
  });

  const liveSteps = useMemo(
    () => stepsByWalker([...backfill, ...live], walkers, isEventPage),
    // walkerKey stands in for walkers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backfill, live, walkerKey],
  );
  const liveStepsRef = useRef(liveSteps);
  liveStepsRef.current = liveSteps;
  const steps = walkSteps(data ?? EMPTY_WALKERS, liveSteps);

  const trailStates = useMemo(
    () =>
      Object.values(walkers).flatMap((w) => {
        const state = walkerTrailState(w, steps[w.pid] ?? [], size);
        return state ? [state] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, walkerKey, size.width, size.height],
  );

  const joined = !!pid && !!walkers[pid];
  const walkingCount = Object.keys(walkers).length;

  // One label per stop, even when several walkers passed it.
  const stops = new Map<string, WalkStep>();
  for (const list of Object.values(steps)) {
    for (const step of list) stops.set(step.url, step);
  }

  const join = () => {
    if (!pid || ended) return;
    setData((draft) => {
      const me = {
        pid,
        name: name || "someone",
        color: color || "#888888",
        joinedAt: Date.now(),
      };
      // A room from before this channel had a value has no map to key into.
      if (!draft.walkers) {
        draft.walkers = { [pid]: me };
        return;
      }
      draft.walkers[pid] = me;
    });
  };

  const admin = isAdmin(name, color);

  /** Admin only: freeze every trail as it is now. Pages visited afterward
   * never join the walk, and nobody new can join. */
  const endWalk = () => {
    if (!window.confirm("End the walk? Trails stay as they are now.")) return;
    setData((draft) => {
      draft.endedAt = Date.now();
      // Freeze what this screen shows now, so every viewer keeps the same
      // trails no matter what their (or the walkers') clocks say.
      draft.frozen = freezeSteps(liveStepsRef.current);
    });
  };

  const reopenWalk = () => {
    setData((draft) => {
      delete draft.endedAt;
      delete draft.frozen;
    });
  };

  /** Admin only: everyone off the walk and the walk reopened, for testing. */
  const resetWalk = () => {
    if (!window.confirm("Reset the walk? This clears everyone's trails.")) return;
    setData((draft) => {
      for (const key of Object.keys(draft.walkers ?? {}))
        delete draft.walkers[key];
      delete draft.endedAt;
      delete draft.frozen;
    });
  };

  const leave = () => {
    if (!pid) return;
    setData((draft) => {
      if (draft.walkers?.[pid]) delete draft.walkers[pid];
    });
  };

  if (!active) return null;

  return (
    <>
      <div className="walk-layer" aria-hidden="true">
        <LiveTrails
          trailStates={trailStates}
          settings={TRAIL_SETTINGS}
          showClickRipples
          // A walker who lingers on one page still walked here; keep their
          // trail until they leave the walk.
          keepSettled
        />
        {size.width > 0 &&
          Array.from(stops.values()).map((step) => {
            const p = stopPoint(step.url);
            return (
              <span
                key={step.url}
                className="walk-stop"
                style={{ left: p.x * size.width, top: p.y * size.height }}
              >
                {step.label}
              </span>
            );
          })}
        {Object.values(walkers).map((w) => {
          const last = steps[w.pid]?.at(-1);
          if (!last) return null;
          const p = stopPoint(last.url);
          return (
            <span
              key={w.pid}
              className="walk-head"
              style={{
                left: p.x * size.width,
                top: p.y * size.height,
                background: w.color,
              }}
            >
              <b>{w.name}</b> {last.label}
            </span>
          );
        })}
      </div>

      <div className="walk-status">
        {walkingCount > 0 && (
          <span className="walk-pill">
            {walkingCount} {ended ? "walked" : "walking"}
          </span>
        )}
        {ended && <span className="walk-pill">the walk has ended</span>}
        {admin &&
          (ended ? (
            <button
              className="walk-pill walk-pill--button"
              data-admin-control
              onClick={reopenWalk}
            >
              reopen walk
            </button>
          ) : (
            walkingCount > 0 && (
              <button
                className="walk-pill walk-pill--button"
                data-admin-control
                onClick={endWalk}
              >
                end walk
              </button>
            )
          ))}
        {admin && (walkingCount > 0 || ended) && (
          <button
            className="walk-pill walk-pill--button"
            data-admin-control
            onClick={resetWalk}
          >
            reset walk
          </button>
        )}
        {ended ? null : joined ? (
          <button className="walk-pill walk-pill--button" onClick={leave}>
            leave the walk
          </button>
        ) : (
          watching && (
            <button
              className="walk-pill walk-pill--button walk-pill--dark"
              onClick={() => setWatching(false)}
            >
              join the walk
            </button>
          )
        )}
      </div>

      {!joined && !watching && !ended && (
        <div className="walk-join" role="dialog" aria-labelledby="walk-join-title">
          <h2 id="walk-join-title">join the walk</h2>
          <p>
            Your cursor is already here. Join, and every page you visit draws
            your trail onto this page for everyone else to watch.
          </p>
          <ul>
            <li>shows the site and path you're on, like html.energy/zines</li>
            <li>never page contents, never what you type</li>
            <li>leave the walk anytime from this page</li>
          </ul>
          <div className="walk-join__actions">
            {extension === "ready" ? (
              <button className="walk-join__primary" onClick={join}>
                join the walk
              </button>
            ) : extension === "checking" ? (
              <button className="walk-join__primary" disabled>
                looking for we were online…
              </button>
            ) : (
              <a
                className="walk-join__primary"
                href="https://wewere.online"
                target="_blank"
                rel="noreferrer"
              >
                {extension === "update"
                  ? "update we were online to join"
                  : "get we were online to join"}
              </a>
            )}
            <button onClick={() => setWatching(true)}>just watch</button>
          </div>
        </div>
      )}
    </>
  );
}
