// ABOUTME: A scattered strip of the reader's newest internet scraps, sized by a piece count.
// ABOUTME: Shared by the new-tab launch card and the dev page that tunes how many pieces show.

import { useState, type CSSProperties, type ReactNode } from "react";
import "./ScrapStrip.scss";

interface ScrapRecordBase {
  id: string;
  key: string;
  domain: string;
  pageUrl: string;
  ts: number;
  pageTitle: string;
  faviconUrl?: string;
}

export type ScrapRecord = ScrapRecordBase &
  (
    | {
        kind: "image";
        src: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
    | {
        kind: "heading";
        text: string;
        level: 1 | 2 | 3;
        styles: Record<string, string>;
      }
    | {
        kind: "cursor";
        url: string;
      }
  );

type StripImage = {
  kind: "image";
  key: string;
  src: string;
  alt: string;
  size: "photo" | "icon";
};
type StripText = {
  kind: "text";
  key: string;
  text: string;
  color: string;
  fill?: string;
  /** Light lettering with no fill of its own sits on a dark backing. */
  backed: boolean;
  font: CSSProperties;
};
export type StripPiece = StripImage | StripText;

/** The paper the strip is drawn on; text is judged readable against it. */
const STRIP_PAPER: Rgb = [253, 251, 246];
const BACKING_COLOR = "#2a2622";
/** Below this contrast against the paper, lettering needs a dark backing. */
const MIN_TEXT_CONTRAST = 2.5;
/** Share of the strip given to words; pictures carry the rest. */
const TEXT_SHARE = 0.3;
const MAX_TEXT_LENGTH = 32;

type Rgb = [number, number, number];

function parseRgb(color: string): { rgb: Rgb; alpha: number } | null {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits =
      hex[1]!.length === 3
        ? hex[1]!.split("").map((digit) => digit + digit)
        : hex[1]!.match(/../g)!;
    return {
      rgb: digits.map((pair) => parseInt(pair, 16)) as Rgb,
      alpha: 1,
    };
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!functional) return null;
  const parts = functional[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) =>
      part.endsWith("%") ? Number.parseFloat(part) / 100 : Number(part),
    );
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    rgb: [parts[0]!, parts[1]!, parts[2]!],
    alpha: parts[3] ?? 1,
  };
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (light! + 0.05) / (dark! + 0.05);
}

/** Whether lettering in this color disappears against the strip's paper. */
export function needsDarkBacking(color: string): boolean {
  const parsed = parseRgb(color);
  // A color this reader cannot parse is left as the page drew it.
  if (!parsed) return false;
  return contrastRatio(parsed.rgb, STRIP_PAPER) < MIN_TEXT_CONTRAST;
}

function solidFill(background: string | undefined): string | undefined {
  if (!background) return undefined;
  const parsed = parseRgb(background);
  return parsed && parsed.alpha >= 0.95 ? background : undefined;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

// Deterministic scatter so a given scrap always lands the same way on the strip.
function rotationFor(key: string): number {
  return (hashString(key) % 27) - 13;
}

function driftFor(key: string): number {
  return ((hashString(`${key}:drift`) % 13) - 6) / 2;
}

function imageWidthFor(key: string): number {
  return 44 + (hashString(`${key}:width`) % 23);
}

function svgSource(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function toTextPiece(
  key: string,
  text: string,
  styles: Record<string, string>,
): StripText | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return null;
  const color = styles.color ?? "#3d3833";
  const fill = solidFill(styles.backgroundColor);
  return {
    kind: "text",
    key,
    text: trimmed,
    color,
    fill,
    backed: !fill && needsDarkBacking(color),
    font: {
      fontFamily: styles.fontFamily,
      fontWeight: styles.fontWeight as CSSProperties["fontWeight"],
      fontStyle: styles.fontStyle as CSSProperties["fontStyle"],
      textTransform: styles.textTransform as CSSProperties["textTransform"],
    },
  };
}

export function toStripPiece(scrap: ScrapRecord): StripPiece | null {
  switch (scrap.kind) {
    case "image":
      return {
        kind: "image",
        key: scrap.key,
        src: scrap.src,
        alt: scrap.alt ?? `an image from ${scrap.domain}`,
        size: "photo",
      };
    case "svg-icon":
      return {
        kind: "image",
        key: scrap.key,
        src: svgSource(scrap.markup),
        alt: `an icon from ${scrap.domain}`,
        size: "icon",
      };
    case "cursor":
      return {
        kind: "image",
        key: scrap.key,
        src: scrap.url,
        alt: `a cursor from ${scrap.domain}`,
        size: "icon",
      };
    case "button":
    case "heading":
      return toTextPiece(scrap.key, scrap.text, scrap.styles);
  }
}

/**
 * The newest scraps, up to `capacity`, with words kept to a share of the strip
 * and spaced through the pictures rather than clustered at one end.
 */
export function toStripPieces(
  scraps: ScrapRecord[],
  capacity: number,
): StripPiece[] {
  const pieces = scraps
    .flatMap((scrap) => {
      const piece = toStripPiece(scrap);
      return piece ? [piece] : [];
    })
    .slice(0, capacity * 4);
  const textCapacity = Math.max(1, Math.round(capacity * TEXT_SHARE));
  const words = pieces
    .filter((piece) => piece.kind === "text")
    .slice(0, textCapacity);
  const pictures = pieces
    .filter((piece) => piece.kind === "image")
    .slice(0, capacity - words.length);

  const mixed: StripPiece[] = [...pictures];
  words.forEach((word, index) => {
    const position = Math.round(((index + 1) * mixed.length) / (words.length + 1));
    mixed.splice(position, 0, word);
  });
  return mixed.slice(0, capacity);
}

function StripPieceView({ piece }: { piece: StripPiece }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  const transform = `rotate(${rotationFor(piece.key)}deg) translateY(${driftFor(
    piece.key,
  )}px)`;

  if (piece.kind === "text") {
    const background = piece.fill ?? (piece.backed ? BACKING_COLOR : undefined);
    return (
      <span
        className={[
          "scrap-strip__piece",
          "scrap-strip__piece--text",
          background ? "scrap-strip__piece--filled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ ...piece.font, transform, color: piece.color, background }}
      >
        {piece.text}
      </span>
    );
  }

  const width = piece.size === "icon" ? 26 : imageWidthFor(piece.key);
  return (
    <img
      className={`scrap-strip__piece scrap-strip__piece--${piece.size}`}
      style={{ transform, width: `${width}px` }}
      src={piece.src}
      alt={piece.alt}
      onError={() => setFailed(true)}
    />
  );
}

export function ScrapStrip({
  pieces,
  children,
}: {
  pieces: StripPiece[];
  children?: ReactNode;
}) {
  return (
    <div className="scrap-strip">
      {pieces.map((piece) => (
        <StripPieceView key={piece.key} piece={piece} />
      ))}
      {children}
    </div>
  );
}
