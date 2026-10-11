// ABOUTME: The versioned format of a collage shared as a public, view-only link, and its strict parser.
// ABOUTME: Shared by the extension (which builds it), the Worker (which stores it) and the viewer page.

/**
 * A shared collage is a frozen copy of a studio collage: its frame, paper and
 * piece geometry, and for every piece the page it came from. Each piece draws
 * exactly one uploaded picture, named `img/<n>`, served next to the collage.
 *
 * Every piece is a picture, whatever kind of scrap it was. Buttons, headings,
 * icons and cursors are rasterized by the studio before upload, so the public
 * viewer never renders markup captured from other sites (or forged by whoever
 * uploads), and cut-out pictures arrive already cut.
 */
export const SHARED_COLLAGE_FORMAT = "wwo-shared-collage";
export const SHARED_COLLAGE_VERSION = 1;

/** Where a shared collage is opened. */
export const SHARED_COLLAGE_VIEWER_ORIGIN = "https://wewere.online";

export const SHARED_COLLAGE_LIMITS = {
  maxPieces: 300,
  maxImages: 300,
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalImageBytes: 40 * 1024 * 1024,
  /** The collage JSON on its own, without any pictures. */
  maxCollageJsonBytes: 512 * 1024,
  maxTitleLength: 200,
  maxPageTitleLength: 500,
  maxUrlLength: 2048,
  maxDomainLength: 253,
  maxAltLength: 1000,
  minFrameSide: 50,
  maxFrameSide: 5000,
  /** How far a piece may sit outside its frame, in frame units. */
  maxCoordinate: 100_000,
} as const;

/** Picture types a shared collage may carry. SVG is left out: it can script. */
export const SHARED_COLLAGE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export type SharedCollageImageType =
  (typeof SHARED_COLLAGE_IMAGE_TYPES)[number];

export const SHARED_SCRAP_KINDS = [
  "image",
  "button",
  "svg-icon",
  "heading",
  "cursor",
] as const;

export type SharedScrapKind = (typeof SHARED_SCRAP_KINDS)[number];

/** A rectangle as fractions of a piece's whole source box. */
export interface SharedFraction {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a piece came from, as the scrap recorded it. */
export interface SharedPieceSource {
  kind: SharedScrapKind;
  pageUrl: string;
  pageTitle: string;
  domain: string;
  /** When the scrap was collected, in epoch milliseconds. */
  ts: number;
  faviconUrl?: string;
  /** The picture's alt text, or the words of a button or heading. */
  alt?: string;
  /** The picture's own size, for an image scrap that recorded it. */
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface SharedCollagePiece {
  /** Visible box in frame coordinates, after the crop is applied. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  crop: SharedFraction;
  flipX: boolean;
  flipY: boolean;
  /** The uploaded picture this piece draws, as `img/<n>`. */
  image: string;
  /**
   * Where the picture sits inside the source box, when it covers only part of
   * it, as a baked cutout of the cropped region does. Absent means the picture
   * fills the whole source box.
   */
  placement?: SharedFraction;
  /** Whether the picture had its background removed before upload. */
  cutout?: true;
  source: SharedPieceSource;
}

export interface SharedCollage {
  format: typeof SHARED_COLLAGE_FORMAT;
  version: typeof SHARED_COLLAGE_VERSION;
  title: string;
  frame: { width: number; height: number };
  paper: { color: string; grain: boolean };
  pieces: SharedCollagePiece[];
  /** Set by the Worker when it stores the collage. */
  sharedAt?: number;
}

/** What the Worker answers a successful share with. */
export interface SharedCollageCreated {
  id: string;
  deleteToken: string;
  url: string;
}

/** A shared collage that cannot be read, with the reason it names. */
export class SharedCollageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedCollageError";
  }
}

/** Ids are 128 random bits written as unpadded base64url. */
export const SHARED_COLLAGE_ID = /^[A-Za-z0-9_-]{22}$/;

const IMAGE_REF = /^img\/(0|[1-9][0-9]{0,2})$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isSharedCollageId(value: unknown): value is string {
  return typeof value === "string" && SHARED_COLLAGE_ID.test(value);
}

/** The `img/<n>` name of the picture at index `n`. */
export function sharedImageRef(index: number): string {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= SHARED_COLLAGE_LIMITS.maxImages
  ) {
    throw new SharedCollageError(`picture index ${index} is out of range`);
  }
  return `img/${index}`;
}

/** The index an `img/<n>` name points at, or null when it is not one. */
export function sharedImageIndex(ref: string): number | null {
  const match = IMAGE_REF.exec(ref);
  if (!match) return null;
  const index = Number(match[1]);
  return index < SHARED_COLLAGE_LIMITS.maxImages ? index : null;
}

