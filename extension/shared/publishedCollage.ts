// ABOUTME: The versioned format of a collage shared as a public, view-only link, and its strict parser.
// ABOUTME: Shared by the extension (which builds it), the Worker (which stores it) and the viewer page.

/**
 * A published collage is a frozen copy of a studio collage: its frame, paper
 * and piece geometry, and for every piece the page it came from. A piece draws
 * either one uploaded picture, named `img/<n>` and served next to the collage,
 * or the words and markup it was captured as.
 *
 * Images and cursors are pictures; cut-out images arrive already cut. Buttons,
 * headings and icons keep their captured text, styles and inline SVG, so the
 * viewer can set them as live HTML the way the studio does. That markup came
 * from other sites, and whoever uploads can forge it, so this parser only
 * checks its shape and size: the viewer sanitizes it again every time it
 * renders, and never trusts what was stored.
 */
export const PUBLISHED_COLLAGE_FORMAT = "wwo-published-collage";
export const PUBLISHED_COLLAGE_VERSION = 1;

/** Where a shared collage is opened. */
export const PUBLISHED_COLLAGE_VIEWER_ORIGIN = "https://wewere.online";

export const PUBLISHED_COLLAGE_LIMITS = {
  maxPieces: 300,
  maxImages: 300,
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalImageBytes: 40 * 1024 * 1024,
  /** The collage JSON on its own, without any pictures. */
  maxCollageJsonBytes: 4 * 1024 * 1024,
  /** One piece's words, styles and markup, measured as JSON. */
  maxContentBytes: 64 * 1024,
  /** The words of a button or heading. */
  maxContentTextLength: 2000,
  /** One captured style value. */
  maxStyleValueLength: 500,
  maxTitleLength: 200,
  /** The name a collage is signed with. */
  maxSignatureNameLength: 60,
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
export const PUBLISHED_COLLAGE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export type PublishedCollageImageType =
  (typeof PUBLISHED_COLLAGE_IMAGE_TYPES)[number];

export const PUBLISHED_SCRAP_KINDS = [
  "image",
  "button",
  "svg-icon",
  "heading",
  "cursor",
] as const;

export type PublishedScrapKind = (typeof PUBLISHED_SCRAP_KINDS)[number];

/** What the back of a published collage lists, as the studio's back does. */
export const PUBLISHED_BACK_SHOWS = ["pieces", "titles"] as const;

export type PublishedBackShows = (typeof PUBLISHED_BACK_SHOWS)[number];

/**
 * The style properties a button or heading may carry: what the scrap collector
 * captures, and nothing else. Positioning, content and URL-bearing properties
 * are never among them.
 */
export const PUBLISHED_STYLE_PROPERTIES = [
  "backgroundColor",
  "backgroundImage",
  "color",
  "borderRadius",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "textTransform",
  "lineHeight",
  "boxShadow",
  "border",
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderRightWidth",
  "borderRightStyle",
  "borderRightColor",
  "borderBottomWidth",
  "borderBottomStyle",
  "borderBottomColor",
  "borderLeftWidth",
  "borderLeftStyle",
  "borderLeftColor",
] as const;

export type PublishedStyleProperty =
  (typeof PUBLISHED_STYLE_PROPERTIES)[number];

export type PublishedStyles = Partial<Record<PublishedStyleProperty, string>>;

/**
 * Anything that could fetch, script or break out of a declaration: URLs and
 * image functions (which would load from anywhere, or run `javascript:` in old
 * engines), old IE `expression()` and `behavior`, Firefox's `-moz-binding`,
 * escapes that could spell any of these, and declaration or markup breaks.
 */
const UNSAFE_STYLE_VALUE =
  /url\s*\(|image(?:-set)?\s*\(|element\s*\(|cross-fade\s*\(|paint\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|behavior|-moz-binding|@import|[\\;{}<>]|\/\*/i;

/** Whether a captured style value is plain enough to set on a public page. */
export function isSafeStyleValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= PUBLISHED_COLLAGE_LIMITS.maxStyleValueLength &&
    !UNSAFE_STYLE_VALUE.test(value)
  );
}

/**
 * The captured styles worth publishing: known properties with safe values.
 * Anything else is dropped, so a scrap with an odd capture still publishes.
 */
export function publishableStyles(
  styles: Record<string, string> | undefined,
): PublishedStyles {
  const kept: PublishedStyles = {};
  if (!styles) return kept;
  for (const property of PUBLISHED_STYLE_PROPERTIES) {
    if (!Object.prototype.hasOwnProperty.call(styles, property)) continue;
    const value = styles[property];
    if (isSafeStyleValue(value)) kept[property] = value;
  }
  return kept;
}

/**
 * The words and markup a button, heading or icon piece is set from, as the
 * scrap captured them. The viewer renders them as the studio does.
 */
export type PublishedPieceContent =
  | {
      kind: "button";
      text: string;
      styles: PublishedStyles;
      /** The icon inside the button, as inline SVG markup. */
      innerSvg?: string;
      /** The color the button sat on, as a CSS color. */
      backdropColor?: string;
    }
  | {
      kind: "heading";
      text: string;
      level: 1 | 2 | 3;
      styles: PublishedStyles;
    }
  | {
      kind: "svg-icon";
      /** The icon as inline SVG markup. */
      markup: string;
      width: number;
      height: number;
    };

/** A rectangle as fractions of a piece's whole source box. */
export interface PublishedFraction {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a piece came from, as the scrap recorded it. */
export interface PublishedPieceSource {
  kind: PublishedScrapKind;
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

export interface PublishedCollagePiece {
  /** Visible box in frame coordinates, after the crop is applied. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  crop: PublishedFraction;
  flipX: boolean;
  flipY: boolean;
  /**
   * The uploaded picture this piece draws, as `img/<n>`. A piece has exactly
   * one of `image` and `content`.
   */
  image?: string;
  /** The words and markup this piece is set from, when it is not a picture. */
  content?: PublishedPieceContent;
  /**
   * Where the picture sits inside the source box, when it covers only part of
   * it, as a baked cutout of the cropped region does. Absent means the picture
   * fills the whole source box.
   */
  placement?: PublishedFraction;
  /** Whether the picture had its background removed before upload. */
  cutout?: true;
  source: PublishedPieceSource;
}

export interface PublishedCollage {
  format: typeof PUBLISHED_COLLAGE_FORMAT;
  version: typeof PUBLISHED_COLLAGE_VERSION;
  title: string;
  frame: { width: number; height: number };
  paper: { color: string; grain: boolean };
  pieces: PublishedCollagePiece[];
  /** When the collage was first made, in epoch milliseconds. */
  createdAt?: number;
  /** What the back lists; absent reads as "pieces", as the studio does. */
  backShows?: PublishedBackShows;
  /** Set by the Worker when it stores the collage. */
  sharedAt?: number;
  /** Who signed it, as they were when they shared; absent when unsigned. */
  signature?: PublishedSignature;
}

/**
 * A maker's stamp: always their cursor colour, and their name when they gave
 * one. A colour alone still signs the collage.
 */
export interface PublishedSignature {
  color: string;
  name?: string;
}

/** What the Worker answers a successful share with. */
export interface PublishedCollageCreated {
  id: string;
  deleteToken: string;
  url: string;
}

/** A shared collage that cannot be read, with the reason it names. */
export class PublishedCollageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedCollageError";
  }
}

/** Ids are 128 random bits written as unpadded base64url. */
export const PUBLISHED_COLLAGE_ID = /^[A-Za-z0-9_-]{22}$/;

const IMAGE_REF = /^img\/(0|[1-9][0-9]{0,2})$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isPublishedCollageId(value: unknown): value is string {
  return typeof value === "string" && PUBLISHED_COLLAGE_ID.test(value);
}

/** The `img/<n>` name of the picture at index `n`. */
export function publishedImageRef(index: number): string {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= PUBLISHED_COLLAGE_LIMITS.maxImages
  ) {
    throw new PublishedCollageError(`picture index ${index} is out of range`);
  }
  return `img/${index}`;
}

/** The index an `img/<n>` name points at, or null when it is not one. */
export function publishedImageIndex(ref: string): number | null {
  const match = IMAGE_REF.exec(ref);
  if (!match) return null;
  const index = Number(match[1]);
  return index < PUBLISHED_COLLAGE_LIMITS.maxImages ? index : null;
}

export function isPublishedCollageImageType(
  value: unknown,
): value is PublishedCollageImageType {
  return (
    typeof value === "string" &&
    (PUBLISHED_COLLAGE_IMAGE_TYPES as readonly string[]).includes(value)
  );
}

/** The page a shared collage is viewed on. */
export function publishedCollageViewerUrl(
  id: string,
  origin: string = PUBLISHED_COLLAGE_VIEWER_ORIGIN,
): string {
  return `${origin.replace(/\/+$/, "")}/collage/?id=${encodeURIComponent(id)}`;
}

/**
 * A plain web address, or null. Stored URLs end up as links and favicons on a
 * public page, so a `javascript:` or `data:` value is never accepted.
 */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > PUBLISHED_COLLAGE_LIMITS.maxUrlLength) return null;
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
  throw new PublishedCollageError(message);
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
function fraction(value: unknown, where: string): PublishedFraction {
  if (!isPlainObject(value)) fail(`${where} is not a rectangle`);
  return {
    x: bounded(value, "x", where, -1, 2),
    y: bounded(value, "y", where, -1, 2),
    width: positive(value, "width", where, 2),
    height: positive(value, "height", where, 2),
  };
}

function parseSource(value: unknown, where: string): PublishedPieceSource {
  if (!isPlainObject(value)) fail(`${where} has no source`);
  const at = `${where} source`;
  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !(PUBLISHED_SCRAP_KINDS as readonly string[]).includes(kind)
  ) {
    fail(`${at} has an unknown kind: ${String(kind)}`);
  }
  const pageUrl = text(
    value,
    "pageUrl",
    at,
    PUBLISHED_COLLAGE_LIMITS.maxUrlLength,
  );
  if (pageUrl !== "" && webUrl(pageUrl) === null)
    fail(`${at} page is not a web address`);
  const source: PublishedPieceSource = {
    kind: kind as PublishedScrapKind,
    pageUrl,
    pageTitle: text(
      value,
      "pageTitle",
      at,
      PUBLISHED_COLLAGE_LIMITS.maxPageTitleLength,
    ),
    domain: text(value, "domain", at, PUBLISHED_COLLAGE_LIMITS.maxDomainLength),
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
    PUBLISHED_COLLAGE_LIMITS.maxAltLength,
  );
  if (alt !== undefined) source.alt = alt;
  if (value.naturalWidth !== undefined || value.naturalHeight !== undefined) {
    source.naturalWidth = positive(value, "naturalWidth", at, 1_000_000);
    source.naturalHeight = positive(value, "naturalHeight", at, 1_000_000);
  }
  return source;
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${where} has an unknown field: ${key}`);
  }
}

function parseStyles(value: unknown, where: string): PublishedStyles {
  if (!isPlainObject(value)) fail(`${where} has no styles`);
  onlyKeys(value, PUBLISHED_STYLE_PROPERTIES, `${where} styles`);
  const styles: PublishedStyles = {};
  for (const property of PUBLISHED_STYLE_PROPERTIES) {
    if (value[property] === undefined) continue;
    if (!isSafeStyleValue(value[property])) {
      fail(`${where} has an unsafe ${property}`);
    }
    styles[property] = value[property];
  }
  return styles;
}

function markupText(
  source: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = text(
    source,
    key,
    where,
    PUBLISHED_COLLAGE_LIMITS.maxContentBytes,
  );
  if (!/^\s*<svg[\s>]/i.test(value)) fail(`${where} ${key} is not an SVG`);
  return value;
}

function parseContent(value: unknown, where: string): PublishedPieceContent {
  if (!isPlainObject(value)) fail(`${where} content is not an object`);
  const at = `${where} content`;
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    PUBLISHED_COLLAGE_LIMITS.maxContentBytes
  ) {
    fail(`${at} is larger than 64 KB`);
  }
  const { maxContentTextLength } = PUBLISHED_COLLAGE_LIMITS;
  switch (value.kind) {
    case "button": {
      onlyKeys(
        value,
        ["kind", "text", "styles", "innerSvg", "backdropColor"],
        at,
      );
      const content: PublishedPieceContent = {
        kind: "button",
        text: text(value, "text", at, maxContentTextLength),
        styles: parseStyles(value.styles, at),
      };
      if (value.innerSvg !== undefined) {
        content.innerSvg = markupText(value, "innerSvg", at);
      }
      if (value.backdropColor !== undefined) {
        if (!isSafeStyleValue(value.backdropColor)) {
          fail(`${at} has an unsafe backdropColor`);
        }
        content.backdropColor = value.backdropColor;
      }
      return content;
    }
    case "heading": {
      onlyKeys(value, ["kind", "text", "level", "styles"], at);
      const level = value.level;
      if (level !== 1 && level !== 2 && level !== 3) {
        fail(`${at} has a heading level that is not 1, 2 or 3`);
      }
      return {
        kind: "heading",
        text: text(value, "text", at, maxContentTextLength),
        level,
        styles: parseStyles(value.styles, at),
      };
    }
    case "svg-icon":
      onlyKeys(value, ["kind", "markup", "width", "height"], at);
      return {
        kind: "svg-icon",
        markup: markupText(value, "markup", at),
        width: positive(value, "width", at, 10_000),
        height: positive(value, "height", at, 10_000),
      };
    default:
      fail(`${at} has an unknown kind: ${String(value.kind)}`);
  }
}

function parsePiece(value: unknown, index: number): PublishedCollagePiece {
  const where = `piece ${index}`;
  if (!isPlainObject(value)) fail(`${where} is not an object`);
  const limit = PUBLISHED_COLLAGE_LIMITS.maxCoordinate;
  const image = value.image;
  if ((image === undefined) === (value.content === undefined)) {
    fail(`${where} needs exactly one of a picture and content`);
  }
  if (
    image !== undefined &&
    (typeof image !== "string" || publishedImageIndex(image) === null)
  ) {
    fail(`${where} names no picture`);
  }
  const piece: PublishedCollagePiece = {
    x: bounded(value, "x", where, -limit, limit),
    y: bounded(value, "y", where, -limit, limit),
    width: positive(value, "width", where, limit),
    height: positive(value, "height", where, limit),
    rotation: bounded(value, "rotation", where, -36_000, 36_000),
    z: bounded(value, "z", where, -1_000_000, 1_000_000),
    crop: fraction(value.crop, `${where} crop`),
    flipX: bool(value, "flipX", where),
    flipY: bool(value, "flipY", where),
    source: parseSource(value.source, where),
  };
  if (typeof image === "string") piece.image = image;
  if (value.content !== undefined) {
    const content = parseContent(value.content, where);
    if (content.kind !== piece.source.kind) {
      fail(
        `${where} content is a ${content.kind} but its source a ${piece.source.kind}`,
      );
    }
    piece.content = content;
  }
  if (value.placement !== undefined) {
    piece.placement = fraction(value.placement, `${where} placement`);
  }
  if (value.cutout !== undefined) {
    if (value.cutout !== true) fail(`${where} cutout is not true`);
    piece.cutout = true;
  }
  if (piece.content && (piece.placement || piece.cutout)) {
    fail(`${where} places or cuts content, which only a picture can be`);
  }
  return piece;
}

/**
 * Reads a shared collage, rejecting anything that is not exactly this format.
 * Only the known fields are carried into the result, so what gets stored or
 * drawn is what was checked, never extra fields that rode along.
 */
export function parsePublishedCollage(value: unknown): PublishedCollage {
  if (!isPlainObject(value)) fail("it is not a collage");
  if (value.format !== PUBLISHED_COLLAGE_FORMAT)
    fail("it is not a shared collage");
  if (value.version !== PUBLISHED_COLLAGE_VERSION) {
    fail(
      `it is a version ${String(value.version)} shared collage, and this reads version ${PUBLISHED_COLLAGE_VERSION}`,
    );
  }
  const frame = value.frame;
  if (!isPlainObject(frame)) fail("it has no frame");
  const { minFrameSide, maxFrameSide } = PUBLISHED_COLLAGE_LIMITS;
  const paper = value.paper;
  if (!isPlainObject(paper)) fail("it has no paper");
  if (typeof paper.color !== "string" || !HEX_COLOR.test(paper.color)) {
    fail("its paper is not a hex color");
  }
  if (!Array.isArray(value.pieces)) fail("it has no pieces");
  if (value.pieces.length === 0) fail("it has no pieces");
  if (value.pieces.length > PUBLISHED_COLLAGE_LIMITS.maxPieces) {
    fail(`it has more than ${PUBLISHED_COLLAGE_LIMITS.maxPieces} pieces`);
  }
  const collage: PublishedCollage = {
    format: PUBLISHED_COLLAGE_FORMAT,
    version: PUBLISHED_COLLAGE_VERSION,
    title: text(
      value,
      "title",
      "the collage",
      PUBLISHED_COLLAGE_LIMITS.maxTitleLength,
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
  if (value.createdAt !== undefined) {
    collage.createdAt = bounded(value, "createdAt", "the collage", 0, 8.64e15);
  }
  if (value.backShows !== undefined) {
    const backShows = value.backShows;
    if (
      typeof backShows !== "string" ||
      !(PUBLISHED_BACK_SHOWS as readonly string[]).includes(backShows)
    ) {
      fail(`its back shows something unknown: ${String(backShows)}`);
    }
    collage.backShows = backShows as PublishedBackShows;
  }
  if (value.sharedAt !== undefined) {
    collage.sharedAt = bounded(value, "sharedAt", "the collage", 0, 8.64e15);
  }
  if (value.signature !== undefined) {
    collage.signature = parseSignature(value.signature);
  }
  return collage;
}

function parseSignature(value: unknown): PublishedSignature {
  if (!isPlainObject(value)) fail("its signature is not an object");
  if (typeof value.color !== "string" || !HEX_COLOR.test(value.color)) {
    fail("its signature colour is not a hex color");
  }
  const signature: PublishedSignature = { color: value.color.toLowerCase() };
  if (value.name !== undefined) {
    const name = text(
      value,
      "name",
      "its signature",
      PUBLISHED_COLLAGE_LIMITS.maxSignatureNameLength,
    ).trim();
    if (name.length === 0) fail("its signature has an empty name");
    if (/[\u0000-\u001f\u007f]/.test(name)) {
      fail("its signature name has control characters");
    }
    signature.name = name;
  }
  return signature;
}

/**
 * The picture indexes a collage draws, in order. They must run 0..n-1 with no
 * gaps, so every uploaded picture is used and every piece's picture exists.
 */
export function publishedImageIndexes(collage: PublishedCollage): number[] {
  const used = new Set<number>();
  for (const piece of collage.pieces) {
    if (piece.image === undefined) continue;
    const index = publishedImageIndex(piece.image);
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
export function sniffPublishedImageType(
  bytes: Uint8Array,
): PublishedCollageImageType | null {
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
