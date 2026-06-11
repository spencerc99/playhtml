// ABOUTME: Curated real submarine cable routes + a router that snaps a journey
// ABOUTME: (origin→server) onto the most plausible cable corridor when it crosses an ocean.

import { GeoPoint, haversineKm } from "./geo";

export interface Cable {
  name: string;
  // Ordered waypoints: landing → (mid-ocean shaping points) → landing.
  points: GeoPoint[];
}

// ~16 real trunk cables with approximate landing + shaping coordinates. The
// mid-ocean points exist only to give each cable its characteristic curve; the
// endpoints are real landing stations.
export const CABLES: Cable[] = [
  // ── Transatlantic ──
  {
    name: "MAREA",
    points: [
      { lon: -75.98, lat: 36.85 }, // Virginia Beach, US
      { lon: -40, lat: 40 },
      { lon: -2.93, lat: 43.26 }, // Bilbao, ES
    ],
  },
  {
    name: "Grace Hopper",
    points: [
      { lon: -72.87, lat: 40.79 }, // Shirley, NY
      { lon: -38, lat: 47 },
      { lon: -4.55, lat: 50.83 }, // Bude, UK
    ],
  },
  {
    name: "Dunant",
    points: [
      { lon: -75.98, lat: 36.85 }, // Virginia Beach, US
      { lon: -38, lat: 42 },
      { lon: -1.92, lat: 46.72 }, // Saint-Hilaire-de-Riez, FR
    ],
  },
  {
    name: "AEConnect-1",
    points: [
      { lon: -73.5, lat: 40.6 }, // Long Island, NY
      { lon: -42, lat: 50 },
      { lon: -9.92, lat: 51.45 }, // Killala area, IE
    ],
  },
  // ── Transpacific (cross the antimeridian) ──
  {
    name: "JUPITER",
    points: [
      { lon: -118.4, lat: 33.86 }, // Hermosa Beach, US
      { lon: -170, lat: 37 },
      { lon: 139.96, lat: 35.04 }, // Maruyama, JP
    ],
  },
  {
    name: "TPE",
    points: [
      { lon: -123.96, lat: 45.7 }, // Nedonna Beach, OR
      { lon: -175, lat: 43 },
      { lon: 121.82, lat: 24.85 }, // Toucheng, TW
    ],
  },
  {
    name: "Southern Cross NEXT",
    points: [
      { lon: -121.99, lat: 36.95 }, // Monterey, US
      { lon: -157.86, lat: 21.3 }, // Oahu, HI
      { lon: 174.76, lat: -36.85 }, // Auckland, NZ
      { lon: 151.21, lat: -33.87 }, // Sydney, AU
    ],
  },
  // ── Asia ↔ Europe / Middle East ──
  {
    name: "SEA-ME-WE 5",
    points: [
      { lon: 5.36, lat: 43.3 }, // Marseille, FR
      { lon: 32.3, lat: 30.0 }, // Suez, EG
      { lon: 43.0, lat: 12.8 }, // Bab-el-Mandeb
      { lon: 72.88, lat: 19.08 }, // Mumbai, IN
      { lon: 103.82, lat: 1.35 }, // Singapore
    ],
  },
  {
    name: "AAE-1",
    points: [
      { lon: -0.1, lat: 51.51 }, // London, UK
      { lon: 12.5, lat: 41.9 }, // Italy
      { lon: 32.3, lat: 30.0 }, // Suez
      { lon: 55.27, lat: 25.2 }, // Dubai
      { lon: 103.82, lat: 1.35 }, // Singapore
    ],
  },
  // ── Asia regional ──
  {
    name: "ADC",
    points: [
      { lon: 139.96, lat: 35.04 }, // Japan
      { lon: 121.5, lat: 25.0 }, // Taiwan
      { lon: 114.17, lat: 22.32 }, // Hong Kong
      { lon: 103.82, lat: 1.35 }, // Singapore
    ],
  },
  // ── Europe ↔ South America / Africa ──
  {
    name: "EllaLink",
    points: [
      { lon: -8.87, lat: 37.95 }, // Sines, PT
      { lon: -25, lat: 18 },
      { lon: -38.5, lat: -3.73 }, // Fortaleza, BR
    ],
  },
  {
    name: "2Africa (west)",
    points: [
      { lon: -9.14, lat: 38.72 }, // Lisbon, PT
      { lon: -16, lat: 14 },
      { lon: 0, lat: 5 },
      { lon: 13.23, lat: -8.81 }, // Luanda, AO
      { lon: 18.42, lat: -33.92 }, // Cape Town, ZA
    ],
  },
  // ── North ↔ South America ──
  {
    name: "SAC / Globenet",
    points: [
      { lon: -80.1, lat: 26.7 }, // Boca Raton, FL
      { lon: -60, lat: 12 },
      { lon: -38.5, lat: -3.73 }, // Fortaleza, BR
      { lon: -46.63, lat: -23.55 }, // São Paulo, BR
    ],
  },
  {
    name: "Curie",
    points: [
      { lon: -118.4, lat: 33.86 }, // Los Angeles, US
      { lon: -90, lat: 5 },
      { lon: -70.66, lat: -33.46 }, // Valparaíso, CL
    ],
  },
  // ── India ↔ Middle East / Africa ──
  {
    name: "MENA / India",
    points: [
      { lon: 72.88, lat: 19.08 }, // Mumbai, IN
      { lon: 60, lat: 22 },
      { lon: 55.27, lat: 25.2 }, // Dubai
    ],
  },
];

export interface RoutedPath {
  waypoints: GeoPoint[];
  cableName: string | null;
}

// Same-continent / short hops draw directly; anything that plausibly crosses an
// ocean is snapped to the cable whose landings best bracket origin and dest.
const DIRECT_MAX_KM = 2200;
const DETOUR_TOLERANCE = 1.7;

export function routeJourney(origin: GeoPoint, dest: GeoPoint): RoutedPath {
  const direct = haversineKm(origin, dest);
  if (direct < DIRECT_MAX_KM) {
    return { waypoints: [origin, dest], cableName: null };
  }

  let best: { detour: number; path: GeoPoint[]; name: string } | null = null;
  for (const cable of CABLES) {
    const a = cable.points[0];
    const b = cable.points[cable.points.length - 1];
    const cableLen = cableLengthKm(cable.points);

    // Orientation 1: origin→A …cable… B→dest
    const fwd = haversineKm(origin, a) + cableLen + haversineKm(b, dest);
    // Orientation 2: origin→B …cable(reversed)… A→dest
    const rev = haversineKm(origin, b) + cableLen + haversineKm(a, dest);

    const useRev = rev < fwd;
    const detour = useRev ? rev : fwd;
    if (best === null || detour < best.detour) {
      const mid = useRev ? [...cable.points].reverse() : cable.points;
      best = {
        detour,
        name: cable.name,
        path: [origin, ...mid, dest],
      };
    }
  }

  if (best && best.detour <= direct * DETOUR_TOLERANCE) {
    return { waypoints: best.path, cableName: best.name };
  }
  return { waypoints: [origin, dest], cableName: null };
}

function cableLengthKm(points: GeoPoint[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}
