// ABOUTME: Builds straight, organic, and pixel-stepped tear polygons across rectangles.
// ABOUTME: Keeps pointer geometry independent from DOM rendering so it can be tested precisely.

export interface Point {
  x: number;
  y: number;
}

export interface RectangleCut {
  first: Point[];
  second: Point[];
  normal: Point;
}

export type CutStyle = "paper" | "cloth" | "pixel";

export interface RectangleTear extends RectangleCut {
  tear: Point[];
}

const EPSILON = 0.0001;

function sideOfLine(point: Point, start: Point, end: Point): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function clipPolygon(
  polygon: Point[],
  start: Point,
  end: Point,
  keepPositive: boolean,
): Point[] {
  const output: Point[] = [];
  const isInside = (side: number) =>
    keepPositive ? side >= -EPSILON : side <= EPSILON;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentSide = sideOfLine(current, start, end);
    const previousSide = sideOfLine(previous, start, end);
    const currentInside = isInside(currentSide);
    const previousInside = isInside(previousSide);

    if (currentInside !== previousInside) {
      const denominator = previousSide - currentSide;
      if (Math.abs(denominator) > EPSILON) {
        const ratio = previousSide / denominator;
        output.push({
          x: previous.x + (current.x - previous.x) * ratio,
          y: previous.y + (current.y - previous.y) * ratio,
        });
      }
    }

    if (currentInside) output.push(current);
  }

  return output;
}

function polygonArea(polygon: Point[]): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function lineRectangleIntersections(
  width: number,
  height: number,
  start: Point,
  end: Point,
): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const candidates: Array<{ point: Point; t: number }> = [];

  const add = (x: number, y: number, t: number) => {
    if (
      x >= -EPSILON &&
      x <= width + EPSILON &&
      y >= -EPSILON &&
      y <= height + EPSILON
    ) {
      candidates.push({
        point: {
          x: Math.max(0, Math.min(width, x)),
          y: Math.max(0, Math.min(height, y)),
        },
        t,
      });
    }
  };

  if (Math.abs(dx) > EPSILON) {
    let t = -start.x / dx;
    add(0, start.y + t * dy, t);
    t = (width - start.x) / dx;
    add(width, start.y + t * dy, t);
  }
  if (Math.abs(dy) > EPSILON) {
    let t = -start.y / dy;
    add(start.x + t * dx, 0, t);
    t = (height - start.y) / dy;
    add(start.x + t * dx, height, t);
  }

  candidates.sort((a, b) => a.t - b.t);
  const unique = candidates.filter(
    (candidate, index) =>
      index === 0 ||
      Math.hypot(
        candidate.point.x - candidates[index - 1].point.x,
        candidate.point.y - candidates[index - 1].point.y,
      ) > EPSILON,
  );
  if (unique.length < 2) return [];
  return [unique[0].point, unique[unique.length - 1].point];
}

function perimeterPosition(point: Point, width: number, height: number): number {
  if (Math.abs(point.y) <= EPSILON) return point.x;
  if (Math.abs(point.x - width) <= EPSILON) return width + point.y;
  if (Math.abs(point.y - height) <= EPSILON) {
    return width + height + (width - point.x);
  }
  return width * 2 + height + (height - point.y);
}

function clockwiseBoundary(
  from: Point,
  to: Point,
  width: number,
  height: number,
): Point[] {
  const perimeter = 2 * (width + height);
  const start = perimeterPosition(from, width, height);
  let end = perimeterPosition(to, width, height);
  if (end <= start + EPSILON) end += perimeter;

  const corners = [
    { position: 0, point: { x: 0, y: 0 } },
    { position: width, point: { x: width, y: 0 } },
    { position: width + height, point: { x: width, y: height } },
    { position: width * 2 + height, point: { x: 0, y: height } },
  ];
  const route = [from];
  for (let lap = 0; lap <= 1; lap += 1) {
    for (const corner of corners) {
      const position = corner.position + lap * perimeter;
      if (position > start + EPSILON && position < end - EPSILON) {
        route.push(corner.point);
      }
    }
  }
  route.push(to);
  return route;
}

