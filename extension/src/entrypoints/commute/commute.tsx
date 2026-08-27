// ABOUTME: Full-tab Internet Commute with shared ephemeral cursor seating.
// ABOUTME: Cycles through recent WWO destinations in a bird's-eye train carriage.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PlayerIdentity } from "@playhtml/common";
import type { CommuteTrainAssignment } from "@playhtml/extension-types";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import trainIceUrl from "../../assets/train-ice.png";
import {
  PlayProvider,
  usePlayContext,
  usePresence,
  useUsers,
  withSharedState,
} from "@playhtml/react";
import { COMMUTE_RECENT_URL } from "@movement/config";
import {
  formatStopAge,
  getFaviconUrl,
  getPassingSceneryStops,
  getStopDisplayDetail,
  getStopDisplayName,
  parseCommuteResponse,
  SAMPLE_STOPS,
  type CommuteStop,
} from "./commuteStops";
import { estimateServerTimeOffset } from "./commuteService";
import {
  DEPARTURE_SECONDS,
  getSlowModePlatformPhase,
  getCommuteTiming,
  TRAIN_DURATIONS,
  type CommutePhase,
  type SlowModePlatformPhase,
} from "./commuteTiming";
import { CommuteInstallPrompt } from "./CommuteInstallPrompt";
import {
  CommuteMobileControls,
  keepCommuteCursorInCar,
} from "./CommuteMobileControls";
import { CommuteStage } from "./CommuteStage";
import { CommuteStationPoster } from "./CommuteStationPoster";
import { useCommuteDebug } from "./commuteDebug";
import {
  COMMUTE_CLICK_WALK_SPEED,
  COMMUTE_JOIN_ENTRY_POSITION,
  COMMUTE_WALK_SPEED,
  findNearbyCommuteSeat,
  getCommuteArrivalRiderId,
  getCommutePointFromClient,
  getMyCommuteRiderStart,
  getCommuteRiderStart,
  getSharedCommutePosition,
  getStandingPosition,
  moveCommuteAvatar,
  moveCommuteAvatarToward,
  shouldExitCommuteThroughDoor,
  type CommutePoint,
  type CommuteSeatGeometry,
} from "./commuteMobile";
import { ProceduralLandscape } from "./landscape";
import {
  getHostedSlowModeRideId,
  reportHostedSlowModeOutcome,
  requestHostedSlowModeRide,
  type HostedSlowModeRide,
} from "../../features/slowMode/slowModeHostedBridge";
import { getPublicPlayerIdentity } from "../../storage/playerIdentity";
import { createCommuteInitOptions } from "./commuteIdentity";
import {
  boardCommuteTrain,
  createCommuteTrainBoardRequest,
  getCommuteTrainNextAction,
  getCommuteRiderToken,
  getCommuteTrainTimeOffset,
  rotateCommuteRiderToken,
  toCommuteStop,
} from "./commuteTrain";
import "./commute.scss";

type CarData = Record<string, never>;

interface RiderAwareness {
  seatId: number | null;
  position?: CommutePoint;
  positionSequence?: number;
}

interface SeatDefinition extends CommuteSeatGeometry {
  bank: number;
}

interface CommuteCarProps {
  id: string;
  currentStop: CommuteStop;
  phase: CommutePhase;
  atOrigin: boolean;
  serviceReady: boolean;
  mobileBoarded: boolean;
  onMobileBoardStateChange: (boarded: boolean) => void;
  onSeatStateChange: (hasSeat: boolean) => void;
  navigateCurrentTabOnExit: boolean;
  onExitStop?: (stop: CommuteStop) => void;
  onTeleport?: () => void;
}