export function isSharedCollageImageType(
  value: unknown,
): value is SharedCollageImageType {
  return (
    typeof value === "string" &&
    (SHARED_COLLAGE_IMAGE_TYPES as readonly string[]).includes(value)
  );
}

/** The page a shared collage is viewed on. */
export function sharedCollageViewerUrl(
  id: string,
  origin: string = SHARED_COLLAGE_VIEWER_ORIGIN,
): string {
  return `${origin.replace(/\/+$/, "")}/collage/?id=${encodeURIComponent(id)}`;
}

/**
 * A plain web address, or null. Stored URLs end up as links and favicons on a
 * public page, so a `javascript:` or `data:` value is never accepted.
 */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > SHARED_COLLAGE_LIMITS.maxUrlLength) return null;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new SharedCollageError(message);
}

function finite(
  source: Record<string, unknown>,
  key: string,
  where: string,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${where} is missing a numeric ${key}`);
  }
  return value;
}

function bounded(
  source: Record<string, unknown>,
  key: string,
  where: string,
  min: number,
  max: number,
): number {
  const value = finite(source, key, where);
  if (value < min || value > max)
    fail(`${where} has ${key} ${value} outside ${min}..${max}`);
  return value;
}

function positive(
  source: Record<string, unknown>,
  key: string,
  where: string,
  max: number,
): number {
  const value = finite(source, key, where);
  if (value <= 0 || value > max)
    fail(`${where} has a ${key} that is not between 0 and ${max}`);
  return value;
}

function bool(
  source: Record<string, unknown>,
  key: string,
  where: string,
): boolean {
  const value = source[key];
  if (typeof value !== "boolean") fail(`${where} is missing a boolean ${key}`);
  return value;
}

function text(
  source: Record<string, unknown>,
  key: string,
  where: string,
  maxLength: number,
): string {
  const value = source[key];
  if (typeof value !== "string") fail(`${where} is missing ${key}`);
  if (value.length > maxLength)
    fail(`${where} has a ${key} longer than ${maxLength}`);
  return value;
}

function optionalText(
  source: Record<string, unknown>,
  key: string,
  where: string,
  maxLength: number,
): string | undefined {
  if (source[key] === undefined) return undefined;
  return text(source, key, where, maxLength);
}

/** A crop or placement: a rectangle with area, near the unit square. */
function fraction(value: unknown, where: string): SharedFraction {
  if (!isPlainObject(value)) fail(`${where} is not a rectangle`);
  return {
    x: bounded(value, "x", where, -1, 2),
    y: bounded(value, "y", where, -1, 2),
    width: positive(value, "width", where, 2),
    height: positive(value, "height", where, 2),
  };
}

function parseSource(value: unknown, where: string): SharedPieceSource {
  if (!isPlainObject(value)) fail(`${where} has no source`);
  const at = `${where} source`;
  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !(SHARED_SCRAP_KINDS as readonly string[]).includes(kind)
  ) {
    fail(`${at} has an unknown kind: ${String(kind)}`);
  }
  const pageUrl = text(
    value,
    "pageUrl",
    at,
    SHARED_COLLAGE_LIMITS.maxUrlLength,
  );
  if (pageUrl !== "" && webUrl(pageUrl) === null)
    fail(`${at} page is not a web address`);
  const source: SharedPieceSource = {
    kind: kind as SharedScrapKind,
    pageUrl,
    pageTitle: text(
      value,
      "pageTitle",
      at,
      SHARED_COLLAGE_LIMITS.maxPageTitleLength,
    ),
    domain: text(value, "domain", at, SHARED_COLLAGE_LIMITS.maxDomainLength),
    ts: bounded(value, "ts", at, 0, 8.64e15),
  };
  if (value.faviconUrl !== undefined) {
    const favicon = webUrl(value.faviconUrl);
    if (favicon === null) fail(`${at} favicon is not a web address`);
    source.faviconUrl = favicon;
  }
  const alt = optionalText(
    value,
    "alt",
    at,
    SHARED_COLLAGE_LIMITS.maxAltLength,
  );
  if (alt !== undefined) source.alt = alt;
  if (value.naturalWidth !== undefined || value.naturalHeight !== undefined) {
    source.naturalWidth = positive(value, "naturalWidth", at, 1_000_000);
    source.naturalHeight = positive(value, "naturalHeight", at, 1_000_000);
  }
  return source;
}

function parsePiece(value: unknown, index: number): SharedCollagePiece {
  const where = `piece ${index}`;
  if (!isPlainObject(value)) fail(`${where} is not an object`);
  const limit = SHARED_COLLAGE_LIMITS.maxCoordinate;
  const image = value.image;
  if (typeof image !== "string" || sharedImageIndex(image) === null) {
    fail(`${where} names no picture`);
  }
  const piece: SharedCollagePiece = {
    x: bounded(value, "x", where, -limit, limit),
    y: bounded(value, "y", where, -limit, limit),
    width: positive(value, "width", where, limit),
    height: positive(value, "height", where, limit),
    rotation: bounded(value, "rotation", where, -36_000, 36_000),
    z: bounded(value, "z", where, -1_000_000, 1_000_000),
    crop: fraction(value.crop, `${where} crop`),
    flipX: bool(value, "flipX", where),
    flipY: bool(value, "flipY", where),
    image,
    source: parseSource(value.source, where),
  };
  if (value.placement !== undefined) {
    piece.placement = fraction(value.placement, `${where} placement`);
  }
  if (value.cutout !== undefined) {
    if (value.cutout !== true) fail(`${where} cutout is not true`);
    piece.cutout = true;
  }
  return piece;
}

/**
 * Reads a shared collage, rejecting anything that is not exactly this format.
 * Only the known fields are carried into the result, so what gets stored or
 * drawn is what was checked, never extra fields that rode along.
 */
export function parseSharedCollage(value: unknown): SharedCollage {
  if (!isPlainObject(value)) fail("it is not a collage");
  if (value.format !== SHARED_COLLAGE_FORMAT)
    fail("it is not a shared collage");
  if (value.version !== SHARED_COLLAGE_VERSION) {
    fail(
      `it is a version ${String(value.version)} shared collage, and this reads version ${SHARED_COLLAGE_VERSION}`,
    );
  }
  const frame = value.frame;
  if (!isPlainObject(frame)) fail("it has no frame");
  const { minFrameSide, maxFrameSide } = SHARED_COLLAGE_LIMITS;
  const paper = value.paper;
  if (!isPlainObject(paper)) fail("it has no paper");
  if (typeof paper.color !== "string" || !HEX_COLOR.test(paper.color)) {
    fail("its paper is not a hex color");
  }
  if (!Array.isArray(value.pieces)) fail("it has no pieces");
  if (value.pieces.length === 0) fail("it has no pieces");
  if (value.pieces.length > SHARED_COLLAGE_LIMITS.maxPieces) {
    fail(`it has more than ${SHARED_COLLAGE_LIMITS.maxPieces} pieces`);
  }
  const collage: SharedCollage = {
    format: SHARED_COLLAGE_FORMAT,
    version: SHARED_COLLAGE_VERSION,
    title: text(
      value,
      "title",
      "the collage",
      SHARED_COLLAGE_LIMITS.maxTitleLength,
    ),
    frame: {
      width: bounded(frame, "width", "the frame", minFrameSide, maxFrameSide),
      height: bounded(frame, "height", "the frame", minFrameSide, maxFrameSide),
    },
    paper: {
      color: paper.color.toLowerCase(),
      grain: bool(paper, "grain", "the paper"),
    },
    pieces: value.pieces.map(parsePiece),
  };
  if (value.sharedAt !== undefined) {
    collage.sharedAt = bounded(value, "sharedAt", "the collage", 0, 8.64e15);
  }
  return collage;
}

/**
 * The picture indexes a collage draws, in order. They must run 0..n-1 with no
 * gaps, so every uploaded picture is used and every piece's picture exists.
 */
export function sharedImageIndexes(collage: SharedCollage): number[] {
  const used = new Set<number>();
  for (const piece of collage.pieces) {
    const index = sharedImageIndex(piece.image);
    if (index === null) fail(`a piece names no picture: ${piece.image}`);
    used.add(index);
  }
  const sorted = [...used].sort((a, b) => a - b);
  sorted.forEach((index, at) => {
    if (index !== at) fail(`picture img/${at} is never drawn, or missing`);
  });
  return sorted;
}

/**
 * The picture type its first bytes say it is, or null when they are not one
 * the format carries. The upload's own claimed type is never trusted.
 */
export function sniffSharedImageType(
  bytes: Uint8Array,
): SharedCollageImageType | null {
  const starts = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, at) => bytes[offset + at] === byte);
  const ascii = (word: string, offset: number) =>
    starts(
      [...word].map((char) => char.charCodeAt(0)),
      offset,
    );
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii("GIF87a", 0) || ascii("GIF89a", 0)) return "image/gif";
  if (ascii("RIFF", 0) && ascii("WEBP", 8)) return "image/webp";
  if (ascii("ftyp", 4) && (ascii("avif", 8) || ascii("avis", 8)))
    return "image/avif";
  return null;
}
