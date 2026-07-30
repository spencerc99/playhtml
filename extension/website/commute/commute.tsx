// ABOUTME: Web-native internet commute carriage with shared ephemeral seat presence.
// ABOUTME: Cycles through recent WWO destinations and opens textured portal doors.

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
  getFaviconUrl,
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
  stops: CommuteStop[];
}

interface SeatDefinition {
  id: string;
  side: "north" | "south";
  tilt: number;
}

const SEATS: SeatDefinition[] = [
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `north-${index + 1}`,
    side: "north" as const,
    tilt: [-7, 4, -3, 6, -5, 7][index],
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `south-${index + 1}`,
    side: "south" as const,
    tilt: [5, -6, 4, -4, 7, -5][index],
  })),
];

const SAMPLE_RIDERS: Record<string, { label: string; color: string }> = {
  "north-2": { label: "moss", color: "#328878" },
  "north-5": { label: "june", color: "#7965ac" },
  "south-4": { label: "guest", color: "#d77737" },
};

function StopFavicon({
  stop,
  className,
}: {
  stop: CommuteStop;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
  }, [stop.url]);

  return (
    <span className={`stop-favicon ${className ?? ""}`}>
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
          stroke="#fff"
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
      className={`train-seat ${isMine ? "train-seat--mine" : ""}`}
      style={
        {
          "--rider-color": occupant?.color ?? "transparent",
        } as React.CSSProperties
      }
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
        <span className="train-seat__prompt">sit</span>
      )}
    </button>
  );
}

function PortalArtwork({ arriving }: { arriving: boolean }) {
  return (
    <span className="portal-artwork" aria-hidden>
      <span className="portal-panel portal-panel--left">
        <strong>{arriving ? "CLICK" : "WWW"}</strong>
        <i>{arriving ? "TO EXIT" : "somewhere on the web"}</i>
      </span>
      <span className="portal-panel portal-panel--right">
        <b>{arriving ? "↗" : "✦"}</b>
        <i>{arriving ? "open site" : "doors open at arrival"}</i>
      </span>
    </span>
  );
}

const CommuteCar = withSharedState<CarData, RiderAwareness, CarProps>(
  () => ({
    defaultData: {},
    myDefaultAwareness: {
      seatId: null,
      color: "#2d73b8",
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
          color: awareness.color || "#2d73b8",
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
        color: myAwareness?.color || cursors.color || "#2d73b8",
      });
    }

    const chooseSeat = (seatId: string) => {
      setMyAwareness({
        seatId: mySeatId === seatId ? null : seatId,
        color: cursors.color || myAwareness?.color || "#2d73b8",
        label: cursors.name || "rider",
      });
    };

    const renderSeatRow = (side: SeatDefinition["side"]) => (
      <div className={`seat-row seat-row--${side}`}>
        {SEATS.filter((seat) => seat.side === side).map((seat) => (
          <Seat
            key={seat.id}
            seat={seat}
            occupant={ridersBySeat.get(seat.id)}
            isMine={mySeatId === seat.id}
            onSelect={() => chooseSeat(seat.id)}
          />
        ))}
      </div>
    );

    const riderCount = ridersBySeat.size;
    const passingSites = props.stops
      .filter((stop) => stop.id !== props.currentStop.id)
      .slice(0, 3);

    return (
      <section
        id={props.id}
        className={`train-car ${props.arriving ? "train-car--arriving" : ""}`}
        ref={ref}
        aria-label="Internet commute carriage"
      >
        <div className="end-wall end-wall--north">
          <span className="train-window" />
          <div className="portal-door portal-door--display" aria-hidden>
            <PortalArtwork arriving={false} />
          </div>
          <span className="train-window" />
        </div>

        {renderSeatRow("north")}

        <div className="train-aisle">
          <span className="aisle-message">
            {mySeatId
              ? "your cursor has a seat — click it to stand"
              : "choose a seat for the ride"}
          </span>
          <span className="passing-sites" aria-hidden>
            {passingSites.map((stop) => stop.domain).join(" · ")}
          </span>
          <span className="rider-count">
            {riderCount} {riderCount === 1 ? "cursor" : "cursors"} riding
          </span>
        </div>

        {renderSeatRow("south")}

        <div className="end-wall end-wall--south">
          <span className="train-window" />
          <button
            className="portal-door portal-door--exit"
            type="button"
            disabled={!props.arriving}
            onClick={() => window.location.assign(props.currentStop.url)}
          >
            <PortalArtwork arriving={props.arriving} />
            <span className="portal-door__status">
              {props.arriving
                ? `leave at ${props.currentStop.domain}`
                : `stay awhile · ${props.countdown}s`}
            </span>
          </button>
          <span className="train-window" />
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
            <StopFavicon stop={stop} />
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
        <span className="commute-name">[ internet commute ]</span>
        <span className="service-status">
          <i className={connected ? "signal signal--live" : "signal"} />
          {liveStops.length >= 3 ? "recently visited" : "quiet service"}
        </span>
      </header>

      <section
        className={`destination ${arriving ? "destination--arriving" : ""}`}
        aria-live="polite"
      >
        <span className="destination__label">
          {arriving ? "NOW ARRIVING:" : "NEXT STOP:"}
        </span>
        <StopFavicon stop={currentStop} className="destination__favicon" />
        <h1>{currentStop.domain}</h1>
        <span className="destination__path">
          {currentStop.path === "/" ? "front page" : currentStop.path}
        </span>
        <span className="destination__time">
          {arriving ? `doors close in ${countdown}s` : `${countdown}s away`}
        </span>
      </section>

      <CommuteCar
        id="internet-commute-car"
        currentStop={currentStop}
        arriving={arriving}
        countdown={countdown}
        stops={stops}
      />

      <footer className="commute-footer">
        <p>ride slowly · leave anywhere</p>
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
