// ABOUTME: Splits a rectangle into the two polygons on either side of a straight cut.
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
