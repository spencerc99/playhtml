// ABOUTME: Shared utility functions for path styling and variations
// ABOUTME: Used by AnimatedTrails and AnimatedNavigation for wobbly/organic line rendering

/**
 * Apply style variations to a path of points
 * Creates organic, chaotic, or smooth variations on the original path
 * 
 * @param points - Array of {x, y} coordinates representing the path
 * @param style - Style to apply: 'straight' | 'smooth' | 'organic' | 'chaotic'
 * @param seed - Seed for consistent randomness
 * @param chaosIntensity - Multiplier for chaos effect (default 1.0)
 * @returns Array of {x, y} coordinates with variations applied
 */
export function applyStyleVariations(
  points: Array<{ x: number; y: number }>,
  style: string,
  seed: number,
  chaosIntensity: number = 1.0,
): Array<{ x: number; y: number }> {
  if (points.length < 2 || style === "straight" || style === "smooth") {
    return points;
  }

  const seededRandom = (i: number, offset: number = 0) => {
    const x = Math.sin(seed + i * 12.9898 + offset * 7.233) * 43758.5453;
    return x - Math.floor(x);
  };

  const variedPoints: Array<{ x: number; y: number }> = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (style === "organic") {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length > 0) {
        const perpX = -dy / length;
        const perpY = dx / length;
        const perpOffset = (seededRandom(i) - 0.5) * 6;

        variedPoints.push({
          x: (p1.x + p2.x) / 2 + perpX * perpOffset,
          y: (p1.y + p2.y) / 2 + perpY * perpOffset,
        });
      }
      variedPoints.push(p2);
    } else if (style === "chaotic") {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const numSubPoints = Math.min(3, Math.ceil(length / 50));

      for (let j = 1; j <= numSubPoints; j++) {
        const t = j / (numSubPoints + 1);
        const baseX = p1.x + dx * t;
        const baseY = p1.y + dy * t;

        const offsetRange = 15 * chaosIntensity;
        const wobble = 8 * chaosIntensity;

        const offsetX = (seededRandom(i * 10 + j, 0) - 0.5) * offsetRange;
        const offsetY = (seededRandom(i * 10 + j, 1) - 0.5) * offsetRange;
        const angle = seededRandom(i * 10 + j, 2) * Math.PI * 2;

        variedPoints.push({
          x: baseX + offsetX + Math.cos(angle) * wobble,
          y: baseY + offsetY + Math.sin(angle) * wobble,
        });
      }
      variedPoints.push(p2);
    }
  }

  return variedPoints;
}

/**
 * Rounds sharp corners in a fixed point-path so a stroke outline drawn over it
 * doesn't self-intersect into a pinched knot at direction reversals. Applied
 * ONCE when a trail's path is built (not per animation frame) so already-drawn
 * ink never shifts and the live drawing head — which interpolates along this
 * fixed path — never lags.
 *
 * Only genuinely sharp vertices are rounded: at each interior point whose turn
 * angle is sharper than `thresholdDeg`, the vertex is replaced by two points
 * pulled back along its incoming/outgoing edges (a chamfer-then-the-corner is
 * gone). Gentle and straight runs are left exactly as-is, so the path keeps
 * hugging the real cursor positions everywhere except the problem corners.
 */