interface RecentRoute {
  stops: CommuteStop[];
  sceneryStops: CommuteStop[];
  activePeople: number;
  serverTimeOffsetMs: number | null;
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
const DOOR_GEOMETRY = DOORS.map((x) => ({ x }));
const COMMUTE_REFRESH_MS = 30_000;
const COMMUTE_ROUTE_TIMEOUT_MS = 5_000;
const COMMUTE_RIDER_ARRIVAL_EVENT = "commute-rider-arrival";

function useRecentRoute(): RecentRoute {
  const [route, setRoute] = useState<RecentRoute>({
    stops: [],
    sceneryStops: [],
    activePeople: 0,
    serverTimeOffsetMs: null,
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    let hasLoadedRoute = false;

    const load = async () => {
      try {
        const requestStartedAt = Date.now();
        const response = await fetch(COMMUTE_RECENT_URL, {
          signal: controller.signal,
        });
        const responseReceivedAt = Date.now();
        if (!response.ok) {
          throw new Error(`Recent commute request failed: ${response.status}`);
        }

        const commute = parseCommuteResponse(await response.json());
        hasLoadedRoute = true;
        setRoute({
          stops: commute.stops,
          sceneryStops: commute.sceneryStops,
          activePeople: commute.activePeople,
          serverTimeOffsetMs: estimateServerTimeOffset(
            commute.generatedAt,
            requestStartedAt,
            responseReceivedAt,
          ),
          status: commute.stops.length > 0 ? "live" : "empty",
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[internet commute] recent route unavailable:", error);
        if (!hasLoadedRoute) {
          setRoute({
            stops: [],
            sceneryStops: [],
            activePeople: 0,
            serverTimeOffsetMs: 0,
            status: "error",
          });
        }
      }
    };

    void load();
    const routeTimeout = window.setTimeout(() => {
      if (hasLoadedRoute) return;
      setRoute((current) =>
        current.status === "loading"
          ? {
              ...current,
              serverTimeOffsetMs: 0,
              status: "error",
            }
          : current,
      );
    }, COMMUTE_ROUTE_TIMEOUT_MS);
    const refreshTimer = window.setInterval(
      () => void load(),
      COMMUTE_REFRESH_MS,
    );
    return () => {
      controller.abort();
      window.clearTimeout(routeTimeout);
      window.clearInterval(refreshTimer);
    };
  }, []);

  return route;
}

interface CommuteTrainConnection {
  assignment: CommuteTrainAssignment | null;
  serverTimeOffsetMs: number;
  status: "loading" | "live" | "error";
}

function useCommuteTrain(
  ride: HostedSlowModeRide | null,
): CommuteTrainConnection {
  const [connection, setConnection] = useState<CommuteTrainConnection>({
    assignment: null,
    serverTimeOffsetMs: 0,
    status: "loading",
  });
  const [riderToken, setRiderToken] = useState(() =>
    getCommuteRiderToken(ride),
  );
  const request = useMemo(
    () => createCommuteTrainBoardRequest(riderToken, ride),
    [ride, riderToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | undefined;
    let lastAssignment: CommuteTrainAssignment | null = null;

    const board = async () => {
      const requestStartedAt = Date.now();
      try {
        const assignment = await boardCommuteTrain(request, controller.signal);
        const responseReceivedAt = Date.now();
        lastAssignment = assignment;
        setConnection((current) => {
          if (
            current.assignment?.routeVersion === assignment.routeVersion &&
            current.assignment.riderCount === assignment.riderCount &&
            current.assignment.joinable === assignment.joinable &&
            current.assignment.phase === assignment.phase
          ) {
            return current;
          }
          return {
            assignment,
            serverTimeOffsetMs: getCommuteTrainTimeOffset(
              assignment,
              requestStartedAt,
              responseReceivedAt,
            ),
            status: "live",
          };
        });
        const nextAction = getCommuteTrainNextAction(assignment, ride !== null);
        if (nextAction.kind === "refresh") {
          refreshTimer = window.setTimeout(
            () => void board(),
            nextAction.delayMs,
          );
        } else if (nextAction.kind === "reboard") {
          refreshTimer = window.setTimeout(() => {
            setConnection({
              assignment: null,
              serverTimeOffsetMs: 0,
              status: "loading",
            });
            setRiderToken(rotateCommuteRiderToken());
          }, nextAction.delayMs);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[internet commute] train boarding unavailable:", error);
        if (lastAssignment) {
          refreshTimer = window.setTimeout(() => void board(), 3_000);
        } else {
          setConnection((current) => ({ ...current, status: "error" }));
        }
      }
    };

    void board();
    return () => {
      controller.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [request]);

  return connection;
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
  ariaLabel,
}: {
  color: string;
  label?: string;
  isYou: boolean;
  ariaLabel?: string;
}) {
  return (
    <span
      className={`cursor-rider ${isYou ? "cursor-rider--you" : ""}`}
      style={{ "--cursor-color": color } as React.CSSProperties}
      aria-label={
        ariaLabel ??
        (isYou ? "Your cursor is sitting here" : "Another rider's cursor")
      }
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
      {(isYou || label) && <span>{isYou ? "you" : label}</span>}
    </span>
  );
}

function SlowModePlatformScene({
  cursorColor,
  destinationDomain,
  secondsLeft,
}: {
  cursorColor: string;
  destinationDomain: string;
  secondsLeft: number;
}) {
  const phase = getSlowModePlatformPhase(secondsLeft);

  return (
    <section
      className={`slow-mode-platform slow-mode-platform--${phase}`}
      aria-label="Waiting at home station for the Slow Mode train"
    >
      <span className="slow-mode-platform__stripe" />
      <span className="slow-mode-platform__pillar slow-mode-platform__pillar--left" />
      <span className="slow-mode-platform__pillar slow-mode-platform__pillar--right" />
      <span className="slow-mode-platform__edge" />
      <strong className="slow-mode-platform__sign">home station</strong>

      <span className="slow-mode-platform__train">
        <span className="slow-mode-platform__service">
          local · {destinationDomain}
        </span>
        <img
          src={trainIceUrl}
          alt="A white high-speed train pulling into home station"
        />
      </span>

      <span className="slow-mode-platform__rider">
        <CursorRider color={cursorColor} label="you" isYou />
      </span>
    </section>
  );
}

function Seat({
  seat,
  occupant,
  isMine,
  isNearby,
  onSelect,
}: {
  seat: SeatDefinition;
  occupant?: { color: string; label?: string };
  isMine: boolean;
  isNearby: boolean;
  onSelect: () => void;
}) {
  const unavailable = Boolean(occupant && !isMine);
  const isPriority =
    (seat.bank === 0 && seat.x === 44) || (seat.bank === 2 && seat.x === 1008);
  const fabric = isPriority ? "plum" : seat.bank === 1 ? "gold" : "teal";

  return (
    <button
      className={`train-seat train-seat--${seat.row} train-seat--${fabric} ${
        isMine ? "train-seat--mine" : ""
      } ${isNearby ? "train-seat--nearby" : ""}`}
      style={{ left: seat.x, top: seat.y }}
      type="button"
      data-seat-id={seat.id}
      aria-label={
        isMine
          ? "Stand up"
          : unavailable
            ? "Seat occupied by another rider"
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
  showStationPoster,
}: {
  currentStop: CommuteStop;
  visible: boolean;
  atOrigin: boolean;
  showStationPoster: boolean;
}) {
  return (
    <div
      className={`station-platform ${visible ? "station-platform--visible" : ""}`}
      style={
        {
          "--station-hue": atOrigin ? "#4a9a8a" : currentStop.hue,
        } as React.CSSProperties
      }
    >
      <span className="station-platform__stripe" aria-hidden />
      <span className="station-platform__pillar station-platform__pillar--left" aria-hidden />
      <span className="station-platform__pillar station-platform__pillar--right" aria-hidden />
      <span className="station-platform__edge" aria-hidden />
      {showStationPoster && (
        <>
          <CommuteStationPoster
            domain={currentStop.domain}
            stationVisible={visible}
            side="left"
          />
          <CommuteStationPoster
            domain={currentStop.domain}
            stationVisible={visible}
            side="right"
          />
        </>
      )}
      <span className="station-sign" aria-hidden>
        {!atOrigin && <StopFavicon stop={currentStop} />}
        <span className="station-sign__destination">
          <strong>
            {atOrigin ? "home station" : getStopDisplayName(currentStop)}
          </strong>
          {!atOrigin && <small>{getStopDisplayDetail(currentStop)}</small>}
        </span>
      </span>
    </div>
  );
}

function LandscapeWindow({
  currentStop,
  platformStop,
  phase,
  platformAtOrigin,
  edge,
  stops,
  stopIndex,
}: {
  currentStop: CommuteStop;
  platformStop: CommuteStop;
  phase: CommutePhase;
  platformAtOrigin: boolean;
  edge: "upper" | "lower";
  stops: CommuteStop[];
  stopIndex: number;
}) {
  const passingSites = getPassingSceneryStops(
    stops,
    currentStop.domain,
    stopIndex,
  );
  const stationVisible = phase === "stopped" || phase === "arriving";

  return (
    <div
      className={`landscape-window landscape-window--${edge} landscape-window--${phase}`}
    >
      <ProceduralLandscape seed={currentStop.id} phase={phase} edge={edge} />
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
            <span className="passing-site__domain" title={stop.domain}>
              {stop.domain}
            </span>
            <i>{formatStopAge(stop)} ago</i>
          </span>
        ))}
      <Platform
        currentStop={platformStop}
        visible={stationVisible}
        atOrigin={platformAtOrigin}
        showStationPoster={edge === "upper"}
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
        leave this train →
      </span>
    </button>
  );
}

const CommuteCar = withSharedState<CarData, RiderAwareness, CommuteCarProps>(
  () => ({
    defaultData: {},
    myDefaultAwareness: {
      seatId: null,
    },
  }),
  ({ awarenessByStableId, myAwareness, setMyAwareness, ref }, props) => {
    const { mobileBoarded, onMobileBoardStateChange, onSeatStateChange } =
      props;
    const users = useUsers();
    const {
      configureCursors,
      cursors,
      dispatchPlayEvent,
      isLoading,
      registerPlayEventListener,
      removePlayEventListener,
    } = usePlayContext();
    const myRiderId = useMemo(
      () => users.find((user) => user.isMe)?.pid ?? null,
      [users],
    );
    const myRiderStart = useMemo(
      () => getMyCommuteRiderStart(users),
      [users],
    );
    const [toast, setToast] = useState<string | null>(null);
    const initialAvatarPosition = COMMUTE_JOIN_ENTRY_POSITION;
    const [avatarPosition, setAvatarPosition] =
      useState<CommutePoint>(initialAvatarPosition);
    const [avatarWalking, setAvatarWalking] = useState(false);
    const [hasEnteredCar, setHasEnteredCar] = useState(false);
    const [isArriving, setIsArriving] = useState(false);
    const [portalHolding, setPortalHolding] = useState(false);
    const [arrivingRiderIds, setArrivingRiderIds] = useState(
      () => new Set<string>(),
    );
    const carRef = useRef<HTMLElement | null>(null);
    const hasEnteredCarRef = useRef(false);
    const lastRiderPositions = useRef(new Map<string, CommutePoint>());
    const arrivalTimers = useRef(new Map<string, number>());
    const myRiderIdRef = useRef<string | null>(null);
    const mySeatIdRef = useRef<number | null>(null);
    const toastTimer = useRef<number | undefined>(undefined);
    const positionPublishTimer = useRef<number | undefined>(undefined);
    const positionSequence = useRef(0);
    const pendingPublishedPosition = useRef<CommutePoint>(
      initialAvatarPosition,
    );
    const movementVector = useRef<CommutePoint>({ x: 0, y: 0 });
    const avatarPositionRef = useRef<CommutePoint>(initialAvatarPosition);
    const clickDestination = useRef<CommutePoint | null>(null);
    const pendingSeatId = useRef<number | null>(null);
    const pressedKeys = useRef(new Set<string>());
    const exitPending = useRef(false);
    const portalTimer = useRef<number | undefined>(undefined);
    const exitTrainRef = useRef<(navigateCurrentTab?: boolean) => void>(
      () => {},
    );
    const setMyAwarenessRef = useRef(setMyAwareness);
    setMyAwarenessRef.current = setMyAwareness;
    myRiderIdRef.current = myRiderId;

    const publishPosition = useCallback(
      (seatId: number | null, position: CommutePoint) => {
        positionSequence.current += 1;
        setMyAwarenessRef.current({
          seatId,
          position,
          positionSequence: positionSequence.current,
        });
      },
      [],
    );

    const updateAvatarPosition = useCallback((position: CommutePoint) => {
      avatarPositionRef.current = position;
      setAvatarPosition(position);
      pendingPublishedPosition.current = position;
      if (positionPublishTimer.current !== undefined) return;
      positionPublishTimer.current = window.setTimeout(() => {
        positionPublishTimer.current = undefined;
        publishPosition(null, pendingPublishedPosition.current);
      }, 100);
    }, [publishPosition]);

    const cancelPositionPublish = useCallback(() => {
      if (positionPublishTimer.current === undefined) return;
      window.clearTimeout(positionPublishTimer.current);
      positionPublishTimer.current = undefined;
    }, []);

    const usersById = useMemo(
      () => new Map(users.map((user) => [user.pid, user])),
      [users],
    );

    const ridersBySeat = useMemo(() => {
      const riders = new Map<number, { label?: string; color: string }>();
      for (const [stableId, awareness] of awarenessByStableId) {
        if (awareness.seatId === null) continue;
        const user = usersById.get(stableId);
        riders.set(awareness.seatId, {
          color: user?.color ?? "#5b8db8",
        });
      }
      return riders;
    }, [awarenessByStableId, usersById]);

    const mySeatId = myAwareness?.seatId ?? null;
    mySeatIdRef.current = mySeatId;
    const seatedRiderIds = useMemo(() => {
      const riderIds = new Set<string>();
      for (const [stableId, awareness] of awarenessByStableId) {
        if (awareness.seatId !== null) riderIds.add(stableId);
      }
      return riderIds;
    }, [awarenessByStableId]);

    useEffect(() => {
      if (isLoading) return;

      configureCursors({
        shouldRenderCursor: () => false,
      });

      return () => {
        configureCursors({ shouldRenderCursor: () => true });
      };
    }, [configureCursors, isLoading]);

    const playRemoteArrival = useCallback(
      (riderId: string) => {
        if (riderId === myRiderIdRef.current) return;

        publishPosition(mySeatIdRef.current, avatarPositionRef.current);
        setArrivingRiderIds((current) => new Set([...current, riderId]));
        const existingTimer = arrivalTimers.current.get(riderId);
        if (existingTimer !== undefined) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(() => {
          publishPosition(mySeatIdRef.current, avatarPositionRef.current);
          arrivalTimers.current.delete(riderId);
          setArrivingRiderIds((current) => {
            const next = new Set(current);
            next.delete(riderId);
            return next;
          });
        }, 1_400);
        arrivalTimers.current.set(riderId, timer);
      },
      [publishPosition],
    );

    useEffect(() => {
      if (isLoading) return;
      const listenerId = registerPlayEventListener(
        COMMUTE_RIDER_ARRIVAL_EVENT,
        {
          onEvent: (payload: unknown) => {
            const riderId = getCommuteArrivalRiderId(payload);
            if (riderId !== null) playRemoteArrival(riderId);
          },
        },
      );
      return () => {
        removePlayEventListener(COMMUTE_RIDER_ARRIVAL_EVENT, listenerId);
      };
    }, [
      isLoading,
      playRemoteArrival,
      registerPlayEventListener,
      removePlayEventListener,
    ]);

    useEffect(() => {
      if (
        isLoading ||
        !props.serviceReady ||
        myRiderId === null ||
        myRiderStart === null ||
        hasEnteredCarRef.current
      ) {
        return;
      }
      hasEnteredCarRef.current = true;
      updateAvatarPosition(myRiderStart);
      setHasEnteredCar(true);
      setIsArriving(true);
      dispatchPlayEvent({
        type: COMMUTE_RIDER_ARRIVAL_EVENT,
        eventPayload: { riderId: myRiderId },
      });
    }, [
      dispatchPlayEvent,
      isLoading,
      myRiderId,
      myRiderStart,
      props.serviceReady,
      updateAvatarPosition,
    ]);

    useEffect(() => {
      if (!isArriving) return;
      const timer = window.setTimeout(() => {
        setIsArriving(false);
      }, 1_400);
      return () => window.clearTimeout(timer);
    }, [isArriving]);

    useEffect(
      () => () => {
        for (const timer of arrivalTimers.current.values()) {
          window.clearTimeout(timer);
        }
      },
      [],
    );

    const standingRiders = useMemo(() => {
      const activeRiderIds = new Set<string>();
      const riders: Array<{
        id: string;
        color: string;
        position: CommutePoint;
      }> = [];

      for (const user of users) {
        if (user.isMe || seatedRiderIds.has(user.pid)) continue;
        activeRiderIds.add(user.pid);

        const sharedPosition = getSharedCommutePosition(
          awarenessByStableId.get(user.pid)?.position,
        );
        let position = lastRiderPositions.current.get(user.pid);
        if (sharedPosition) {
          position = sharedPosition;
          lastRiderPositions.current.set(user.pid, sharedPosition);
        }
        position ??= getCommuteRiderStart(user.pid);

        riders.push({
          id: user.pid,
          color: user.color,
          position,
        });
      }

      for (const stableId of lastRiderPositions.current.keys()) {
        if (!activeRiderIds.has(stableId)) {
          lastRiderPositions.current.delete(stableId);
        }
      }

      return riders;
    }, [awarenessByStableId, seatedRiderIds, users]);

    const displayedRiders = useMemo(() => {
      const riders = new Map(ridersBySeat);
      if (mySeatId !== null) {
        riders.set(mySeatId, {
          label: "you",
          color: cursors.color || "#5b8db8",
        });
      }
      return riders;
    }, [cursors.color, mySeatId, ridersBySeat]);

    const occupiedSeatIds = useMemo(
      () => new Set(displayedRiders.keys()),
      [displayedRiders],
    );
    const nearbySeat =
      mobileBoarded && mySeatId === null
        ? findNearbyCommuteSeat(avatarPosition, SEATS, occupiedSeatIds)
        : null;
    useEffect(() => {
      onSeatStateChange(mySeatId !== null);
    }, [mySeatId, onSeatStateChange]);

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

      pendingSeatId.current = null;
      clickDestination.current = null;
      if (mySeatId === seatId) {
        const seat = SEATS.find((candidate) => candidate.id === seatId);
        publishPosition(null, avatarPositionRef.current);
        if (seat) updateAvatarPosition(getStandingPosition(seat));
        return;
      }

      const seat = SEATS.find((candidate) => candidate.id === seatId);
      if (!seat) return;

      if (mySeatId !== null) {
        const currentSeat = SEATS.find(
          (candidate) => candidate.id === mySeatId,
        );
        if (currentSeat) {
          updateAvatarPosition(getStandingPosition(currentSeat));
        }
      }
      publishPosition(null, avatarPositionRef.current);
      pendingSeatId.current = seatId;
      clickDestination.current = getStandingPosition(seat);
      setAvatarWalking(true);
    };

    const moveCursorToClick = (event: React.MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("button")) return;

      const car = carRef.current;
      if (!car) return;
      const bounds = car.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      publishPosition(null, avatarPositionRef.current);
      pendingSeatId.current = null;
      clickDestination.current = getCommutePointFromClient(
        { x: event.clientX, y: event.clientY },
        bounds,
      );
      setAvatarWalking(true);
    };

    const exitTrain = (navigateCurrentTab = false) => {
      if (exitPending.current) return;
      if (props.phase !== "stopped") {
        showToast("the doors are closed — wait for the next stop");
        return;
      }
      if (props.atOrigin) {
        showToast("we haven't left yet — the train departs soon");
        return;
      }

      exitPending.current = true;
      props.onExitStop?.(props.currentStop);
      showToast(`doors open — see you at ${props.currentStop.domain}`);
      window.setTimeout(
        () => {
          if (navigateCurrentTab) {
            window.location.assign(props.currentStop.url);
          } else if (!props.onExitStop) {
            window.open(props.currentStop.url, "_blank", "noopener,noreferrer");
            exitPending.current = false;
          }
        },
        navigateCurrentTab ? 250 : 600,
      );
    };
    exitTrainRef.current = exitTrain;

    const cancelPortal = () => {
      if (portalTimer.current !== undefined) {
        window.clearTimeout(portalTimer.current);
        portalTimer.current = undefined;
      }
      setPortalHolding(false);
    };

    const startPortal = () => {
      if (!props.onTeleport || portalTimer.current !== undefined) return;
      setPortalHolding(true);
      portalTimer.current = window.setTimeout(() => {
        portalTimer.current = undefined;
        setPortalHolding(false);
        props.onTeleport?.();
      }, 2_000);
    };

    const updateMovement = useCallback((vector: CommutePoint) => {
      movementVector.current = vector;
    }, []);

    useEffect(() => {
      if (!mobileBoarded) return;

      const keyMap: Record<string, string> = {
        ArrowLeft: "left",
        a: "left",
        ArrowRight: "right",
        d: "right",
        ArrowUp: "up",
        w: "up",
        ArrowDown: "down",
        s: "down",
      };
      const handleKey = (event: KeyboardEvent) => {
        const direction = keyMap[event.key];
        if (direction) {
          if (event.type === "keydown") {
            pressedKeys.current.add(direction);
          } else {
            pressedKeys.current.delete(direction);
          }
          event.preventDefault();
          return;
        }
      };

      window.addEventListener("keydown", handleKey);
      window.addEventListener("keyup", handleKey);
      return () => {
        pressedKeys.current.clear();
        window.removeEventListener("keydown", handleKey);
        window.removeEventListener("keyup", handleKey);
      };
    }, [mobileBoarded]);

    useEffect(() => {
      let lastFrameTime = performance.now();
      let movementFrame = 0;

      const moveAvatar = (frameTime: number) => {
        const elapsed = Math.min(50, frameTime - lastFrameTime);
        lastFrameTime = frameTime;
        movementFrame = window.requestAnimationFrame(moveAvatar);

        const vector = { ...movementVector.current };
        if (pressedKeys.current.has("left")) vector.x -= 1;
        if (pressedKeys.current.has("right")) vector.x += 1;
        if (pressedKeys.current.has("up")) vector.y -= 1;
        if (pressedKeys.current.has("down")) vector.y += 1;

        const hasManualMovement = Math.hypot(vector.x, vector.y) >= 0.15;
        if (hasManualMovement) {
          pendingSeatId.current = null;
          clickDestination.current = null;
          if (mySeatId !== null) {
            const seat = SEATS.find((candidate) => candidate.id === mySeatId);
            publishPosition(null, avatarPositionRef.current);
            if (seat) updateAvatarPosition(getStandingPosition(seat));
          } else {
            const nextPosition = moveCommuteAvatar(
              avatarPositionRef.current,
              vector,
              COMMUTE_WALK_SPEED * (elapsed / 50),
            );
            updateAvatarPosition(nextPosition);
            if (
              shouldExitCommuteThroughDoor(
                nextPosition,
                vector,
                DOOR_GEOMETRY,
                mobileBoarded && props.phase === "stopped" && !props.atOrigin,
              )
            ) {
              movementVector.current = { x: 0, y: 0 };
              setAvatarWalking(false);
              exitTrainRef.current(true);
              return;
            }
          }
          setAvatarWalking(true);
          return;
        }

        const destination = clickDestination.current;
        if (destination === null) {
          setAvatarWalking(false);
          return;
        }
        if (mySeatId !== null) {
          const seat = SEATS.find((candidate) => candidate.id === mySeatId);
          publishPosition(null, avatarPositionRef.current);
          if (seat) updateAvatarPosition(getStandingPosition(seat));
          setAvatarWalking(true);
          return;
        }

        setAvatarWalking(true);
        const movement = moveCommuteAvatarToward(
          avatarPositionRef.current,
          destination,
          COMMUTE_CLICK_WALK_SPEED * (elapsed / 50),
        );
        updateAvatarPosition(movement.position);
        if (movement.arrived) {
          const seatId = pendingSeatId.current;
          pendingSeatId.current = null;
          clickDestination.current = null;
          setAvatarWalking(false);
          if (seatId !== null) {
            cancelPositionPublish();
            setMyAwarenessRef.current({ seatId });
          }
        }
      };

      movementFrame = window.requestAnimationFrame(moveAvatar);

      return () => window.cancelAnimationFrame(movementFrame);
    }, [
      mobileBoarded,
      cancelPositionPublish,
      mySeatId,
      props.atOrigin,
      props.phase,
      publishPosition,
      updateAvatarPosition,
    ]);

    useEffect(
      () => () => {
        if (positionPublishTimer.current !== undefined) {
          window.clearTimeout(positionPublishTimer.current);
        }
        if (portalTimer.current !== undefined) {
          window.clearTimeout(portalTimer.current);
        }
      },
      [],
    );

    const doorOpen = props.phase === "stopped";
    const canExit = doorOpen && !props.atOrigin;

    return (
      <section id={props.id} className="train-car-wrap" ref={ref}>
        <section
          className={`train-car train-car--${props.phase}`}
          aria-label="Internet commute carriage"
          ref={carRef}
          onClick={moveCursorToClick}
        >
          <span className="train-car__edge train-car__edge--top" />
          <span className="train-car__edge train-car__edge--bottom" />
          <span className="train-car__edge train-car__edge--left" />
          <span className="train-car__edge train-car__edge--right" />
          <span
            className={`train-car__side-door train-car__side-door--left ${
              isArriving ? "train-car__side-door--joining" : ""
            }`}
          />
          <span className="train-car__side-door train-car__side-door--right" />

          {DOORS.map((x) => (
            <TrainDoor
              key={x}
              x={x}
              open={doorOpen}
              canExit={canExit}
              currentStop={props.currentStop}
              onExit={() => exitTrain(props.navigateCurrentTabOnExit)}
            />
          ))}

          {props.onTeleport && (
            <button
              className={`slow-mode-portal ${
                portalHolding ? "slow-mode-portal--holding" : ""
              }`}
              type="button"
              onPointerDown={startPortal}
              onPointerUp={cancelPortal}
              onPointerCancel={cancelPortal}
              onPointerLeave={cancelPortal}
              aria-label="Hold for two seconds to teleport to your destination"
            >
              <span aria-hidden="true" />
              <small>hold to portal</small>
            </button>
          )}

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
              isNearby={nearbySeat?.id === seat.id}
              onSelect={() => chooseSeat(seat.id)}
            />
          ))}

