// ABOUTME: Full-tab Internet Commute with shared ephemeral cursor seating.
// ABOUTME: Cycles through recent WWO destinations in a bird's-eye train carriage.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PlayProvider,
  useCursorZone,
  usePlayContext,
  withSharedState,
} from "@playhtml/react";
import { useLiveEvents } from "@movement/hooks/useLiveEvents";
import { RECENT_EVENTS_URL } from "@movement/config";
import { summarizeActiveLocations } from "@movement/utils/eventUtils";
import {
  curateCommuteStops,
  formatStopAge,
  getFaviconUrl,
  getStopDisplayDetail,
  getStopDisplayName,
  parseRecentCommuteStops,
  SAMPLE_STOPS,
  type CommuteStop,
} from "./commuteStops";
import {
  getCommuteTiming,
  type CommutePhase,
} from "./commuteTiming";
import { ProceduralLandscape } from "./landscape";
import "./commute.scss";

type CarData = Record<string, never>;

interface RiderAwareness {
  seatId: number | null;
  color: string;
  label: string;
}

interface SeatDefinition {
  id: number;
  x: number;
  y: number;
  row: "top" | "bottom";
  bank: number;
}

interface CommuteCarProps {
  id: string;
  currentStop: CommuteStop;
  phase: CommutePhase;
  atOrigin: boolean;
  onRiderStateChange: (state: { count: number; hasSeat: boolean }) => void;
}

interface RecentRoute {
  stops: CommuteStop[];
  sceneryStops: CommuteStop[];
  status: "loading" | "live" | "empty" | "error";
}

const SEAT_BANKS = [
  [44, 100, 156, 212],
  [420, 476, 532, 588, 644],
  [840, 896, 952, 1008],
];

const SEATS: SeatDefinition[] = ["top", "bottom"].flatMap((row) =>
  SEAT_BANKS.flatMap((bank, bankIndex) =>
    bank.map((x) => ({
      id:
        (row === "top" ? 0 : SEAT_BANKS.flat().length) +
        SEAT_BANKS.slice(0, bankIndex).flat().length +
        bank.indexOf(x),
      x,
      y: row === "top" ? 32 : 284,
      row: row as SeatDefinition["row"],
      bank: bankIndex,
    })),
  ),
);

const DOORS = [276, 696];

