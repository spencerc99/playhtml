// ABOUTME: Calculates rider movement, placement, and nearby train interactions.
// ABOUTME: Keeps carriage geometry independent from React and realtime presence.

export interface CommutePoint {
  x: number;
  y: number;
}

export interface CommuteSeatGeometry extends CommutePoint {
  id: number;
  row: "top" | "bottom";
}

export interface CommuteDoorGeometry {
  x: number;
}

export interface CommuteBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const COMMUTE_CAR_WIDTH = 1100;
export const COMMUTE_CAR_HEIGHT = 360;
export const COMMUTE_AVATAR_START: CommutePoint = { x: 340, y: 70 };
export const COMMUTE_WALK_SPEED = 5.5;
export const COMMUTE_CLICK_WALK_SPEED = 12;

const CAR_MIN_X = 38;
const CAR_MAX_X = 1062;
const CAR_MIN_Y = 32;
const CAR_MAX_Y = 316;
const SEAT_INTERACTION_RADIUS = 55;

export function clampCommuteAvatarPosition(
  position: CommutePoint,
): CommutePoint {
  return {
    x: Math.max(CAR_MIN_X, Math.min(CAR_MAX_X, position.x)),
    y: Math.max(CAR_MIN_Y, Math.min(CAR_MAX_Y, position.y)),
  };
}

export function getCommutePointFromClient(
  point: CommutePoint,
  bounds: CommuteBounds,
): CommutePoint {
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("Internet Commute requires visible carriage bounds");
  }

  return clampCommuteAvatarPosition({
    x: ((point.x - bounds.left) / bounds.width) * COMMUTE_CAR_WIDTH,
    y: ((point.y - bounds.top) / bounds.height) * COMMUTE_CAR_HEIGHT,
  });
}

export function getCommutePointFromZone(
  relativeX: number,
  relativeY: number,
): CommutePoint {
  return clampCommuteAvatarPosition({
    x: relativeX * COMMUTE_CAR_WIDTH,
    y: relativeY * COMMUTE_CAR_HEIGHT,
  });
}

export function getCommuteRiderStart(stableId: string): CommutePoint {
  let hash = 2166136261;
  for (const character of stableId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  const normalizedHash = hash >>> 0;
  return {
    x: 54 + (normalizedHash % 9) * 26,
    y: 126 + (Math.floor(normalizedHash / 9) % 7) * 24,
  };
}

export function moveCommuteAvatar(
  position: CommutePoint,
  vector: CommutePoint,
  speed: number = COMMUTE_WALK_SPEED,
): CommutePoint {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude < 0.15) return position;

  const normalizer = Math.max(1, magnitude);
  return clampCommuteAvatarPosition({
    x: position.x + (vector.x / normalizer) * speed,
    y: position.y + (vector.y / normalizer) * speed,
  });
}

export function moveCommuteAvatarToward(
  position: CommutePoint,
  destination: CommutePoint,
  speed: number = COMMUTE_CLICK_WALK_SPEED,
): { position: CommutePoint; arrived: boolean } {
  const distance = Math.hypot(
    destination.x - position.x,
    destination.y - position.y,
  );
  if (distance <= speed) {
    return {
      position: clampCommuteAvatarPosition(destination),
      arrived: true,
    };
  }

  return {
    position: moveCommuteAvatar(
      position,
      {
        x: (destination.x - position.x) / distance,
        y: (destination.y - position.y) / distance,
      },
      speed,
    ),
    arrived: false,
  };
}

export function findNearbyCommuteSeat(
  position: CommutePoint,
  seats: CommuteSeatGeometry[],
  occupiedSeatIds: ReadonlySet<number>,
): CommuteSeatGeometry | null {
  let nearbySeat: CommuteSeatGeometry | null = null;
  let nearbyDistance = SEAT_INTERACTION_RADIUS;

  for (const seat of seats) {
    if (occupiedSeatIds.has(seat.id)) continue;
    const distance = Math.hypot(
      position.x - (seat.x + 25),
      position.y - (seat.y + 22),
    );
    if (distance >= nearbyDistance) continue;
    nearbyDistance = distance;
    nearbySeat = seat;
  }

  return nearbySeat;
}

export function isNearCommuteDoor(
  position: CommutePoint,
  doors: CommuteDoorGeometry[],
): boolean {
  return doors.some(
    (door) =>
      position.x > door.x - 14 && position.x < door.x + 142 && position.y < 118,
  );
}

export function shouldExitCommuteThroughDoor(
  position: CommutePoint,
  vector: CommutePoint,
  doors: CommuteDoorGeometry[],
  canExit: boolean,
): boolean {
  return canExit && vector.y < -0.15 && isNearCommuteDoor(position, doors);
}

export function getStandingPosition(seat: CommuteSeatGeometry): CommutePoint {
  return {
    x: seat.x + 25,
    y: seat.y + (seat.row === "top" ? 62 : -14),
  };
}
