// ABOUTME: Full-tab Internet Commute with shared ephemeral cursor seating.
// ABOUTME: Cycles through recent WWO destinations in a bird's-eye train carriage.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  PlayProvider,
  useCursorZone,
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
import {
  COMMUTE_SERVICE_CHANNEL,
  COMMUTE_SERVICE_DISCOVERY_MS,
  createCommuteService,
  getCommuteServiceDomains,
  getCommuteServiceEndTime,
  getCommuteServicesFromPresences,
  getCommuteStops,
  getUnvisitedCommuteStops,
  selectCommuteService,
  type CommuteService,
  type CommuteServicePresence,
} from "./commuteService";
import {
  DEPARTURE_SECONDS,
  getCommuteTiming,
  INITIAL_PLATFORM_SECONDS,
  type CommutePhase,
} from "./commuteTiming";
import { CommuteInstallPrompt } from "./CommuteInstallPrompt";
import {
  CommuteMobileControls,
  keepCommuteCursorInCar,
  type CommuteMobileAction,
} from "./CommuteMobileControls";
import { CommuteStage } from "./CommuteStage";
import { useCommuteDebug } from "./commuteDebug";
import {
  COMMUTE_CLICK_WALK_SPEED,
  COMMUTE_JOIN_ENTRY_POSITION,
  COMMUTE_WALK_SPEED,
  findNearbyCommuteSeat,
  getCommuteAvatarStart,
  getCommutePointFromClient,
  getCommutePointFromZone,
  getCommuteRiderStart,
  getStandingPosition,
  isNearCommuteDoor,
  moveCommuteAvatar,
  moveCommuteAvatarToward,
  shouldExitCommuteThroughDoor,
  type CommutePoint,
  type CommuteSeatGeometry,
} from "./commuteMobile";
import {
  COMMUTE_BAYS,
  findNearbyCommuteBay,
  getBayStandingPosition,
  type CommuteBay,
} from "./commuteBays";
import { ProceduralLandscape } from "./landscape";
import "./commute.scss";

type CarData = Record<string, never>;

interface RiderAwareness {
  seatId: number | null;
}

interface SeatDefinition extends CommuteSeatGeometry {
  bank: number;
}

