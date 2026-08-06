// ABOUTME: Calculates local mobile rider movement and nearby train interactions.
// ABOUTME: Keeps joystick geometry independent from React and realtime presence.

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

export const COMMUTE_AVATAR_START: CommutePoint = { x: 340, y: 70 };
export const COMMUTE_WALK_SPEED = 5.5;

const CAR_MIN_X = 38;
const CAR_MAX_X = 1062;
const CAR_MIN_Y = 32;
const CAR_MAX_Y = 316;
const SEAT_INTERACTION_RADIUS = 55;

export function moveCommuteAvatar(
  position: CommutePoint,
  vector: CommutePoint,
  speed: number = COMMUTE_WALK_SPEED,
): CommutePoint {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude < 0.15) return position;

  const normalizer = Math.max(1, magnitude);
  return {
    x: Math.max(
      CAR_MIN_X,
      Math.min(CAR_MAX_X, position.x + (vector.x / normalizer) * speed),
    ),
    y: Math.max(
      CAR_MIN_Y,
      Math.min(CAR_MAX_Y, position.y + (vector.y / normalizer) * speed),
    ),
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

export function getStandingPosition(seat: CommuteSeatGeometry): CommutePoint {
  return {
    x: seat.x + 25,
    y: seat.y + (seat.row === "top" ? 62 : -14),
  };
}