function organicTearPath(
  from: Point,
  to: Point,
  normal: Point,
  width: number,
  height: number,
  style: Exclude<CutStyle, "pixel">,
  seed: number,
): Point[] {
  const random = seededRandom(seed);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = style === "cloth" ? 18 : 11;
  const segments = Math.max(5, Math.min(28, Math.ceil(length / spacing)));
  const amplitude = style === "cloth" ? 3.5 : 6.5;

  return Array.from({ length: segments + 1 }, (_, index) => {
    const progress = index / segments;
    if (index === 0) return from;
    if (index === segments) return to;
    const envelope = Math.sin(progress * Math.PI);
    const noise = (random() * 2 - 1) * amplitude;
    const wave = style === "cloth" ? Math.sin(progress * Math.PI * 4) * 1.8 : 0;
    const offset = (noise + wave) * envelope;
    return {
      x: Math.max(0, Math.min(width, from.x + (to.x - from.x) * progress + normal.x * offset)),
      y: Math.max(0, Math.min(height, from.y + (to.y - from.y) * progress + normal.y * offset)),
    };
  });
}

function pixelTearPath(
  from: Point,
  to: Point,
  normal: Point,
  width: number,
  height: number,
  seed: number,
): Point[] {
  const random = seededRandom(seed);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const segments = Math.max(4, Math.min(20, Math.ceil(length / 14)));
  const anchors: Point[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    if (index === 0) {
      anchors.push(from);
      continue;
    }
    if (index === segments) {
      anchors.push(to);
      continue;
    }
    const offset = Math.round((random() * 2 - 1) * 1.5) * 4;
    anchors.push({
      x: Math.max(
        0,
        Math.min(
          width,
          Math.round(
            (from.x + (to.x - from.x) * progress + normal.x * offset) / 4,
          ) * 4,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          height,
          Math.round(
            (from.y + (to.y - from.y) * progress + normal.y * offset) / 4,
          ) * 4,
        ),
      ),
    });
  }

  const path = [anchors[0]];
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = path[path.length - 1];
    const next = anchors[index];
    if (Math.abs(next.x - previous.x) >= Math.abs(next.y - previous.y)) {
      path.push({ x: next.x, y: previous.y });
    } else {
      path.push({ x: previous.x, y: next.y });
    }
    path.push(next);
  }
  return path.filter(
    (point, index) =>
      index === 0 ||
      point.x !== path[index - 1].x ||
      point.y !== path[index - 1].y,
  );
}

export function cutRectangle(
  width: number,
  height: number,
  start: Point,
  end: Point,
): RectangleCut | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON || width <= 0 || height <= 0) return null;

  const rectangle = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const first = clipPolygon(rectangle, start, end, true);
  const second = clipPolygon(rectangle, start, end, false);

  if (polygonArea(first) < 1 || polygonArea(second) < 1) return null;

  return {
    first,
    second,
    normal: { x: -dy / length, y: dx / length },
  };
}

export function tearRectangle(
  width: number,
  height: number,
  start: Point,
  end: Point,
  style: CutStyle,
  seed: number,
): RectangleTear | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON || width <= 0 || height <= 0) return null;

  const intersections = lineRectangleIntersections(width, height, start, end);
  if (intersections.length !== 2) return null;
  const normal = { x: -dy / length, y: dx / length };
  const tear =
    style === "pixel"
      ? pixelTearPath(intersections[0], intersections[1], normal, width, height, seed)
      : organicTearPath(
          intersections[0],
          intersections[1],
          normal,
          width,
          height,
          style,
          seed,
        );

  const first = [
    ...tear,
    ...clockwiseBoundary(
      tear[tear.length - 1],
      tear[0],
      width,
      height,
    ).slice(1),
  ];
  const reversedTear = [...tear].reverse();
  const second = [
    ...reversedTear,
    ...clockwiseBoundary(
      reversedTear[reversedTear.length - 1],
      reversedTear[0],
      width,
      height,
    ).slice(1),
  ];

  if (polygonArea(first) < 1 || polygonArea(second) < 1) return null;
  return { first, second, normal, tear };
}

export function polygonClipPath(
  polygon: Point[],
  width: number,
  height: number,
): string {
  const points = polygon.map(
    ({ x, y }) => `${(x / width) * 100}% ${(y / height) * 100}%`,
  );
  return `polygon(${points.join(", ")})`;
}