          {standingRiders.map((rider) => (
            <span
              className={`commute-avatar commute-avatar--remote ${
                arrivingRiderIds.has(rider.id)
                  ? "commute-avatar--arriving"
                  : ""
              }`}
              style={{
                left: rider.position.x,
                top: rider.position.y,
              }}
              key={rider.id}
            >
              <CursorRider
                color={rider.color}
                isYou={false}
                ariaLabel="Another rider's cursor is aboard the train"
              />
              {arrivingRiderIds.has(rider.id) && (
                <span className="commute-avatar__arrival-message">
                  joining from the next carriage
                </span>
              )}
            </span>
          ))}

          {mySeatId === null && hasEnteredCar && (
            <span
              className={`commute-avatar ${
                avatarWalking ? "commute-avatar--walking" : ""
              } ${isArriving ? "commute-avatar--arriving" : ""}`}
              style={{
                left: avatarPosition.x,
                top: avatarPosition.y,
              }}
            >
              <CursorRider
                color={cursors.color || "#3d3833"}
                label="you"
                isYou
                ariaLabel="Your cursor is aboard the train"
              />
              {isArriving && (
                <span className="commute-avatar__arrival-message">
                  joining from the next carriage
                </span>
              )}
            </span>
          )}
        </section>
        {toast && (
          <div className="commute-toast" role="status">
            {toast}
          </div>
        )}
        {createPortal(
          <CommuteMobileControls
            boarded={mobileBoarded}
            onBoard={() => {
              pendingSeatId.current = null;
              clickDestination.current = null;
              onMobileBoardStateChange(true);
            }}
            onMove={updateMovement}
          />,
          document.body,
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
  routeComplete,
  waitingForFreshStops,
  slowModePlatformPhase,
}: {
  phase: CommutePhase;
  secondsLeft: number;
  atOrigin: boolean;
  currentStop: CommuteStop;
  hasSeat: boolean;
  routeComplete: boolean;
  waitingForFreshStops: boolean;
  slowModePlatformPhase?: SlowModePlatformPhase;
}) {
  let message: React.ReactNode;
  let mobileMessage: React.ReactNode;
  let aside: React.ReactNode;
  let instruction = "";
  const stopName = getStopDisplayName(currentStop);

  const destinationLabel = (label: string) => (
    <span className="commute-banner__destination">
      <span className="commute-banner__destination-label">{label}</span>
      <StopFavicon stop={currentStop} />
      <span className="commute-banner__domain">{currentStop.domain}</span>
    </span>
  );

  if (routeComplete) {
    if (phase === "riding") {
      message = "route complete — returning home";
      aside = `${secondsLeft}s until home station`;
    } else {
      message = "now arriving at home station";
      aside = "a fresh route is forming";
    }
    instruction =
      "the next train will use new sites — this route will not repeat";
    mobileMessage = phase === "riding" ? "returning home" : "home station";
  } else if (waitingForFreshStops) {
    message = "waiting for a new destination";
    aside = "checking the recent web";
    instruction = "the next train will depart when an unseen stop appears";
    mobileMessage = "waiting for a stop";
  } else if (atOrigin) {
    message = destinationLabel("next train to");
    if (slowModePlatformPhase === "boarding") {
      aside = `doors close in ${secondsLeft}s`;
      instruction = "doors open — stepping in";
      mobileMessage = `${secondsLeft}s · boarding`;
    } else if (slowModePlatformPhase) {
      const arrivalSeconds = secondsLeft - 4;
      aside =
        arrivalSeconds > 1
          ? `arriving in ${arrivalSeconds}s`
          : "now arriving";
      instruction = "the train is pulling in — this is your one beat to bail";
      mobileMessage = `${Math.max(1, arrivalSeconds)}s · arriving`;
    } else {
      aside = `route starts in ${secondsLeft}s`;
      instruction = "click the carriage to move or an empty seat to sit";
      mobileMessage = `${secondsLeft}s · departure`;
    }
  } else if (phase === "stopped") {
    message = `now stopped at ${stopName}`;
    aside = secondsLeft > 0 ? `doors close in ${secondsLeft}s` : "doors are open";
    instruction = `click a door to step off at ${currentStop.domain}`;
    mobileMessage = `stopped · ${secondsLeft}s`;
  } else if (phase === "arriving") {
    message = `now arriving at ${stopName}`;
    aside = `last visited ${formatStopAge(currentStop)} ago`;
    mobileMessage = "arriving";
  } else {
    message = `${secondsLeft} ${
      secondsLeft === 1 ? "second" : "seconds"
    } until next stop`;
    aside = destinationLabel("next stop");
    if (!hasSeat) instruction = "click the carriage to move or a seat to sit";
    mobileMessage = `${secondsLeft}s · next stop`;
  }

  return (
    <>
      <div className="commute-banner" aria-live="polite">
        <span className="commute-line-number">1</span>
        <strong className="commute-banner__message">{message}</strong>
        <strong className="commute-banner__mobile-message">
          {mobileMessage}
        </strong>
        <span className="commute-banner__rule" />
        <span className="commute-banner__aside">{aside}</span>
      </div>
      <p className="commute-instruction">{instruction || "\u00a0"}</p>
    </>
  );
}

function CommuteDebugPanel({
  elapsedSeconds,
  joinedExistingService,
  phase,
  riders,
  routeStatus,
  secondsLeft,
  serviceId,
  stopIndex,
  stops,
  onClose,
}: {
  elapsedSeconds: number;
  joinedExistingService: boolean;
  phase: CommutePhase;
  riders: number;
  routeStatus: RecentRoute["status"];
  secondsLeft: number;
  serviceId: string | undefined;
  stopIndex: number;
  stops: CommuteStop[];
  onClose: () => void;
}) {
  return (
    <aside className="commute-debug" aria-label="Internet commute debug panel">
      <header>
        <strong>commute debug</strong>
        <button type="button" onClick={onClose} aria-label="Close debug panel">
          ×
        </button>
      </header>
      <dl>
        <div>
          <dt>route</dt>
          <dd>{serviceId ?? "forming"}</dd>
        </div>
        <div>
          <dt>clock</dt>
          <dd>
            {elapsedSeconds}s · {phase} · {secondsLeft}s left
          </dd>
        </div>
        <div>
          <dt>source</dt>
          <dd>
            {routeStatus} · {joinedExistingService ? "joined" : "originated"}
          </dd>
        </div>
        <div>
          <dt>riders</dt>
          <dd>{riders}</dd>
        </div>
      </dl>
      <ol>
        {stops.map((stop, index) => (
          <li
            className={
              index === stopIndex ? "commute-debug__stop--current" : ""
            }
            key={`${stop.id}-${index}`}
          >
            <span className="commute-debug__stop-index">{index + 1}</span>
            <StopFavicon stop={stop} />
            <span className="commute-debug__stop-details">
              <strong>{stop.domain}</strong>
            </span>
          </li>
        ))}
      </ol>
      <small>press D twice to toggle</small>
    </aside>
  );
}

function SlowModeProgress({
  destinationDomain,
  destinationStopIndex,
  phase,
  stopIndex,
  stops,
  atOrigin,
}: {
  destinationDomain: string;
  destinationStopIndex: number;
  phase: CommutePhase;
  stopIndex: number;
  stops: CommuteStop[];
  atOrigin: boolean;
}) {
  const completedIndex = atOrigin
    ? -1
    : phase === "stopped"
      ? stopIndex
      : stopIndex - 1;
  const stopsLeft = Math.max(0, destinationStopIndex - completedIndex);

  return (
    <section className="slow-mode-progress" aria-label="Slow Mode route progress">
      <div className="slow-mode-progress__map" aria-hidden="true">
        <span className="slow-mode-progress__origin">origin</span>
        {stops.map((stop, index) => (
          <React.Fragment key={stop.id}>
            <i
              className={index <= completedIndex ? "is-complete" : ""}
            />
            <span
              className={`${index <= completedIndex ? "is-complete" : ""} ${
                index === destinationStopIndex ? "is-destination" : ""
              }`}
              title={stop.domain}
            />
          </React.Fragment>
        ))}
      </div>
      <strong>{stopsLeft} stops until {destinationDomain}</strong>
      <span className="slow-mode-progress__pill">{stopsLeft} stops</span>
    </section>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

function InternetCommute({
  assignment,
  bridgeUnavailable,
  extensionCursorColor,
  ride,
  serverTimeOffsetMs,
}: {
  assignment: CommuteTrainAssignment;
  bridgeUnavailable: boolean;
  extensionCursorColor: string | null;
  ride: HostedSlowModeRide | null;
  serverTimeOffsetMs: number;
}) {
  const riders = useUsers();
  const { cursors } = usePlayContext();
  const cursorColor = (extensionCursorColor ?? cursors.color) || "#3d3833";
  const [debugVisible, setDebugVisible] = useCommuteDebug();
  const recentRoute = useRecentRoute();
  const stops = useMemo(
    () => assignment.stops.map(toCommuteStop),
    [assignment.stops],
  );
  const destinationStopIndex = ride
    ? assignment.stops.findIndex(
        (stop) =>
          stop.kind === "domain" && stop.domain === ride.destinationDomain,
      )
    : -1;
  const destinationStopId =
    destinationStopIndex >= 0 ? stops[destinationStopIndex]?.id : undefined;
  const sceneryStops =
    recentRoute.sceneryStops.length > 0
      ? recentRoute.sceneryStops
      : SAMPLE_STOPS;
  const browsingCount = recentRoute.activePeople;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [hasSeat, setHasSeat] = useState(false);
  const [mobileBoarded, setMobileBoarded] = useState(false);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const previousStopCount = useRef(assignment.stops.length);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (assignment.stops.length <= previousStopCount.current) return;
    previousStopCount.current = assignment.stops.length;
    setRouteNotice("route updated · a new stop joined the line");
    const timer = window.setTimeout(() => setRouteNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [assignment.stops.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      (clockNow + serverTimeOffsetMs - assignment.createdAt) / 1_000,
    ),
  );
  const timing = getCommuteTiming(
    elapsedSeconds,
    stops.length,
    TRAIN_DURATIONS,
  );
  const currentStop = stops[timing.stopIndex];
  const departingOrigin =
    timing.phase === "riding" &&
    elapsedSeconds < TRAIN_DURATIONS.initialPlatformSeconds + DEPARTURE_SECONDS;
  const platformStop =
    timing.departureStopIndex === null
      ? currentStop
      : stops[timing.departureStopIndex];
  const platformAtOrigin = timing.atOrigin || departingOrigin;
  const slowModePlatformPhase =
    ride && timing.atOrigin && !timing.complete
      ? getSlowModePlatformPhase(timing.secondsLeft)
      : undefined;

  const finishSlowModeRide = useCallback(
    (outcome: "arrived" | "teleported" | "left", navigate: boolean) => {
      if (!ride) return;
      reportHostedSlowModeOutcome(ride.rideId, outcome, navigate);
    },
    [ride],
  );

  return (
    <main
      className="commute-page"
      data-train-id={assignment.trainId}
      data-train-started-at={assignment.createdAt}
      data-service-elapsed-seconds={elapsedSeconds}
      data-route-version={assignment.routeVersion}
      onMouseMove={keepCommuteCursorInCar}
      onTouchMove={keepCommuteCursorInCar}
    >
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
        </header>
        <p className="commute-subtitle">a slow train through the recent web</p>

        <CommuteInstallPrompt />

        {bridgeUnavailable && (
          <p className="slow-mode-sharing" role="status">
            Slow Mode connection unavailable · riding the public route
          </p>
        )}

        {ride && destinationStopIndex >= 0 && (
          <SlowModeProgress
            destinationDomain={ride.destinationDomain}
            destinationStopIndex={destinationStopIndex}
            phase={timing.phase}
            stopIndex={timing.stopIndex}
            stops={stops}
            atOrigin={timing.atOrigin}
          />
        )}

        {ride && (
          <p className="slow-mode-sharing">
            {ride.stopVisibility === "private"
              ? "your destination is private · no stop added"
              : `your stop is shared as ${ride.destinationDomain}`}
          </p>
        )}

        {routeNotice && (
          <p className="commute-route-notice" role="status">
            {routeNotice}
          </p>
        )}

        <Banner
          phase={timing.phase}
          secondsLeft={timing.secondsLeft}
          atOrigin={timing.atOrigin}
          currentStop={
            ride && timing.atOrigin && destinationStopIndex >= 0
              ? stops[destinationStopIndex]
              : currentStop
          }
          hasSeat={hasSeat}
          routeComplete={timing.complete}
          waitingForFreshStops={false}
          slowModePlatformPhase={slowModePlatformPhase}
        />

        {ride && timing.atOrigin && (
          <button
            className="slow-mode-teleport"
            type="button"
            onClick={() => finishSlowModeRide("teleported", true)}
          >
            teleport instead →
          </button>
        )}

        {debugVisible && (
          <CommuteDebugPanel
            elapsedSeconds={elapsedSeconds}
            joinedExistingService={assignment.riderCount > 1}
            phase={timing.phase}
            riders={riders.length}
            routeStatus={recentRoute.status}
            secondsLeft={timing.secondsLeft}
            serviceId={assignment.trainId}
            stopIndex={timing.stopIndex}
            stops={stops}
            onClose={() => setDebugVisible(false)}
          />
        )}

        {ride && reducedMotion ? (
          <section className="slow-mode-summary">
            <span>your route</span>
            <h2>{stops.length} stops on this train</h2>
            <ol>
              {stops.map((stop, index) => (
                <li key={stop.id}>
                  <span>{index + 1}</span>
                  <strong>{stop.domain}</strong>
                  {index === destinationStopIndex && <small>your stop</small>}
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => finishSlowModeRide("teleported", true)}
            >
              continue to {ride.destinationDomain} →
            </button>
          </section>
        ) : ride && timing.atOrigin && !timing.complete ? (
          <SlowModePlatformScene
            cursorColor={cursorColor}
            destinationDomain={ride.destinationDomain}
            secondsLeft={timing.secondsLeft}
          />
        ) : (
          <CommuteStage>
            <LandscapeWindow
              currentStop={currentStop}
              platformStop={platformStop}
              phase={timing.phase}
              platformAtOrigin={platformAtOrigin}
              edge="upper"
              stops={sceneryStops}
              stopIndex={timing.stopIndex}
            />
            <CommuteCar
              id="internet-commute-car"
              currentStop={currentStop}
              phase={timing.phase}
              atOrigin={timing.atOrigin}
              serviceReady
              mobileBoarded={mobileBoarded}
              onMobileBoardStateChange={setMobileBoarded}
              onSeatStateChange={setHasSeat}
              navigateCurrentTabOnExit={false}
              onExitStop={
                ride
                  ? (stop) => {
                      if (stop.id === destinationStopId) {
                        finishSlowModeRide("arrived", true);
                        return;
                      }
                      finishSlowModeRide("left", false);
                      window.setTimeout(
                        () => window.location.assign(stop.url),
                        100,
                      );
                    }
                  : undefined
              }
              onTeleport={
                ride
                  ? () => finishSlowModeRide("teleported", true)
                  : undefined
              }
            />
            <LandscapeWindow
              currentStop={currentStop}
              platformStop={platformStop}
              phase={timing.phase}
              platformAtOrigin={platformAtOrigin}
              edge="lower"
              stops={sceneryStops}
              stopIndex={timing.stopIndex}
            />
          </CommuteStage>
        )}

        <div className="commute-counts">
          <strong>
            {assignment.riderCount}/{assignment.capacity} riders on this train
          </strong>
          <span></span>
          <strong>
            {browsingCount} {browsingCount === 1 ? "person" : "people"} browsing
          </strong>
        </div>

        <p className="commute-note">
          {recentRoute.status === "live"
            ? "destinations are recent pages visited by people using the extension"
            : recentRoute.status === "loading"
              ? "finding recent destinations"
              : "recent destinations unavailable — running the preview route"}
        </p>
      </div>
    </main>
  );
}

function CommuteBoardingRoot({
  bridgeUnavailable,
  playerIdentity,
  ride,
}: {
  bridgeUnavailable: boolean;
  playerIdentity: PlayerIdentity | null;
  ride: HostedSlowModeRide | null;
}) {
  const connection = useCommuteTrain(ride);

  if (connection.status === "error") {
    return (
      <main className="commute-page commute-board-status">
        <strong>the next train is delayed</strong>
        <button type="button" onClick={() => window.location.reload()}>
          check the platform again
        </button>
      </main>
    );
  }
  if (!connection.assignment) {
    return (
      <main className="commute-page commute-board-status">
        <strong>finding your train…</strong>
      </main>
    );
  }

  return (
    <PlayProvider
      key={connection.assignment.trainId}
      initOptions={createCommuteInitOptions(
        playerIdentity,
        connection.assignment.trainId,
      )}
    >
      <InternetCommute
        assignment={connection.assignment}
        bridgeUnavailable={bridgeUnavailable}
        extensionCursorColor={
          playerIdentity?.playerStyle.colorPalette[0] ?? null
        }
        ride={ride}
        serverTimeOffsetMs={connection.serverTimeOffsetMs}
      />
    </PlayProvider>
  );
}

function CommuteRoot() {
  const [rootState, setRootState] = useState<
    | {
        bridgeUnavailable: boolean;
        playerIdentity: PlayerIdentity | null;
        ride: HostedSlowModeRide | null;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    const rideId = getHostedSlowModeRideId(window.location.hash);
    Promise.all([
      getPublicPlayerIdentity().catch((error: unknown) => {
        console.warn("[internet commute] cursor identity unavailable:", error);
        return null;
      }),
      rideId ? requestHostedSlowModeRide(rideId) : Promise.resolve(null),
    ]).then(([playerIdentity, ride]) =>
      setRootState({
        bridgeUnavailable: rideId !== null && ride === null,
        playerIdentity,
        ride,
      }),
    );
  }, []);

  if (!rootState) return null;

  return (
    <CommuteBoardingRoot
      bridgeUnavailable={rootState.bridgeUnavailable}
      playerIdentity={rootState.playerIdentity}
      ride={rootState.ride}
    />
  );
}

createRoot(document.getElementById("commute-root")!).render(
  <React.StrictMode>
    <CommuteRoot />
  </React.StrictMode>,
);
