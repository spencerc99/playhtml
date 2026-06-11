// ABOUTME: Baked geography for the journeys visualization — timezone→origin and
// ABOUTME: domain→server coordinate lookups, plus equirectangular projection helpers.

export interface GeoPoint {
  lon: number;
  lat: number;
}

// ── Timezone → approximate user origin ────────────────────────────────────────
// The public events expose `meta.tz` (IANA zone) but no precise geo. A zone is a
// coarse but honest stand-in for "roughly where this person is." Unknown zones
// fall back to a deterministic hash placement (see `hashToLand`).
const TZ_COORDS: Record<string, GeoPoint> = {
  "America/New_York": { lon: -74.0, lat: 40.71 },
  "America/Detroit": { lon: -83.05, lat: 42.33 },
  "America/Toronto": { lon: -79.38, lat: 43.65 },
  "America/Chicago": { lon: -87.63, lat: 41.85 },
  "America/Denver": { lon: -104.99, lat: 39.74 },
  "America/Phoenix": { lon: -112.07, lat: 33.45 },
  "America/Los_Angeles": { lon: -118.24, lat: 34.05 },
  "America/Vancouver": { lon: -123.12, lat: 49.28 },
  "America/Mexico_City": { lon: -99.13, lat: 19.43 },
  "America/Sao_Paulo": { lon: -46.63, lat: -23.55 },
  "America/Bogota": { lon: -74.07, lat: 4.71 },
  "America/Argentina/Buenos_Aires": { lon: -58.38, lat: -34.6 },
  "Europe/London": { lon: -0.13, lat: 51.51 },
  "Europe/Dublin": { lon: -6.26, lat: 53.35 },
  "Europe/Lisbon": { lon: -9.14, lat: 38.72 },
  "Europe/Madrid": { lon: -3.7, lat: 40.42 },
  "Europe/Paris": { lon: 2.35, lat: 48.85 },
  "Europe/Amsterdam": { lon: 4.9, lat: 52.37 },
  "Europe/Berlin": { lon: 13.4, lat: 52.52 },
  "Europe/Rome": { lon: 12.5, lat: 41.9 },
  "Europe/Stockholm": { lon: 18.07, lat: 59.33 },
  "Europe/Warsaw": { lon: 21.01, lat: 52.23 },
  "Europe/Istanbul": { lon: 28.98, lat: 41.01 },
  "Europe/Moscow": { lon: 37.62, lat: 55.75 },
  "Africa/Lagos": { lon: 3.39, lat: 6.52 },
  "Africa/Johannesburg": { lon: 28.05, lat: -26.2 },
  "Africa/Cairo": { lon: 31.24, lat: 30.04 },
  "Asia/Dubai": { lon: 55.27, lat: 25.2 },
  "Asia/Kolkata": { lon: 77.21, lat: 28.61 },
  "Asia/Karachi": { lon: 67.0, lat: 24.86 },
  "Asia/Bangkok": { lon: 100.5, lat: 13.76 },
  "Asia/Singapore": { lon: 103.82, lat: 1.35 },
  "Asia/Jakarta": { lon: 106.85, lat: -6.21 },
  "Asia/Hong_Kong": { lon: 114.17, lat: 22.32 },
  "Asia/Shanghai": { lon: 121.47, lat: 31.23 },
  "Asia/Seoul": { lon: 126.98, lat: 37.57 },
  "Asia/Tokyo": { lon: 139.69, lat: 35.69 },
  "Australia/Perth": { lon: 115.86, lat: -31.95 },
  "Australia/Sydney": { lon: 151.21, lat: -33.87 },
  "Pacific/Auckland": { lon: 174.76, lat: -36.85 },
};

export function tzToGeo(tz: string | undefined | null): GeoPoint | null {
  if (!tz) return null;
  if (TZ_COORDS[tz]) return TZ_COORDS[tz];
  // Fall back to the region prefix → pick a representative zone in that region.
  const region = tz.split("/")[0];
  const regionFallback: Record<string, GeoPoint> = {
    America: TZ_COORDS["America/Chicago"],
    Europe: TZ_COORDS["Europe/Berlin"],
    Asia: TZ_COORDS["Asia/Singapore"],
    Africa: TZ_COORDS["Africa/Lagos"],
    Australia: TZ_COORDS["Australia/Sydney"],
    Pacific: TZ_COORDS["Pacific/Auckland"],
  };
  return regionFallback[region] ?? null;
}

