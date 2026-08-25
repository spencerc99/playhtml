// ABOUTME: Defines shared party data and deterministic interaction rules.
// ABOUTME: Keeps cake, balloon, wish, and workshop updates testable outside React.

export const PARTY_COLORS = [
  "#274b9e",
  "#c0373c",
  "#e8a63a",
  "#7a9574",
  "#ff0099",
] as const;

export const BITE_REQUIREMENT = 6;
export const CAKE_CELL_COUNT = 60;
export const CAKE_COLUMN_COUNT = 10;
export const CAKE_ROW_COUNT = 6;

export interface PartyIdentity {
  pid: string;
  name: string;
  color: string;
}

export interface CakeBite extends PartyIdentity {
  slot: number;
  x: string;
  y: string;
}

export interface CakeCell {
  bitesByParticipant: Record<string, CakeBite>;
}

export interface CakeData {
  cellsByIndex: Record<string, CakeCell>;
}

export interface PartyBalloon {
  id: string;
  by: PartyIdentity;
  createdAt: number;
  seed: number;
  x: number;
  y: number;
  scale: number;
  hue: number;
}

export interface BalloonsData {
  balloonsById: Record<string, PartyBalloon>;
  pinClaimsByIndex: Record<
    string,
    { participantId: string; claimedAt: number }
  >;
}

export type CardPattern = "cross" | "sash" | "polka";

export interface PartyWish extends PartyIdentity {
  id: string;
  note: string;
  cardColor: string;
  sealColor: string;
  pattern: CardPattern;
  when: string;
  where: string;
  createdAt: number;
}

export interface WishesData {
  wishesById: Record<string, PartyWish>;
}

export interface PartyData {
  popperCount: number;
  lastPopperPair: string;
}

export interface PopperAwareness extends PartyIdentity {
  holdingPopper: boolean;
}

export interface BalloonSegment {
  id: string;
  x: number;
  y: number;
  scale: number;
  hue: number;
  length: number;
  rotation: number;
  twists: number;
}

export interface BalloonKnot {
  x: number;
  y: number;
}

export interface BalloonCreation {
  id: string;
  by: PartyIdentity;
  name: string;
  createdAt: number;
  seed: number;
  x: number;
  y: number;
  width: number;
  height: number;
  parts: BalloonSegment[];
  knots: BalloonKnot[];
}

export interface WorkshopData {
  segmentsById: Record<string, BalloonSegment>;
  creationsById: Record<string, BalloonCreation>;
}

export function getCakeCell(
  cellsByIndex: CakeData["cellsByIndex"],
  index: number,
): CakeCell {
  return cellsByIndex[String(index)] ?? { bitesByParticipant: {} };
}

export function isCakeCellFinished(
  cellsByIndex: CakeData["cellsByIndex"],
  index: number,
): boolean {
  return (
    Object.keys(getCakeCell(cellsByIndex, index).bitesByParticipant).length >=
    BITE_REQUIREMENT
  );
}

export function canBiteCakeCell(
  cellsByIndex: CakeData["cellsByIndex"],
  index: number,
): boolean {
  const column = index % CAKE_COLUMN_COUNT;
  const row = Math.floor(index / CAKE_COLUMN_COUNT);
  if (
    column === 0 ||
    column === CAKE_COLUMN_COUNT - 1 ||
    row === 0 ||
    row === CAKE_ROW_COUNT - 1
  ) {
    return true;
  }

  return [
    index - 1,
    index + 1,
    index - CAKE_COLUMN_COUNT,
    index + CAKE_COLUMN_COUNT,
  ].some((neighbor) => isCakeCellFinished(cellsByIndex, neighbor));
}

function getExposedSide(
  cellsByIndex: CakeData["cellsByIndex"],
  index: number,
): "left" | "right" | "top" | "bottom" {
  const column = index % CAKE_COLUMN_COUNT;
  const row = Math.floor(index / CAKE_COLUMN_COUNT);
  if (column === 0 || isCakeCellFinished(cellsByIndex, index - 1))
    return "left";
  if (
    column === CAKE_COLUMN_COUNT - 1 ||
    isCakeCellFinished(cellsByIndex, index + 1)
  ) {
    return "right";
  }
  if (
    row === 0 ||
    isCakeCellFinished(cellsByIndex, index - CAKE_COLUMN_COUNT)
  ) {
    return "top";
  }
  return "bottom";
}

export function getCakeBitePosition(
  cellsByIndex: CakeData["cellsByIndex"],
  index: number,
  clickFraction: number,
): Pick<CakeBite, "slot" | "x" | "y"> {
  const cell = getCakeCell(cellsByIndex, index);
  const takenSlots = new Set(
    Object.values(cell.bitesByParticipant).map((bite) => bite.slot),
  );
  const biteCount = takenSlots.size;
  const rowSlots = biteCount < 3 ? [0, 1, 2] : [3, 4, 5];
  const freeSlots = rowSlots.filter((slot) => !takenSlots.has(slot));
  const clampedFraction = Math.max(0, Math.min(1, clickFraction));
  const slot = (freeSlots.length > 0 ? freeSlots : [biteCount]).sort(
    (a, b) =>
      Math.abs([20, 50, 80][a % 3] - clampedFraction * 100) -
      Math.abs([20, 50, 80][b % 3] - clampedFraction * 100),
  )[0];
  const lateral = [20, 50, 80][slot % 3];
  const depth = slot < 3 ? 8 : 48;
  const side = getExposedSide(cellsByIndex, index);

  if (side === "left") return { slot, x: `${depth}%`, y: `${lateral}%` };
  if (side === "right") {
    return { slot, x: `${100 - depth}%`, y: `${lateral}%` };
  }
  if (side === "top") return { slot, x: `${lateral}%`, y: `${depth}%` };
  return { slot, x: `${lateral}%`, y: `${100 - depth}%` };
}

