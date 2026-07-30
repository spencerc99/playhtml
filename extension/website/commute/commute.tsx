// ABOUTME: Interactive internet commute carriage with shared, ephemeral seat presence.
// ABOUTME: Cycles through recent WWO destinations and opens the doors at each stop.

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
  side: "north" | "south";
}

const SEATS: SeatDefinition[] = [
  ...Array.from({ length: 7 }, (_, index) => ({
    id: `north-${index + 1}`,
    side: "north" as const,
  })),
  ...Array.from({ length: 7 }, (_, index) => ({
    id: `south-${index + 1}`,
    side: "south" as const,
  })),
];

const SAMPLE_RIDERS: Record<
  string,
  { label: string; color: string }
> = {
  "north-2": { label: "moss", color: "#4c9a83" },
  "north-6": { label: "june", color: "#7967b7" },
  "south-4": { label: "guest", color: "#d06b3e" },
};

function Passenger({
  color,
  label,
  isYou = false,
}: {
  color: string;
  label: string;
  isYou?: boolean;
}) {
  return (
    <span
      className={`passenger ${isYou ? "passenger--you" : ""}`}
      style={{ "--passenger-color": color } as React.CSSProperties}
      aria-label={isYou ? "You are sitting here" : `${label} is sitting here`}
    >
      <span className="passenger__head" />
      <span className="passenger__coat" />
      <span className="passenger__label">{isYou ? "you" : label}</span>
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
      className={`train-seat ${isMine ? "train-seat--mine" : ""}`}
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
      <span className="train-seat__back" />
      <span className="train-seat__base" />
      {occupant && (
        <Passenger
          color={occupant.color}
          label={occupant.label}
          isYou={isMine}
        />
      )}
    </button>
  );
}

const CommuteCar = withSharedState<CarData, RiderAwareness, CarProps>(
  () => ({
    defaultData: {},
    myDefaultAwareness: {
      seatId: null,
      color: "#3f8fbd",
      label: "rider",
    },
  }),
  (
    {
      awarenessByStableId,
      myAwareness,
      setMyAwareness,
      ref,
    },
    props,
  ) => {
    const { cursors } = usePlayContext();
    useCursorZone(ref);

    const liveRiders = useMemo(() => {
      const riders = new Map<string, { label: string; color: string }>();

      for (const awareness of awarenessByStableId.values()) {
        if (!awareness.seatId) continue;
        riders.set(awareness.seatId, {
          label: awareness.label || "rider",
          color: awareness.color || "#3f8fbd",
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
        color: myAwareness?.color || cursors.color || "#3f8fbd",
      });
    }

    const chooseSeat = (seatId: string) => {
      setMyAwareness({
        seatId: mySeatId === seatId ? null : seatId,
        color: cursors.color || myAwareness?.color || "#3f8fbd",
        label: cursors.name || "rider",
      });
    };

    const renderSeatRow = (side: SeatDefinition["side"]) => (
      <div className={`seat-row seat-row--${side}`}>
        {SEATS.filter((seat) => seat.side === side).map((seat, index) => (
          <React.Fragment key={seat.id}>
            {index === 4 && <span className="seat-row__door-gap" />}
            <Seat
              seat={seat}
              occupant={ridersBySeat.get(seat.id)}
              isMine={mySeatId === seat.id}
              onSelect={() => chooseSeat(seat.id)}
            />
          </React.Fragment>
        ))}
      </div>
    );

    const liveRiderCount = Math.max(1, awarenessByStableId.size);

    return (
      <section
        id={props.id}
        className={`train-car ${props.arriving ? "train-car--arriving" : ""}`}
        ref={ref}
        aria-label="Internet commute carriage"
      >
        <div className="train-car__windows train-car__windows--north">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} />
          ))}
        </div>

        <div className="train-car__door train-car__door--north" aria-hidden />
        {renderSeatRow("north")}

        <div className="train-car__aisle">
          <div className="pole pole--one" />
          <div className="pole pole--two" />
          <div className="pole pole--three" />
          <div className="aisle-message">
            {mySeatId
              ? "you have a seat — click it again to stand"
              : "choose a seat for the ride"}
          </div>
          <div className="floor-reflection" />
        </div>

        {renderSeatRow("south")}
        <div className="train-car__door train-car__door--south" aria-hidden />

        <div className="train-car__windows train-car__windows--south">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} />
          ))}
        </div>

        <button
          className="exit-door"
          type="button"
          disabled={!props.arriving}
          onClick={() => window.location.assign(props.currentStop.url)}
        >
          <span className="exit-door__lights" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="exit-door__label">
            {props.arriving ? "doors open — get off" : "doors locked in motion"}
          </span>
          <span className="exit-door__destination">
            {props.arriving
              ? props.currentStop.domain
              : `${props.countdown}s`}
          </span>
        </button>

        <div className="car-number">WWO 01</div>
        <div className="rider-count">
          {liveRiderCount} {liveRiderCount === 1 ? "rider" : "riders"} here
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
      <div className="route-map__line" aria-hidden />
      {stops.map((stop, index) => {
        const isCurrent = index === stopIndex;
        return (
          <div
            className={`route-stop ${isCurrent ? "route-stop--current" : ""}`}
            key={stop.id}
          >
            <span className="route-stop__dot" />
            <span className="route-stop__name">
              {isCurrent && !arriving ? "next: " : ""}
              {stop.domain}
            </span>
          </div>
        );
      })}
    </section>
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

  return (
    <main className="commute-page">
      <header className="commute-header">
        <a className="commute-wordmark" href="/">
          we were online
        </a>
        <div className="commute-title">
          <span className="line-badge">i</span>
          <div>
            <h1>internet commute</h1>
            <p>local service through the recently visited web</p>
          </div>
        </div>
        <div className="service-status">
          <span className={connected ? "signal signal--live" : "signal"} />
          {liveStops.length >= 3
            ? "route from live browsing"
            : connected
              ? "quiet line — sample route"
              : "connecting — sample route"}
        </div>
      </header>

      <section
        className={`arrival-board ${arriving ? "arrival-board--open" : ""}`}
        aria-live="polite"
      >
        <span className="arrival-board__eyebrow">
          {arriving ? "now arriving" : "next stop"}
        </span>
        <strong>{currentStop.domain}</strong>
        <span className="arrival-board__path">
          {currentStop.path === "/" ? "home platform" : currentStop.path}
        </span>
        <span className="arrival-board__time">
          {arriving ? `doors close in ${countdown}s` : `${countdown}s away`}
        </span>
      </section>

      <CommuteCar
        id="internet-commute-car"
        currentStop={currentStop}
        arriving={arriving}
        countdown={countdown}
      />

      <div className="commute-footer">
        <div className="commute-footer__copy">
          <span>ride slowly. leave anywhere.</span>
          <span>
            destinations are {liveStops.length >= 3 ? "recent visits" : "a sample"}
          </span>
        </div>
        <RouteMap stops={stops} stopIndex={stopIndex} arriving={arriving} />
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