// ── Domain → server location ──────────────────────────────────────────────────
// Major cloud regions / datacenter hubs. Known domains map to a plausible region;
// everything else is deterministically hashed onto one of these anchors so the
// destinations cluster realistically rather than scattering at random.
const ANCHORS: Record<string, GeoPoint> = {
  "us-east-ashburn": { lon: -77.49, lat: 39.04 }, // AWS us-east-1, Wikimedia
  "us-east-ohio": { lon: -82.99, lat: 40.06 },
  "us-central-iowa": { lon: -95.86, lat: 41.26 }, // Google Council Bluffs
  "us-west-oregon": { lon: -121.18, lat: 45.6 },
  "us-west-santaclara": { lon: -121.95, lat: 37.37 },
  "eu-dublin": { lon: -6.26, lat: 53.35 },
  "eu-london": { lon: -0.1, lat: 51.51 },
  "eu-frankfurt": { lon: 8.68, lat: 50.11 },
  "eu-amsterdam": { lon: 4.9, lat: 52.37 },
  "asia-singapore": { lon: 103.82, lat: 1.35 },
  "asia-tokyo": { lon: 139.69, lat: 35.69 },
  "asia-mumbai": { lon: 72.88, lat: 19.08 },
  "asia-beijing": { lon: 116.41, lat: 39.9 },
  "asia-hangzhou": { lon: 120.16, lat: 30.29 },
  "sa-saopaulo": { lon: -46.63, lat: -23.55 },
  "au-sydney": { lon: 151.21, lat: -33.87 },
};
const ANCHOR_KEYS = Object.keys(ANCHORS);

const DOMAIN_ANCHOR: Record<string, string> = {
  "google.com": "us-central-iowa",
  "youtube.com": "us-central-iowa",
  "gmail.com": "us-central-iowa",
  "mail.google.com": "us-central-iowa",
  "docs.google.com": "us-central-iowa",
  "wikipedia.org": "us-east-ashburn",
  "en.wikipedia.org": "us-east-ashburn",
  "twitter.com": "us-west-santaclara",
  "x.com": "us-west-santaclara",
  "facebook.com": "us-west-oregon",
  "instagram.com": "us-west-oregon",
  "reddit.com": "us-east-ashburn",
  "amazon.com": "us-east-ashburn",
  "github.com": "us-east-ashburn",
  "stackoverflow.com": "us-east-ashburn",
  "netflix.com": "us-east-ashburn",
  "nytimes.com": "us-east-ashburn",
  "openai.com": "us-east-ashburn",
  "chatgpt.com": "us-east-ashburn",
  "claude.ai": "us-east-ashburn",
  "anthropic.com": "us-east-ashburn",
  "apple.com": "us-west-santaclara",
  "bbc.co.uk": "eu-london",
  "bbc.com": "eu-london",
  "theguardian.com": "eu-london",
  "spotify.com": "eu-frankfurt",
  "booking.com": "eu-amsterdam",
  "baidu.com": "asia-beijing",
  "taobao.com": "asia-hangzhou",
  "alibaba.com": "asia-hangzhou",
  "rakuten.co.jp": "asia-tokyo",
  "naver.com": "asia-tokyo",
  "flipkart.com": "asia-mumbai",
  "mercadolibre.com": "sa-saopaulo",
};

export function domainToGeo(domain: string): { geo: GeoPoint; anchorKey: string } {
  const d = domain.replace(/^www\./, "").toLowerCase();
  let key = DOMAIN_ANCHOR[d];
  if (!key) {
    // Try the registrable-ish suffix (last two labels) for subdomains.
    const parts = d.split(".");
    const base = parts.slice(-2).join(".");
    key = DOMAIN_ANCHOR[base];
  }
  if (!key) {
    key = ANCHOR_KEYS[hashString(d) % ANCHOR_KEYS.length];
  }
  return { geo: ANCHORS[key], anchorKey: key };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function hashString(s: string): number {
  // FNV-1a, returned as a positive 31-bit int.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

const EARTH_R_KM = 6371;
function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Projection (equirectangular) ──────────────────────────────────────────────
// Linear in lon so that "unwrapped" longitudes (outside [-180,180], used to take
// the short way across the antimeridian) project correctly off-canvas; the
// renderer then draws wrap-copies at ±fullWidth.

export interface Projection {
  fullWidth: number; // px spanning a full 360° of longitude
  lonToX: (lon: number) => number;
  latToY: (lat: number) => number;
}

export function makeProjection(w: number, h: number): Projection {
  const padX = w * 0.04;
  // Squeeze vertically: real data clusters in the northern mid-latitudes, and a
  // full -90..90 range wastes space on empty poles.
  const top = h * 0.12;
  const bottom = h * 0.92;
  const fullWidth = w - 2 * padX;
  return {
    fullWidth,
    lonToX: (lon) => padX + ((lon + 180) / 360) * fullWidth,
    // lat 85..-60 mapped into [top, bottom]
    latToY: (lat) => top + ((85 - lat) / (85 - -60)) * (bottom - top),
  };
}