export function getPlaceFromTimezone(timezone: string): string {
  const city = timezone.split("/").at(-1);
  return city ? city.replaceAll("_", " ").toLowerCase() : "somewhere";
}

export function getCurrentPlace(): string {
  try {
    return getPlaceFromTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "somewhere",
    );
  } catch {
    return "somewhere";
  }
}

function seededWave(seed: number, offset: number): number {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function getDriftPosition(
  seed: number,
  createdAt: number,
  now: number,
  anchorX: number,
  anchorY: number,
  bounds: { width: number; height: number },
): { x: number; y: number; tilt: number } {
  const seconds = Math.max(0, now - createdAt) / 1000;
  const phaseX = seededWave(seed, 1) * Math.PI * 2;
  const phaseY = seededWave(seed, 2) * Math.PI * 2;
  const radiusX = 28 + seededWave(seed, 3) * 54;
  const radiusY = 18 + seededWave(seed, 4) * 38;
  const xWave = Math.sin(seconds / 4.8 + phaseX);
  const yWave = Math.sin(seconds / 3.9 + phaseY);
  const x = Math.max(
    4,
    Math.min(bounds.width - 100, anchorX + xWave * radiusX),
  );
  const y = Math.max(
    80,
    Math.min(bounds.height - 40, anchorY + yWave * radiusY),
  );
  return { x, y, tilt: Math.max(-14, Math.min(14, xWave * 8)) };
}

export function getBalloonKnots(segments: BalloonSegment[]): BalloonKnot[] {
  const knots: BalloonKnot[] = [];
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const a = segments[first];
      const b = segments[second];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const knotDistance = 24 * (a.scale * a.length + b.scale * b.length);
      if (distance < knotDistance) {
        knots.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
  }
  return knots;
}

export function getBalloonLobes(segment: BalloonSegment) {
  const count = segment.twists + 1;
  const height = 58 * segment.scale;
  const totalWidth = 44 * segment.length * segment.scale;
  const width = Math.max(10, totalWidth / count + (count > 1 ? 7 : 0));
  return Array.from({ length: count }, (_, index) => ({
    width,
    height,
    marginLeft: index === 0 ? 0 : -10 * segment.scale,
  }));
}

export function createBalloonCreation(
  segments: BalloonSegment[],
  identity: PartyIdentity,
  name: string,
  position: { x: number; y: number },
  now: number,
  id: string,
  seed: number,
): BalloonCreation {
  if (segments.length === 0) {
    throw new Error("Cannot release an empty balloon creation.");
  }
  const minimumX = Math.min(...segments.map((segment) => segment.x)) - 45;
  const minimumY = Math.min(...segments.map((segment) => segment.y)) - 40;
  const parts = segments.map((segment) => ({
    ...segment,
    x: segment.x - minimumX,
    y: segment.y - minimumY,
  }));
  const knots = getBalloonKnots(segments).map((knot) => ({
    x: knot.x - minimumX,
    y: knot.y - minimumY,
  }));
  return {
    id,
    by: identity,
    name,
    createdAt: now,
    seed,
    x: position.x,
    y: position.y,
    parts,
    knots,
    width: Math.max(...parts.map((part) => part.x)) + 45,
    height: Math.max(...parts.map((part) => part.y)) + 40,
  };
}

export function getFlowerSegments(): BalloonSegment[] {
  const centerX = 230;
  const centerY = 115;
  const petals = Array.from({ length: 6 }, (_, index) => {
    const rotation = index * 60;
    const radians = (rotation * Math.PI) / 180;
    return {
      id: `flower-petal-${index}`,
      x: centerX + Math.cos(radians) * 34,
      y: centerY + Math.sin(radians) * 34,
      scale: 0.55,
      hue: 320,
      length: 1.5,
      rotation,
      twists: 0,
    };
  });
  return petals.concat([
    {
      id: "flower-center",
      x: centerX,
      y: centerY,
      scale: 0.5,
      hue: 40,
      length: 1,
      rotation: 0,
      twists: 0,
    },
    {
      id: "flower-stem",
      x: centerX,
      y: centerY + 92,
      scale: 0.42,
      hue: 110,
      length: 2.8,
      rotation: 90,
      twists: 2,
    },
    {
      id: "flower-leaf",
      x: centerX - 26,
      y: centerY + 112,
      scale: 0.4,
      hue: 110,
      length: 1.4,
      rotation: 40,
      twists: 0,
    },
  ]);
}

export function getDogSegments(): BalloonSegment[] {
  return [
    {
      id: "dog-body",
      x: 210,
      y: 140,
      scale: 0.62,
      hue: 25,
      length: 2.5,
      rotation: 0,
      twists: 3,
    },
    {
      id: "dog-head",
      x: 278,
      y: 106,
      scale: 0.5,
      hue: 25,
      length: 1.3,
      rotation: 40,
      twists: 1,
    },
    {
      id: "dog-ear",
      x: 306,
      y: 76,
      scale: 0.32,
      hue: 25,
      length: 1.2,
      rotation: 110,
      twists: 0,
    },
    {
      id: "dog-leg-one",
      x: 172,
      y: 184,
      scale: 0.45,
      hue: 25,
      length: 1.6,
      rotation: 90,
      twists: 1,
    },
    {
      id: "dog-leg-two",
      x: 248,
      y: 184,
      scale: 0.45,
      hue: 25,
      length: 1.6,
      rotation: 90,
      twists: 1,
    },
    {
      id: "dog-tail",
      x: 138,
      y: 108,
      scale: 0.35,
      hue: 25,
      length: 1.4,
      rotation: -50,
      twists: 0,
    },
  ];
}
