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
