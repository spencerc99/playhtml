// ABOUTME: Warm, abstract internet commute with shared ephemeral seat presence.
// ABOUTME: Cycles through recent WWO destinations and opens each stop as a link.

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PlayProvider,
  useCursorZone,
  usePlayContext,
  withSharedState,
} from "@playhtml/react";
import { useLiveEvents } from "../shared/hooks/useLiveEvents";
import {
  deriveRecentStops,
  SAMPLE_STOPS,
  type CommuteStop,
} from "./commuteStops";
import "./commute.scss";

const TRAVEL_SECONDS = 24;
const PLATFORM_SECONDS = 10;

type CarData = Record<string, never>;

interface RiderAwareness {
  seatId: string | null;
  color: string;
  label: string;
}

interface CarProps {
  id: string;
  currentStop: CommuteStop;
  arriving: boolean;
  countdown: number;
}

interface SeatDefinition {
  id: string;
  x: number;
  tilt: number;
}

const SEATS: SeatDefinition[] = [
  { id: "seat-1", x: 13, tilt: -7 },
  { id: "seat-2", x: 27.7, tilt: 5 },
  { id: "seat-3", x: 42.5, tilt: -4 },
  { id: "seat-4", x: 57.4, tilt: 6 },
  { id: "seat-5", x: 72.2, tilt: -5 },
  { id: "seat-6", x: 87, tilt: 7 },
];

const SAMPLE_RIDERS: Record<string, { label: string; color: string }> = {
  "seat-2": { label: "moss", color: "#398477" },
  "seat-5": { label: "june", color: "#7b67a8" },
};

function CursorRider({
  color,
  label,
  isYou = false,
  tilt,
}: {
  color: string;
  label: string;
  isYou?: boolean;
  tilt: number;
}) {
  return (
    <span
      className={`cursor-rider ${isYou ? "cursor-rider--you" : ""}`}
      style={
        {
          "--cursor-color": color,
          "--cursor-tilt": `${tilt}deg`,
        } as React.CSSProperties
      }
      aria-label={isYou ? "Your cursor is sitting here" : `${label}'s cursor`}
    >
      <svg viewBox="0 0 28 34" aria-hidden>
        <path
          d="M3.2 2.8v25.6l7.1-7.2 4.6 10.2 4.7-2.2-4.7-9.9h9.8L3.2 2.8Z"
          fill="var(--cursor-color)"
          stroke="#fffaf0"
          strokeLinejoin="round"
          strokeWidth="2.2"
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
  occupant?: { label: string; color: string };
  isMine: boolean;
  onSelect: () => void;
}) {
  const unavailable = Boolean(occupant && !isMine);

  return (
    <button
      className={`bench-seat ${isMine ? "bench-seat--mine" : ""}`}
      style={{ "--seat-x": `${seat.x}%` } as React.CSSProperties}
      type="button"
      data-seat-id={seat.id}
      aria-label={
        isMine
          ? "Leave this seat"
          : unavailable
            ? `Seat occupied by ${occupant.label}`
            : "Take this seat"
      }
      aria-pressed={isMine}
      disabled={unavailable}
      onClick={onSelect}
    >
      {occupant ? (
        <CursorRider
          color={occupant.color}
          label={occupant.label}
          isYou={isMine}
          tilt={seat.tilt}
        />
      ) : (
        <span className="bench-seat__prompt">sit</span>
      )}
    </button>
  );
}

const CommuteCar = withSharedState<CarData, RiderAwareness, CarProps>(
  () => ({
    defaultData: {},
    myDefaultAwareness: {
      seatId: null,
      color: "#d25d43",
      label: "rider",
    },
  }),
  ({ awarenessByStableId, myAwareness, setMyAwareness, ref }, props) => {
    const { cursors } = usePlayContext();
    useCursorZone(ref);

    const liveRiders = useMemo(() => {
      const riders = new Map<string, { label: string; color: string }>();

      for (const awareness of awarenessByStableId.values()) {
        if (!awareness.seatId) continue;
        riders.set(awareness.seatId, {
          label: awareness.label || "rider",
          color: awareness.color || "#d25d43",
        });
      }

      return riders;
    }, [awarenessByStableId]);

    const mySeatId = myAwareness?.seatId ?? null;
    const ridersBySeat = new Map(Object.entries(SAMPLE_RIDERS));

    for (const [seatId, rider] of liveRiders) {
      ridersBySeat.set(seatId, rider);
    }

    if (mySeatId) {
      ridersBySeat.set(mySeatId, {
        label: "you",
        color: myAwareness?.color || cursors.color || "#d25d43",
      });
    }

    const chooseSeat = (seatId: string) => {
      setMyAwareness({
        seatId: mySeatId === seatId ? null : seatId,
        color: cursors.color || myAwareness?.color || "#d25d43",
        label: cursors.name || "rider",
      });
    };

    const riderCount = ridersBySeat.size;

    return (
      <section
        id={props.id}
        className={`ride-space ${props.arriving ? "ride-space--arriving" : ""}`}
        ref={ref}
        aria-label="Internet commute"
      >
        <p className="ride-space__instruction">
          {mySeatId
            ? "your cursor has a seat — click it to stand"
            : "choose a place to sit while the web passes by"}
        </p>

        <div className="bench-wrap">
          <div className="bench-glow" aria-hidden />
          <img
            className="commute-bench"
            src="/commute-bench.png"
            alt="A warm wooden subway bench with six red seats"
            draggable={false}
          />
          <div className="bench-seats">
            {SEATS.map((seat) => (
              <Seat
                key={seat.id}
                seat={seat}
                occupant={ridersBySeat.get(seat.id)}
                isMine={mySeatId === seat.id}
                onSelect={() => chooseSeat(seat.id)}
              />
            ))}
          </div>
        </div>

        <div className="ride-space__foot">
          <span className="rider-count">
            {riderCount} {riderCount === 1 ? "cursor" : "cursors"} riding
          </span>
          <button
            className="leave-stop"
            type="button"
            disabled={!props.arriving}
            onClick={() => window.location.assign(props.currentStop.url)}
          >
            {props.arriving ? (
              <>
                leave at <strong>{props.currentStop.domain}</strong>
                <span aria-hidden>↗</span>
              </>
            ) : (
              <>stay awhile · {props.countdown}s</>
            )}
          </button>
        </div>
      </section>
    );
  },
);