interface CommuteCarProps {
  id: string;
  currentStop: CommuteStop;
  phase: CommutePhase;
  atOrigin: boolean;
  isJoining: boolean;
  mobileBoarded: boolean;
  onMobileBoardStateChange: (boarded: boolean) => void;
  onSeatStateChange: (hasSeat: boolean) => void;
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

/** Top-row slots given over to glass — see COMMUTE_BAYS. */
const WINDOW_BAY_SEAT_X = new Set([156, 532, 952]);

const SEATS: SeatDefinition[] = ["top", "bottom"]
  .flatMap((row) =>
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
  )
  .filter((seat) => seat.row !== "top" || !WINDOW_BAY_SEAT_X.has(seat.x));

const DOORS = [276, 696];
const DOOR_GEOMETRY = DOORS.map((x) => ({ x }));
const COMMUTE_REFRESH_MS = 30_000;
const COMMUTE_ROUTE_TIMEOUT_MS = 5_000;

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
        const response = await fetch(COMMUTE_RECENT_URL, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Recent commute request failed: ${response.status}`);
        }

        const commute = parseCommuteResponse(await response.json());
        hasLoadedRoute = true;
        setRoute({
          stops: commute.stops,
          sceneryStops: commute.sceneryStops,
          activePeople: commute.activePeople,
          serverTimeOffsetMs: commute.generatedAt - Date.now(),
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

interface CommuteServiceState {
  joinedExistingService: boolean;
  service: CommuteService | null;
}

interface CommuteServiceConnection extends CommuteServiceState {
  nextStops: CommuteStop[];
}

function useCommuteService(
  availableStops: CommuteStop[],
  routeStatus: RecentRoute["status"],
  serverTimeOffsetMs: number | null,
): CommuteServiceConnection {
  const { presences, setMyPresence, myIdentity } = usePresence<
    typeof COMMUTE_SERVICE_CHANNEL,
    CommuteServicePresence
  >(COMMUTE_SERVICE_CHANNEL);
  const [connection, setConnection] = useState<CommuteServiceState>({
    joinedExistingService: false,
    service: null,
  });
  const [visitedDomains, setVisitedDomains] = useState<string[]>([]);
  const presencesRef = useRef(presences);
  const nextStops = useMemo(
    () => getUnvisitedCommuteStops(availableStops, visitedDomains),
    [availableStops, visitedDomains],
  );

  useEffect(() => {
    presencesRef.current = presences;
  }, [presences]);

  useEffect(() => {
    if (connection.service || !myIdentity) {
      return;
    }

    const discoveryTimer = window.setTimeout(() => {
      const serverNow = Date.now() + (serverTimeOffsetMs ?? 0);
      const visited = new Set(visitedDomains);
      const existingService = selectCommuteService(
        getCommuteServicesFromPresences(presencesRef.current.values()).filter(
          (service) =>
            getCommuteServiceDomains(service).every(
              (domain) => !visited.has(domain),
            ),
        ),
        serverNow,
      );
      if (
        existingService === null &&
        (routeStatus === "loading" || serverTimeOffsetMs === null)
      ) {
        return;
      }
      if (existingService === null && nextStops.length === 0) {
        return;
      }

      const service =
        existingService ??
        createCommuteService(serverNow, myIdentity.publicKey, nextStops);
      const presence: CommuteServicePresence = {
        service,
      };

      setConnection({
        joinedExistingService: existingService !== null,
        service,
      });
      setMyPresence(presence);
    }, COMMUTE_SERVICE_DISCOVERY_MS);

    return () => window.clearTimeout(discoveryTimer);
  }, [
    connection.service,
    myIdentity,
    nextStops,
    routeStatus,
    serverTimeOffsetMs,
    setMyPresence,
    visitedDomains,
  ]);

  const canonicalService = useMemo(() => {
    const visited = new Set(visitedDomains);
    const candidates = getCommuteServicesFromPresences(
      presences.values(),
    ).filter((service) =>
      getCommuteServiceDomains(service).every((domain) => !visited.has(domain)),
    );
    if (connection.service) {
      candidates.push(connection.service);
    }
    return selectCommuteService(
      candidates,
      Date.now() + (serverTimeOffsetMs ?? 0),
    );
  }, [connection.service, presences, serverTimeOffsetMs, visitedDomains]);

  useEffect(() => {
    if (
      !connection.service ||
      !canonicalService ||
      canonicalService.id === connection.service.id
    ) {
      return;
    }

    const presence: CommuteServicePresence = {
      service: canonicalService,
    };
    setConnection({
      joinedExistingService: true,
      service: canonicalService,
    });
    setMyPresence(presence);
  }, [canonicalService, connection.service, setMyPresence]);

  useEffect(() => {
    const service = connection.service;
    if (!service) return;

    const serverNow = Date.now() + (serverTimeOffsetMs ?? 0);
    const delay = Math.max(0, getCommuteServiceEndTime(service) - serverNow);
    const completeService = () => {
      const completedDomains = getCommuteServiceDomains(service);
      setVisitedDomains((current) => [
        ...new Set([...current, ...completedDomains]),
      ]);
      setConnection((current) =>
        current.service?.id === service.id
          ? {
              joinedExistingService: false,
              service: null,
            }
          : current,
      );
      setMyPresence({ service: null });
    };

    const completionTimer = window.setTimeout(completeService, delay);
    return () => window.clearTimeout(completionTimer);
  }, [connection.service, serverTimeOffsetMs, setMyPresence]);

  return {
    ...connection,
    nextStops,
  };
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

function WindowBay({
  bay,
  isNearby,
  onSelect,
}: {
  bay: CommuteBay;
  isNearby: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`window-bay window-bay--${bay.wall} ${
        isNearby ? "window-bay--nearby" : ""
      }`}
      style={{ left: bay.x, width: bay.width }}
      type="button"
      data-bay-id={bay.id}
      aria-label="Wipe the fogged glass"
      onClick={onSelect}
    >
      <span className="window-bay__glass" aria-hidden>
        <svg viewBox="0 0 54 22" preserveAspectRatio="none" aria-hidden>
          <path
            d="M0 14 q14 -7 27 -2 q14 5 27 -3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            opacity="0.55"
          />
        </svg>
      </span>
      <span className="window-bay__sill" aria-hidden />
      <span className="train-seat__prompt window-bay__prompt">
        wipe the glass
      </span>
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
      style={
        {
          "--station-hue": atOrigin ? "#4a9a8a" : currentStop.hue,
        } as React.CSSProperties
      }
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
    const { configureCursors, cursorPresences, cursors, isLoading } =
      usePlayContext();
    const [toast, setToast] = useState<string | null>(null);
    const initialAvatarPosition = getCommuteAvatarStart(props.isJoining);
    const [avatarPosition, setAvatarPosition] =
      useState<CommutePoint>(initialAvatarPosition);
    const [avatarWalking, setAvatarWalking] = useState(false);
    const [showJoiningAnimation, setShowJoiningAnimation] = useState(
      props.isJoining,
    );
    const carRef = useRef<HTMLElement | null>(null);
    const lastRiderPositions = useRef(new Map<string, CommutePoint>());
    const toastTimer = useRef<number | undefined>(undefined);
    const movementVector = useRef<CommutePoint>({ x: 0, y: 0 });
    const avatarPositionRef = useRef<CommutePoint>(initialAvatarPosition);
    const clickDestination = useRef<CommutePoint | null>(null);
    const pendingSeatId = useRef<number | null>(null);
    const pressedKeys = useRef(new Set<string>());
    const mobileActionRef = useRef<CommuteMobileAction | null>(null);
    const exitPending = useRef(false);
    const exitTrainRef = useRef<(navigateCurrentTab?: boolean) => void>(
      () => {},
    );
    const setMyAwarenessRef = useRef(setMyAwareness);
    setMyAwarenessRef.current = setMyAwareness;
    useCursorZone(ref);

    const updateAvatarPosition = useCallback((position: CommutePoint) => {
      avatarPositionRef.current = position;
      setAvatarPosition(position);
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

    useEffect(() => {
      if (!props.isJoining) {
        setShowJoiningAnimation(false);
        return;
      }

      updateAvatarPosition(COMMUTE_JOIN_ENTRY_POSITION);
      setShowJoiningAnimation(true);
      const timer = window.setTimeout(() => {
        setShowJoiningAnimation(false);
      }, 1_400);
      return () => window.clearTimeout(timer);
    }, [props.isJoining, updateAvatarPosition]);

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

        const zone = cursorPresences.get(user.pid)?.zone;
        let position = lastRiderPositions.current.get(user.pid);
        if (zone?.zoneId === props.id) {
          position = getCommutePointFromZone(zone.relX, zone.relY);
          lastRiderPositions.current.set(user.pid, position);
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
    }, [cursorPresences, props.id, seatedRiderIds, users]);

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
    const nearDoor =
      mobileBoarded && isNearCommuteDoor(avatarPosition, DOOR_GEOMETRY);
    const nearbyBay =
      mobileBoarded && mySeatId === null
        ? findNearbyCommuteBay(avatarPosition)
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
        setMyAwareness({ seatId: null });
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
      setMyAwareness({ seatId: null });
      pendingSeatId.current = seatId;
      clickDestination.current = getStandingPosition(seat);
      setAvatarWalking(true);
    };

    const walkToBay = (bay: CommuteBay) => {
      pendingSeatId.current = null;
      setMyAwareness({ seatId: null });
      clickDestination.current = getBayStandingPosition(bay);
      setAvatarWalking(true);
    };

    const moveCursorToClick = (event: React.MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("button")) return;

      const car = carRef.current;
      if (!car) return;
      const bounds = car.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      setMyAwareness({ seatId: null });
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
      showToast(`doors open — see you at ${props.currentStop.domain}`);
      window.setTimeout(
        () => {
          if (navigateCurrentTab) {
            window.location.assign(props.currentStop.url);
          } else {
            window.open(props.currentStop.url, "_blank", "noopener,noreferrer");
            exitPending.current = false;
          }
        },
        navigateCurrentTab ? 250 : 600,
      );
    };
    exitTrainRef.current = exitTrain;

    const standUp = () => {
      if (mySeatId === null) return;
      pendingSeatId.current = null;
      clickDestination.current = null;
      const seat = SEATS.find((candidate) => candidate.id === mySeatId);
      setMyAwareness({ seatId: null });
      setAvatarWalking(false);
      if (seat) updateAvatarPosition(getStandingPosition(seat));
    };

    let mobileAction: CommuteMobileAction | null = null;
    if (mySeatId !== null) {
      mobileAction = {
        label: "stand up",
        tone: "stand",
        onSelect: standUp,
      };
    } else if (nearDoor && props.phase === "stopped" && !props.atOrigin) {
      mobileAction = {
        label: `step off at ${props.currentStop.domain}`,
        tone: "exit",
        onSelect: () => exitTrain(true),
      };
    } else if (nearbySeat) {
      mobileAction = {
        label: "sit down",
        tone: "sit",
        onSelect: () => chooseSeat(nearbySeat.id),
      };
    } else if (nearbyBay) {
      mobileAction = {
        label: "wipe the glass",
        tone: "sit",
        onSelect: () => walkToBay(nearbyBay),
      };
    }
    mobileActionRef.current = mobileAction;

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
        if (
          event.type === "keydown" &&
          (event.key === "Enter" || event.key === " ")
        ) {
          mobileActionRef.current?.onSelect();
          event.preventDefault();
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
            setMyAwarenessRef.current({ seatId: null });
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
          setMyAwarenessRef.current({ seatId: null });
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
            setMyAwarenessRef.current({ seatId });
          }
        }
      };

      movementFrame = window.requestAnimationFrame(moveAvatar);

      return () => window.cancelAnimationFrame(movementFrame);
    }, [
      mobileBoarded,
      mySeatId,
      props.atOrigin,
      props.phase,
      updateAvatarPosition,
    ]);

    useEffect(() => {
      const car = carRef.current;
      if (isLoading || mySeatId !== null || !car) return;

      const bounds = car.getBoundingClientRect();
      if (car.offsetWidth === 0 || car.offsetHeight === 0) return;

      // Feed carriage movement through the cursor client's paced transport so
      // desktop clicks and joystick walking share one presence path.
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX:
            bounds.left + avatarPosition.x * (bounds.width / car.offsetWidth),
          clientY:
            bounds.top + avatarPosition.y * (bounds.height / car.offsetHeight),
        }),
      );
    }, [avatarPosition, isLoading, mySeatId]);

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
              showJoiningAnimation ? "train-car__side-door--joining" : ""
            }`}
          />
          <span className="train-car__side-door train-car__side-door--right" />
          {showJoiningAnimation && (
            <span className="train-joiner" aria-hidden>
              <CursorRider
                color={cursors.color || "#5b8db8"}
                label="you"
                isYou
              />
              <span className="train-joiner__message">
                joining from the next carriage
              </span>
            </span>
          )}

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