export function roundPathCorners(
  points: Array<{ x: number; y: number }>,
  thresholdDeg: number = 50,
  strength: number = 0.4,
): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;

  const cosThreshold = Math.cos((thresholdDeg * Math.PI) / 180);

  // Fast pre-scan: most trails have no corner sharp enough to round. When that's
  // the case, return the INPUT array unchanged (same reference) so the caller
  // can skip the resample step entirely — no allocation, identical geometry.
  // This keeps the common case as cheap as before the rounding feature existed.
  let hasSharpCorner = false;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    const aLen = Math.hypot(ax, ay);
    const bLen = Math.hypot(bx, by);
    if (aLen === 0 || bLen === 0) continue;
    if ((ax * bx + ay * by) / (aLen * bLen) < cosThreshold) {
      hasSharpCorner = true;
      break;
    }
  }
  if (!hasSharpCorner) return points;

  const out: Array<{ x: number; y: number }> = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];

    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const aLen = Math.hypot(ax, ay);
    const bLen = Math.hypot(bx, by);

    if (aLen === 0 || bLen === 0) {
      out.push(cur);
      continue;
    }

    // cos of the turn angle between incoming and outgoing edges. Near 1 =
    // nearly straight; near -1 = a hairpin reversal.
    const dot = (ax * bx + ay * by) / (aLen * bLen);

    if (dot >= cosThreshold) {
      // Gentle enough — leave the vertex exactly where it is.
      out.push(cur);
      continue;
    }

    // Sharp corner: replace the vertex with two points pulled back toward the
    // neighbours, cutting the corner so the outline can't fold over itself.
    // The sharper the turn (dot → -1), the deeper the cut, so hairpins get
    // rounded enough to stop the outline pinching while gentle kinks barely
    // move. `strength` is the cut at a 90° corner; sharper turns scale up to
    // ~2x, clamped so we never pull past a neighbour.
    const sharpness = (cosThreshold - dot) / (cosThreshold + 1); // 0..1
    const cut = Math.min(0.49, strength * (1 + sharpness));
    out.push({ x: cur.x - ax * cut, y: cur.y - ay * cut });
    out.push({ x: cur.x + bx * cut, y: cur.y + by * cut });
  }

  out.push(points[points.length - 1]);
  return out;
}

/**
 * Resamples a polyline to points spaced evenly by ARC LENGTH, preserving the
 * exact first and last points. The trail animator advances the drawing head by
 * INDEX (progress * pointCount), so if the points are unevenly spaced in
 * distance the head speeds up and slows down — looking like it lags then
 * catches up. Corner-rounding bunches points near corners; running this after
 * it restores constant head speed without changing the path's shape.
 */
export function resampleUniform(
  points: Array<{ x: number; y: number }>,
  count: number,
): Array<{ x: number; y: number }> {
  if (points.length < 2 || count < 2) return points;

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(
      cum[i - 1] +
        Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  const total = cum[cum.length - 1];
  if (total === 0) return points;

  const out: Array<{ x: number; y: number }> = [points[0]];
  let seg = 1;
  for (let k = 1; k < count - 1; k++) {
    const target = (total * k) / (count - 1);
    while (seg < points.length - 1 && cum[seg] < target) seg++;
    const segLen = cum[seg] - cum[seg - 1];
    const t = segLen <= 1e-6 ? 0 : (target - cum[seg - 1]) / segLen;
    out.push({
      x: points[seg - 1].x + (points[seg].x - points[seg - 1].x) * t,
      y: points[seg - 1].y + (points[seg].y - points[seg - 1].y) * t,
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Generate a wobbly cursor path between two points
 * Creates an organic, hand-drawn look for connections
 * 
 * @param source - Source point {x, y}
 * @param target - Target point {x, y}
 * @param seed - Seed for consistent randomness
 * @param intensity - How wobbly the path should be (default 1.0)
 * @returns Array of {x, y} coordinates forming the wobbly path
 */
export function generateWobblyCursorPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  seed: number,
  intensity: number = 1.0,
): Array<{ x: number; y: number }> {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // Number of intermediate points based on distance
  const numPoints = Math.max(3, Math.min(10, Math.ceil(distance / 40)));
  
  const points: Array<{ x: number; y: number }> = [source];
  
  for (let i = 1; i < numPoints; i++) {
    const t = i / numPoints;
    const baseX = source.x + dx * t;
    const baseY = source.y + dy * t;
    
    // Apply chaotic variations using applyStyleVariations logic
    const seededRandom = (offset: number = 0) => {
      const x = Math.sin(seed + i * 12.9898 + offset * 7.233) * 43758.5453;
      return x - Math.floor(x);
    };
    
    const offsetRange = 12 * intensity;
    const wobble = 6 * intensity;
    
    const offsetX = (seededRandom(0) - 0.5) * offsetRange;
    const offsetY = (seededRandom(1) - 0.5) * offsetRange;
    const angle = seededRandom(2) * Math.PI * 2;
    
    points.push({
      x: baseX + offsetX + Math.cos(angle) * wobble,
      y: baseY + offsetY + Math.sin(angle) * wobble,
    });
  }
  
  points.push(target);
  
  return points;
}

/**
 * Hash a string to a number (for consistent coloring/seeding)
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Seeded random number generator for consistent variations
 */
export function seededRandom(seed: number, offset: number = 0): number {
  const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