function useRecentRoute(): RecentRoute {
  const [route, setRoute] = useState<RecentRoute>({
    stops: [],
    sceneryStops: [],
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      type: "navigation",
      limit: "80",
      require_title: "true",
    });

    const load = async () => {
      try {
        const response = await fetch(`${RECENT_EVENTS_URL}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Recent navigation request failed: ${response.status}`);
        }

        const sceneryStops = parseRecentCommuteStops(
          await response.json(),
          40,
        );
        const stops = curateCommuteStops(sceneryStops, 10);
        setRoute({
          stops,
          sceneryStops,
          status: stops.length > 0 ? "live" : "empty",
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[internet commute] recent route unavailable:", error);
        setRoute({ stops: [], sceneryStops: [], status: "error" });
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  return route;
}

function StopFavicon({
  stop,
  className = "",
}: {
  stop: CommuteStop;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [stop.url]);

  return (
    <span className={`stop-favicon ${className}`}>
      {!missing && (
        <img
          src={getFaviconUrl(stop)}
          alt=""
          onError={() => setMissing(true)}
        />
      )}
      {missing && <span aria-hidden>{stop.domain.slice(0, 1)}</span>}
    </span>
  );
}

function CursorRider({
  color,
  label,
  isYou,
}: {
  color: string;
  label: string;
  isYou: boolean;
}) {
  return (
    <span
      className={`cursor-rider ${isYou ? "cursor-rider--you" : ""}`}
      style={{ "--cursor-color": color } as React.CSSProperties}
      aria-label={isYou ? "Your cursor is sitting here" : `${label}'s cursor`}
    >
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <path
          d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z"
          fill="var(--cursor-color)"
        />
        <path
          d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z"
          fill="var(--cursor-color)"
        />
      </svg>
      <span>{isYou ? "you" : label}</span>
    </span>
  );
}

function Seat({
  seat,
  occupant,
  isMine,
  onSelect,
}: {
  seat: SeatDefinition;
  occupant?: { color: string; label: string };
  isMine: boolean;
  onSelect: () => void;
}) {
  const unavailable = Boolean(occupant && !isMine);
  const isPriority =
    (seat.bank === 0 && seat.x === 44) ||
    (seat.bank === 2 && seat.x === 1008);
  const fabric = isPriority ? "plum" : seat.bank === 1 ? "gold" : "teal";

  return (
    <button
      className={`train-seat train-seat--${seat.row} train-seat--${fabric} ${
        isMine ? "train-seat--mine" : ""
      }`}
      style={{ left: seat.x, top: seat.y }}
      type="button"
      data-seat-id={seat.id}
      aria-label={
        isMine
          ? "Stand up"
          : unavailable
            ? `Seat occupied by ${occupant?.label ?? "another rider"}`
            : "Sit here"
      }
      aria-pressed={isMine}
      disabled={unavailable}
      onClick={onSelect}
    >
      {occupant && (
        <CursorRider
          color={occupant.color}
          label={occupant.label}
          isYou={isMine}
        />
      )}
      {!occupant && <span className="train-seat__prompt">sit</span>}
    </button>
  );
}

function Platform({
  currentStop,
  visible,
  atOrigin,
}: {
  currentStop: CommuteStop;
  visible: boolean;
  atOrigin: boolean;
}) {
  return (
    <div
      className={`station-platform ${visible ? "station-platform--visible" : ""}`}
      style={{ "--station-hue": atOrigin ? "#4a9a8a" : currentStop.hue } as React.CSSProperties}
      aria-hidden
    >
      <span className="station-platform__stripe" />
      <span className="station-platform__pillar station-platform__pillar--left" />
      <span className="station-platform__pillar station-platform__pillar--right" />
      <span className="station-platform__edge" />
      <span className="station-sign">
        {!atOrigin && <StopFavicon stop={currentStop} />}
        <span className="station-sign__destination">
          <strong>
            {atOrigin ? "home station" : getStopDisplayName(currentStop)}
          </strong>
          {!atOrigin && (
            <small>{getStopDisplayDetail(currentStop)}</small>
          )}
        </span>
      </span>
    </div>
  );
}

function LandscapeWindow({
  currentStop,
  phase,
  atOrigin,
  edge,
  stops,
}: {
  currentStop: CommuteStop;
  phase: CommutePhase;
  atOrigin: boolean;
  edge: "upper" | "lower";
  stops: CommuteStop[];
}) {
  const passingSites = stops
    .filter((stop) => stop.id !== currentStop.id)
    .slice(0, 4);
  const stationVisible = phase === "stopped" || phase === "arriving";

  return (
    <div
      className={`landscape-window landscape-window--${edge} landscape-window--${phase}`}
    >
      <ProceduralLandscape
        seed={currentStop.id}
        phase={phase}
        edge={edge}
      />
      {edge === "upper" &&
        passingSites.map((stop, index) => (
          <span
            className="passing-site"
            style={
              {
                "--passing-top": `${[22, 55, 36, 66][index]}px`,
                "--passing-delay": `${[-1, -4.2, -7.6, -10.8][index]}s`,
              } as React.CSSProperties
            }
            key={stop.id}
          >
            <StopFavicon stop={stop} />
            <span>{stop.domain}</span>
            <i>{formatStopAge(stop)} ago</i>
          </span>
        ))}
      <Platform
        currentStop={currentStop}
        visible={stationVisible}
        atOrigin={atOrigin}
      />
    </div>
  );
}

function TrainDoor({
  x,
  open,
  canExit,
  currentStop,
  onExit,
}: {
  x: number;
  open: boolean;
  canExit: boolean;
  currentStop: CommuteStop;
  onExit: () => void;
}) {
  return (
    <button
      className={`train-door ${open ? "train-door--open" : ""} ${
        canExit ? "train-door--exit" : ""
      }`}
      style={{ left: x }}
      type="button"
      onClick={onExit}
      aria-label={
        canExit
          ? `Get off at ${currentStop.domain}`
          : open
            ? "Doors open for boarding"
            : "Doors closed"
      }
      title={
        canExit
          ? `Get off at ${currentStop.domain}`
          : open
            ? "Doors open for boarding"
            : "Doors closed"
      }
    >
      <span className="train-door__panel train-door__panel--left" />
      <span className="train-door__panel train-door__panel--right" />
      <span className="train-door__label" aria-hidden={!canExit}>
        click door to get off
      </span>
    </button>
  );
}

const CommuteCar = withSharedState<CarData, RiderAwareness, CommuteCarProps>(
  () => ({
    defaultData: {},
    myDefaultAwareness: {
      seatId: null,
      color: "#5b8db8",
      label: "rider",
    },
  }),
  ({ awarenessByStableId, myAwareness, setMyAwareness, ref }, props) => {
    const { cursors } = usePlayContext();
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number | undefined>(undefined);
    useCursorZone(ref);

    const ridersBySeat = useMemo(() => {
      const riders = new Map<number, { label: string; color: string }>();
      for (const awareness of awarenessByStableId.values()) {
        if (awareness.seatId === null) continue;
        riders.set(awareness.seatId, {
          label: awareness.label,
          color: awareness.color,
        });
      }
      return riders;
    }, [awarenessByStableId]);

    const mySeatId = myAwareness?.seatId ?? null;
    const displayedRiders = useMemo(() => {
      const riders = new Map(ridersBySeat);
      if (mySeatId !== null) {
        riders.set(mySeatId, {
          label: "you",
          color: myAwareness?.color || cursors.color || "#5b8db8",
        });
      }
      return riders;
    }, [
      cursors.color,
      myAwareness?.color,
      mySeatId,
      ridersBySeat,
    ]);

    useEffect(() => {
      props.onRiderStateChange({
        count: displayedRiders.size,
        hasSeat: mySeatId !== null,
      });
    }, [displayedRiders, mySeatId, props.onRiderStateChange]);

    useEffect(
      () => () => {
        if (toastTimer.current !== undefined) {
          window.clearTimeout(toastTimer.current);
        }
      },
      [],
    );

    const showToast = (message: string) => {
      if (toastTimer.current !== undefined) {
        window.clearTimeout(toastTimer.current);
      }
      setToast(message);
      toastTimer.current = window.setTimeout(() => setToast(null), 3500);
    };

    const chooseSeat = (seatId: number) => {
      const occupant = displayedRiders.get(seatId);
      if (occupant && mySeatId !== seatId) return;

      setMyAwareness({
        seatId: mySeatId === seatId ? null : seatId,
        color: cursors.color || myAwareness?.color || "#5b8db8",
        label: cursors.name || "rider",
      });
    };

    const exitTrain = () => {
      if (props.phase !== "stopped") {
        showToast("the doors are closed — wait for the next stop");
        return;
      }
      if (props.atOrigin) {
        showToast("we haven't left yet — the train departs soon");
        return;
      }

      showToast(`doors open — see you at ${props.currentStop.domain}`);
      window.setTimeout(() => {
        window.open(props.currentStop.url, "_blank", "noopener,noreferrer");
      }, 600);
    };

    const doorOpen = props.phase === "stopped";
    const canExit = doorOpen && !props.atOrigin;

    return (
      <section id={props.id} className="train-car-wrap" ref={ref}>
        <section
          className={`train-car train-car--${props.phase}`}
          aria-label="Internet commute carriage"
        >
          <span className="train-car__edge train-car__edge--top" />
          <span className="train-car__edge train-car__edge--bottom" />
          <span className="train-car__edge train-car__edge--left" />
          <span className="train-car__edge train-car__edge--right" />
          <span className="train-car__side-door train-car__side-door--left" />
          <span className="train-car__side-door train-car__side-door--right" />

          {DOORS.map((x) => (
            <TrainDoor
              key={x}
              x={x}
              open={doorOpen}
              canExit={canExit}
              currentStop={props.currentStop}
              onExit={exitTrain}
            />
          ))}

          <span className="floor-light floor-light--left" />
          <span className="floor-light floor-light--right" />
          <span className="hand-straps hand-straps--top" />
          <span className="hand-straps hand-straps--bottom" />
          <span className="aisle-rule" />
          <span className="warning-strip warning-strip--left" />
          <span className="warning-strip warning-strip--right" />

          {SEATS.map((seat) => (
            <Seat
              key={seat.id}
              seat={seat}
              occupant={displayedRiders.get(seat.id)}
              isMine={mySeatId === seat.id}
              onSelect={() => chooseSeat(seat.id)}
            />
          ))}
        </section>
        {toast && (
          <div className="commute-toast" role="status">
            {toast}
          </div>
        )}
      </section>
    );
  },
);

function Banner({
  phase,
  secondsLeft,
  atOrigin,
  currentStop,
  hasSeat,
}: {
  phase: CommutePhase;
  secondsLeft: number;
  atOrigin: boolean;
  currentStop: CommuteStop;
  hasSeat: boolean;
}) {
  let message: string;
  let aside: string;
  let instruction = "";
  const stopName = getStopDisplayName(currentStop);

  if (atOrigin) {
    message = `next train to ${stopName}`;
    aside = `doors close in ${secondsLeft}s`;
    instruction = "find a seat — click any empty seat to sit down";
  } else if (phase === "stopped") {
    message = `now stopped at ${stopName}`;
    aside = `doors close in ${secondsLeft}s`;
    instruction = `the doors are open — click one to step off at ${currentStop.domain}`;
  } else if (phase === "arriving") {
    message = `now arriving at ${stopName}`;
    aside = `last visited by ${currentStop.visitedBy}, ${formatStopAge(currentStop)} ago`;
  } else {
    message = `${secondsLeft} seconds until next stop`;
    aside = `next stop: ${stopName}`;
    if (!hasSeat) instruction = "click an empty seat to sit";
  }

  return (
    <>
      <div className="commute-banner" aria-live="polite">
        <span className="commute-line-number">1</span>
        <strong>{message}</strong>
        <span className="commute-banner__rule" />
        <span className="commute-banner__aside">{aside}</span>
      </div>
      <p className="commute-instruction">{instruction}</p>
    </>
  );
}

function InternetCommute() {
  const { events, connected } = useLiveEvents({ maxEvents: 400 });
  const recentRoute = useRecentRoute();
  const stops =
    recentRoute.status === "live" ? recentRoute.stops : SAMPLE_STOPS;
  const sceneryStops =
    recentRoute.sceneryStops.length > 0
      ? recentRoute.sceneryStops
      : SAMPLE_STOPS;
  const browsingCount = useMemo(
    () => summarizeActiveLocations(events).people,
    [events],
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [riderState, setRiderState] = useState({
    count: 0,
    hasSeat: false,
  });

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const timing = getCommuteTiming(elapsedSeconds, stops.length);
  const currentStop = stops[timing.stopIndex];

  return (
    <main className="commute-page">
      <div className="commute-shell">
        <header className="commute-header">
          <a
            className="commute-wordmark"
            href="https://wewere.online/"
            target="_blank"
            rel="noreferrer"
          >
            we were online
          </a>
          <h1>internet commute</h1>
          <span>LINE 1 · LOCAL · EVERY STOP</span>
        </header>
        <p className="commute-subtitle">
          a slow train through the recent web — stops are pages other riders
          visited lately
        </p>

        <Banner
          phase={timing.phase}
          secondsLeft={timing.secondsLeft}
          atOrigin={timing.atOrigin}
          currentStop={currentStop}
          hasSeat={riderState.hasSeat}
        />

        <LandscapeWindow
          currentStop={currentStop}
          phase={timing.phase}
          atOrigin={timing.atOrigin}
          edge="upper"
          stops={sceneryStops}
        />
        <CommuteCar
          id="internet-commute-car"
          currentStop={currentStop}
          phase={timing.phase}
          atOrigin={timing.atOrigin}
          onRiderStateChange={setRiderState}
        />
        <LandscapeWindow
          currentStop={currentStop}
          phase={timing.phase}
          atOrigin={timing.atOrigin}
          edge="lower"
          stops={sceneryStops}
        />

        <div className="commute-counts">
          <strong>
            {riderState.count}{" "}
            {riderState.count === 1 ? "person" : "people"} riding
          </strong>
          <span>LOCAL LINE · EVERY STOP</span>
          <strong>
            {browsingCount} {browsingCount === 1 ? "person" : "people"} browsing
          </strong>
        </div>

        <p className="commute-note">
          {recentRoute.status === "live"
            ? "destinations are recent pages visited by people using the extension"
            : recentRoute.status === "loading"
              ? "finding recent destinations — preview route shown while the train boards"
              : "recent destinations unavailable — running the preview route"}
          {" · "}
          {connected ? "live browsing activity" : "browsing activity offline"}
          {" · "}you only appear while you ride
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById("commute-root")!).render(
  <React.StrictMode>
    <PlayProvider
      initOptions={{
        room: "wwo-internet-commute",
        cursors: {
          enabled: true,
          enableChat: false,
          coordinateMode: "absolute",
        },
      }}
    >
      <InternetCommute />
    </PlayProvider>
  </React.StrictMode>,
);