          {COMMUTE_BAYS.map((bay) => (
            <WindowBay
              key={bay.id}
              bay={bay}
              isNearby={nearbyBay?.id === bay.id}
              onSelect={() => walkToBay(bay)}
            />
          ))}

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
              className="commute-avatar commute-avatar--remote"
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
            </span>
          ))}

          {mySeatId === null && !showJoiningAnimation && (
            <span
              className={`commute-avatar ${
                avatarWalking ? "commute-avatar--walking" : ""
              }`}
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
            action={mobileAction}
            boarded={mobileBoarded}
            onBoard={() => {
              pendingSeatId.current = null;
              clickDestination.current = null;
              updateAvatarPosition(initialAvatarPosition);
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
}: {
  phase: CommutePhase;
  secondsLeft: number;
  atOrigin: boolean;
  currentStop: CommuteStop;
  hasSeat: boolean;
  routeComplete: boolean;
  waitingForFreshStops: boolean;
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
    aside = `route starts in ${secondsLeft}s`;
    instruction = "click the carriage to move or an empty seat to sit";
    mobileMessage = `${secondsLeft}s · departure`;
  } else if (phase === "stopped") {
    message = `now stopped at ${stopName}`;
    aside = `doors close in ${secondsLeft}s`;
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

function InternetCommute() {
  const riders = useUsers();
  const [debugVisible, setDebugVisible] = useCommuteDebug();
  const recentRoute = useRecentRoute();
  const availableStops =
    recentRoute.status === "live" ? recentRoute.stops : SAMPLE_STOPS;
  const serviceConnection = useCommuteService(
    availableStops,
    recentRoute.status,
    recentRoute.serverTimeOffsetMs,
  );
  const stops = useMemo(
    () =>
      serviceConnection.service
        ? getCommuteStops(serviceConnection.service)
        : serviceConnection.nextStops.length > 0
          ? serviceConnection.nextStops
          : [SAMPLE_STOPS[0]],
    [serviceConnection.nextStops, serviceConnection.service],
  );
  const waitingForFreshStops =
    serviceConnection.service === null &&
    serviceConnection.nextStops.length === 0;
  const sceneryStops =
    recentRoute.sceneryStops.length > 0
      ? recentRoute.sceneryStops
      : SAMPLE_STOPS;
  const browsingCount = recentRoute.activePeople;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [hasSeat, setHasSeat] = useState(false);
  const [mobileBoarded, setMobileBoarded] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = serviceConnection.service
    ? Math.max(
        0,
        Math.floor(
          (clockNow +
            (recentRoute.serverTimeOffsetMs ?? 0) -
            serviceConnection.service.startedAt) /
            1000,
        ),
      )
    : 0;
  const timing = getCommuteTiming(elapsedSeconds, stops.length);
  const currentStop = stops[timing.stopIndex];
  const departingOrigin =
    timing.phase === "riding" &&
    elapsedSeconds < INITIAL_PLATFORM_SECONDS + DEPARTURE_SECONDS;
  const platformStop =
    timing.departureStopIndex === null
      ? currentStop
      : stops[timing.departureStopIndex];
  const platformAtOrigin = timing.atOrigin || departingOrigin;

  return (
    <main
      className="commute-page"
      data-service-id={serviceConnection.service?.id}
      data-service-started-at={serviceConnection.service?.startedAt}
      data-service-elapsed-seconds={elapsedSeconds}
      data-joined-existing-service={serviceConnection.joinedExistingService}
      data-joining-service={
        serviceConnection.joinedExistingService
          ? serviceConnection.service?.id
          : undefined
      }
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

        <Banner
          phase={timing.phase}
          secondsLeft={timing.secondsLeft}
          atOrigin={timing.atOrigin}
          currentStop={currentStop}
          hasSeat={hasSeat}
          routeComplete={timing.complete}
          waitingForFreshStops={waitingForFreshStops}
        />

        {debugVisible && (
          <CommuteDebugPanel
            elapsedSeconds={elapsedSeconds}
            joinedExistingService={serviceConnection.joinedExistingService}
            phase={timing.phase}
            riders={riders.length}
            routeStatus={recentRoute.status}
            secondsLeft={timing.secondsLeft}
            serviceId={serviceConnection.service?.id}
            stopIndex={timing.stopIndex}
            stops={stops}
            onClose={() => setDebugVisible(false)}
          />
        )}

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
            isJoining={serviceConnection.joinedExistingService}
            mobileBoarded={mobileBoarded}
            onMobileBoardStateChange={setMobileBoarded}
            onSeatStateChange={setHasSeat}
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

        <div className="commute-counts">
          <strong>
            {riders.length} {riders.length === 1 ? "person" : "people"} riding
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