function RouteMap({
  stops,
  stopIndex,
  arriving,
}: {
  stops: CommuteStop[];
  stopIndex: number;
  arriving: boolean;
}) {
  return (
    <section className="route-map" aria-label="Internet commute route">
      <div className="route-map__rail" aria-hidden />
      {stops.map((stop, index) => {
        const isCurrent = index === stopIndex;
        const stationNumber = String(index + 1).padStart(2, "0");

        return (
          <div
            className={`route-stop ${isCurrent ? "route-stop--current" : ""}`}
            key={stop.id}
          >
            <span className="route-stop__marker">
              <small>W</small>
              {stationNumber}
            </span>
            <span className="route-stop__name">
              {isCurrent && !arriving ? "next · " : ""}
              {stop.domain}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function PassingWeb({ stops }: { stops: CommuteStop[] }) {
  return (
    <div className="passing-web" aria-hidden>
      {[...stops, ...stops].map((stop, index) => (
        <span key={`${stop.id}-${index}`}>{stop.domain}</span>
      ))}
    </div>
  );
}

function InternetCommute() {
  const { events, connected } = useLiveEvents({ maxEvents: 400 });
  const liveStops = useMemo(() => deriveRecentStops(events), [events]);
  const stops = liveStops.length >= 3 ? liveStops : SAMPLE_STOPS;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);

    return () => window.clearInterval(timer);
  }, []);

  const cycleSeconds = TRAVEL_SECONDS + PLATFORM_SECONDS;
  const cyclePosition = elapsedSeconds % cycleSeconds;
  const stopIndex = Math.floor(elapsedSeconds / cycleSeconds) % stops.length;
  const arriving = cyclePosition >= TRAVEL_SECONDS;
  const countdown = arriving
    ? PLATFORM_SECONDS - (cyclePosition - TRAVEL_SECONDS)
    : TRAVEL_SECONDS - cyclePosition;
  const currentStop = stops[stopIndex];
  const stationNumber = String(stopIndex + 1).padStart(2, "0");

  return (
    <main className="commute-page">
      <PassingWeb stops={stops} />

      <header className="commute-header">
        <a className="commute-wordmark" href="/">
          we were online
        </a>
        <span className="commute-name">internet commute</span>
        <span className="service-status">
          <i className={connected ? "signal signal--live" : "signal"} />
          {liveStops.length >= 3 ? "recently visited" : "quiet service"}
        </span>
      </header>

      <section
        className={`journey-heading ${arriving ? "journey-heading--arriving" : ""}`}
        aria-live="polite"
      >
        <div
          className="station-marker"
          aria-label={`Station W ${stationNumber}`}
        >
          <span>W</span>
          <strong>{stationNumber}</strong>
        </div>
        <div className="arrival-copy">
          <span className="arrival-copy__eyebrow">
            {arriving ? "now arriving" : "next stop"}
          </span>
          <h1>{currentStop.domain}</h1>
          <p>
            {currentStop.path === "/" ? "front page" : currentStop.path}
            <span>
              {arriving ? `doors close in ${countdown}s` : `${countdown}s away`}
            </span>
          </p>
        </div>
      </section>

      <CommuteCar
        id="internet-commute-car"
        currentStop={currentStop}
        arriving={arriving}
        countdown={countdown}
      />

      <footer className="commute-footer">
        <p>
          ride slowly
          <span aria-hidden> · </span>
          leave anywhere
        </p>
        <RouteMap stops={stops} stopIndex={stopIndex} arriving={arriving} />
      </footer>
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
