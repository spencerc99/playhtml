// ABOUTME: The back of a collage: where its sources are written, laid out like a postcard.
// ABOUTME: One markup the studio shows and the bake rasterizes, plus the layout math behind it.

import type { CollageFrame, CollageProvenance } from "./collageRecord";
import type { CollagePaper } from "./collageFormats";
import { paperBackground } from "./paperGrain";
import { escapeXml } from "./svgDocument";

/** What is written on the back, all of it derived from the collage as it stands. */
export interface CollageBackContent {
  title: string;
  createdAt: number;
  /** When the stored collage last changed, or null before it has been stored. */
  changedAt: number | null;
  pieceCount: number;
  formatLabel: string;
  sources: readonly CollageProvenance[];
}

export interface BackRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackLayout {
  /**
   * "across" divides a landscape or square back left and right, like a
   * postcard; "down" divides a tall one top and bottom, where a side column
   * would be too narrow to read.
   */
  orientation: "across" | "down";
  /** The hairline dividing the two halves. */
  rule: { x1: number; y1: number; x2: number; y2: number };
  details: BackRegion;
  sources: BackRegion;
  /** The type size the source lines are written at, in frame units. */
  fontSize: number;
  lineHeight: number;
  columns: 1 | 2;
  /** How many lines each column holds. */
  rows: number;
  /** How many source pages get a line of their own. */
  shown: number;
  /** How many pages are folded into the closing "and N more pages" line. */
  more: number;
}

/** Source line sizes, largest first; the list steps down until it fits. */
export const SOURCE_TYPE_STEPS = [18, 16, 14, 12, 11, 10] as const;
/** Line spacing of a source line, as a multiple of its type size. */
export const SOURCE_LINE_HEIGHT = 1.9;
/** Frame units the "sources" label takes above the list. */
export const SOURCE_HEADER = 44;

/** The margin around everything written on the back, relative to the short side. */
const MARGIN = 0.07;

/**
 * Where everything on the back goes. The source list takes the largest type
 * step that fits it in one column, then the smallest step across two columns,
 * and past that the last line becomes "and N more pages", so the writing
 * never runs off the frame.
 */
export function backLayout(
  frame: CollageFrame,
  sourceCount: number,
): BackLayout {
  if (!Number.isInteger(sourceCount) || sourceCount < 0) {
    throw new Error(`A collage back cannot list ${sourceCount} sources`);
  }
  const across = frame.width >= frame.height;
  const pad = Math.round(Math.min(frame.width, frame.height) * MARGIN);
  const gutter = Math.round(pad * 0.7);

  let details: BackRegion;
  let sources: BackRegion;
  let rule: BackLayout["rule"];
  if (across) {
    const divider = Math.round(frame.width * 0.62);
    sources = {
      x: pad,
      y: pad,
      width: divider - gutter - pad,
      height: frame.height - pad * 2,
    };
    details = {
      x: divider + gutter,
      y: pad,
      width: frame.width - pad - divider - gutter,
      height: frame.height - pad * 2,
    };
    rule = { x1: divider, y1: pad, x2: divider, y2: frame.height - pad };
  } else {
    const divider = Math.round(pad + (frame.height - pad * 2) * 0.28);
    details = {
      x: pad,
      y: pad,
      width: frame.width - pad * 2,
      height: divider - gutter - pad,
    };
    sources = {
      x: pad,
      y: divider + gutter,
      width: frame.width - pad * 2,
      height: frame.height - pad - divider - gutter,
    };
    rule = { x1: pad, y1: divider, x2: frame.width - pad, y2: divider };
  }

  const listHeight = sources.height - SOURCE_HEADER;
  const rowsAt = (size: number) =>
    Math.max(1, Math.floor(listHeight / (size * SOURCE_LINE_HEIGHT)));
  const base = {
    orientation: across ? ("across" as const) : ("down" as const),
    rule,
    details,
    sources,
  };

  for (const size of SOURCE_TYPE_STEPS) {
    if (sourceCount <= rowsAt(size)) {
      return {
        ...base,
        fontSize: size,
        lineHeight: size * SOURCE_LINE_HEIGHT,
        columns: 1,
        rows: Math.max(1, sourceCount),
        shown: sourceCount,
        more: 0,
      };
    }
  }

  const smallest = SOURCE_TYPE_STEPS[SOURCE_TYPE_STEPS.length - 1];
  const rows = rowsAt(smallest);
  const capacity = rows * 2;
  const shown = sourceCount <= capacity ? sourceCount : capacity - 1;
  return {
    ...base,
    fontSize: smallest,
    lineHeight: smallest * SOURCE_LINE_HEIGHT,
    columns: 2,
    rows,
    shown,
    more: sourceCount - shown,
  };
}

/** The colors the back is written in, chosen so the writing reads on its paper. */
export interface BackInk {
  ink: string;
  muted: string;
  rule: string;
  /** How the show-through meets the paper: ink darkens pale paper, lightens dark. */
  bleedBlend: "multiply" | "screen";
  /**
   * How the engraved maker's mark sits in the paper: multiplied on pale paper,
   * inverted and screened on dark, so only its lines show either way.
   */
  markBlend: string[];
}

const INK_ON_PALE: BackInk = {
  ink: "#3d3833",
  muted: "#827a72",
  rule: "rgba(61, 56, 51, 0.24)",
  bleedBlend: "multiply",
  markBlend: ["mix-blend-mode:multiply"],
};

const INK_ON_DARK: BackInk = {
  ink: "#f5f0e8",
  muted: "#b3aa9f",
  rule: "rgba(245, 240, 232, 0.28)",
  bleedBlend: "screen",
  markBlend: ["filter:invert(1)", "mix-blend-mode:screen"],
};

/** Relative luminance of a #rgb or #rrggbb color. */
function luminance(hex: string): number {
  const digits = hex.trim().replace(/^#/, "");
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`The collage paper is not a hex color: ${hex}`);
  }
  const channel = (offset: number) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** The page's own ink on pale paper; a light ink on the soft black paper. */
export function backInk(paperColor: string): BackInk {
  return luminance(paperColor) < 0.2 ? INK_ON_DARK : INK_ON_PALE;
}

/** How strongly the front shows through the paper. */
export const BLEED_OPACITY = 0.11;
/** How soft the show-through is, in frame units. */
export const BLEED_BLUR = 1.5;

export function backDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The words on one source line, in the order they are written. */
export interface SourceLineWords {
  domain: string;
  title: string;
  seen: string;
}

export function sourceLineWords(source: CollageProvenance): SourceLineWords {
  return {
    domain: source.domain,
    title: source.pageTitle.trim(),
    seen: `first seen ${backDate(source.firstSeenAt)} · ${plural(
      source.pieceCount,
      "piece",
      "pieces",
    )}`,
  };
}

/** The lines written under the title, like the address on a postcard. */
export function backDetailLines(content: CollageBackContent): string[] {
  const lines = [`made ${backDate(content.createdAt)}`];
  if (
    content.changedAt !== null &&
    backDate(content.changedAt) !== backDate(content.createdAt)
  ) {
    lines.push(`changed ${backDate(content.changedAt)}`);
  }
  lines.push(plural(content.pieceCount, "piece", "pieces"));
  lines.push(content.formatLabel);
  return lines;
}

export function morePagesLine(count: number): string {
  return `and ${plural(count, "more page", "more pages")}`;
}

/**
 * A page's favicon as the back can show it: a data URL once it has been
 * fetched, "missing" when the page had none or it could not be fetched, and
 * "pending" while it is still on its way.
 */
export type BackFavicon = { data: string } | "missing" | "pending";

/**
 * The faces the back is written in. They carry names of their own, and both
 * the studio and the bake load them from the same inlined bytes, so the back
 * never borrows whatever the page happens to have loaded under a common name.
 */
export const BACK_FONTS = {
  serif: "wwo-back-serif",
  mono: "wwo-back-mono",
  wordmark: "wwo-back-wordmark",
} as const;

const SERIF = `'${BACK_FONTS.serif}', 'Lora', Georgia, serif`;
const MONO = `'${BACK_FONTS.mono}', 'Martian Mono', ui-monospace, monospace`;
const WORDMARK = `'${BACK_FONTS.wordmark}', 'Source Serif 4', 'Lora', Georgia, serif`;

/** The maker's mark: the engraving and the wordmark, faint as if pressed in. */
export const MARK_OPACITY = 0.55;
export const MARK_ICON_SIZE = 34;

function style(declarations: string[]): string {
  return escapeXml(declarations.join(";"));
}

function box(region: BackRegion): string[] {
  return [
    "position:absolute",
    `left:${region.x}px`,
    `top:${region.y}px`,
    `width:${region.width}px`,
    `height:${region.height}px`,
    "box-sizing:border-box",
  ];
}

function faviconMarkup(favicon: BackFavicon, ink: BackInk): string {
  const size = ["width:1em", "height:1em", "flex:none"];
  if (favicon === "pending") {
    return `<span class="collage-back__mark" style="${style(size)}"></span>`;
  }
  if (favicon === "missing") {
    // A page with no favicon of its own gets an empty ring, so the column
    // still lines up and the absence reads as an absence.
    return `<span class="collage-back__mark collage-back__mark--none" style="${style([
      ...size,
      "box-sizing:border-box",
      `border:1px solid ${ink.muted}`,
      "border-radius:50%",
      "transform:scale(0.7)",
    ])}"></span>`;
  }
  return `<img class="collage-back__mark" alt="" src="${escapeXml(favicon.data)}" style="${style([
    ...size,
    "object-fit:contain",
  ])}"/>`;
}

function ellipsized(extra: string[]): string {
  return style([
    "overflow:hidden",
    "text-overflow:ellipsis",
    "white-space:nowrap",
    ...extra,
  ]);
}

/** The paper, grained as the front is, as declarations for the back's base layer. */
function paperDeclarations(paper: CollagePaper, frame: CollageFrame): string[] {
  const background = paperBackground(
    paper.color,
    paper.grain,
    frame.width,
    frame.height,
  );
  return [
    `background:${background.background}`,
    ...(background.backgroundBlendMode
      ? [`background-blend-mode:${background.backgroundBlendMode}`]
      : []),
    ...(background.backgroundSize
      ? [`background-size:${background.backgroundSize}`]
      : []),
  ];
}

export interface CollageBackMarkupOptions {
  frame: CollageFrame;
  paper: CollagePaper;
  content: CollageBackContent;
  favicons: ReadonlyMap<string, BackFavicon>;
  /** The front as a data URL, shown mirrored and faint, or null with no front. */
  bleed: string | null;
  /** The extension's engraved icon as a data URL, for the maker's mark. */
  markIcon: string;
}

/**
 * The whole back as XHTML: paper, the front showing through, the writing and
 * the maker's mark. The same string is set into the studio's back face and
 * wrapped in an SVG foreignObject for the bake, so what the studio shows is
 * what exports. Every value is escaped for XML, and nothing on it is a link.
 */
export function collageBackMarkup(options: CollageBackMarkupOptions): string {
  const { frame, paper, content, favicons, bleed, markIcon } = options;
  const ink = backInk(paper.color);
  const layout = backLayout(frame, content.sources.length);
  const across = layout.orientation === "across";
  const titleSize = Math.round(
    Math.min(frame.width, frame.height) * (across ? 0.034 : 0.04),
  );
  const detailSize = Math.max(12, Math.round(titleSize * 0.4));

  const paperLayer = `<div class="collage-back__paper" style="${style([
    "position:absolute",
    "left:0",
    "top:0",
    `width:${frame.width}px`,
    `height:${frame.height}px`,
    ...paperDeclarations(paper, frame),
  ])}"></div>`;

  const bleedLayer = bleed
    ? `<img class="collage-back__bleed" alt="" src="${escapeXml(bleed)}" style="${style([
        "position:absolute",
        "left:0",
        "top:0",
        `width:${frame.width}px`,
        `height:${frame.height}px`,
        // Mirrored across the vertical axis, as the front reads from behind.
        "transform:scaleX(-1)",
        `opacity:${BLEED_OPACITY}`,
        `filter:blur(${BLEED_BLUR}px)`,
        `mix-blend-mode:${ink.bleedBlend}`,
      ])}"/>`
    : "";

  const title = content.title.trim();
  const detailLines = backDetailLines(content)
    .map(
      (line) =>
        `<p class="collage-back__detail" style="${style([
          "margin:0",
          `padding-bottom:${Math.round(detailSize * 0.5)}px`,
          `border-bottom:1px solid ${ink.rule}`,
          `font:400 ${detailSize}px/1.4 ${MONO}`,
          "letter-spacing:0.03em",
          `color:${ink.muted}`,
          "white-space:nowrap",
          "overflow:hidden",
          "text-overflow:ellipsis",
        ])}">${escapeXml(line)}</p>`,
    )
    .join("");

  // Each half of the mark carries its own opacity: an opacity on a shared
  // wrapper would isolate the engraving from the paper it multiplies into.
  const mark = `<div class="collage-back__maker" style="${style([
    "display:flex",
    "align-items:center",
    "justify-content:flex-end",
    `gap:${Math.round(MARK_ICON_SIZE * 0.3)}px`,
  ])}"><img alt="" src="${escapeXml(markIcon)}" style="${style([
    `width:${MARK_ICON_SIZE}px`,
    `height:${MARK_ICON_SIZE}px`,
    "flex:none",
    `opacity:${MARK_OPACITY}`,
    ...ink.markBlend,
  ])}"/><span class="collage-back__wordmark" style="${style([
    `font:italic 200 ${Math.round(MARK_ICON_SIZE * 0.6)}px/1 ${WORDMARK}`,
    `color:${ink.ink}`,
    `opacity:${MARK_OPACITY}`,
    "white-space:nowrap",
  ])}">we were online</span></div>`;

  const details = `<div class="collage-back__details" style="${style([
    ...box(layout.details),
    "display:flex",
    "flex-direction:column",
    `gap:${detailSize}px`,
  ])}"><p class="collage-back__title" style="${style([
    "margin:0",
    `font:600 ${titleSize}px/1.25 ${SERIF}`,
    `color:${title ? ink.ink : ink.muted}`,
    "overflow-wrap:anywhere",
    "display:-webkit-box",
    "-webkit-box-orient:vertical",
    `-webkit-line-clamp:${across ? 5 : 2}`,
    "overflow:hidden",
  ])}">${escapeXml(title || "untitled collage")}</p><div style="${style([
    "margin-top:auto",
    "display:grid",
    // A tall back's title side is short, so its lines sit two abreast.
    `grid-template-columns:${across ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))"}`,
    `column-gap:${Math.round(detailSize * 2)}px`,
    `row-gap:${Math.round(detailSize * 0.9)}px`,
  ])}">${detailLines}</div>${mark}</div>`;

  const lines = content.sources.slice(0, layout.shown).map((source) => {
    const words = sourceLineWords(source);
    const favicon = favicons.get(source.pageUrl) ?? "pending";
    return `<div class="collage-back__source" style="${style([
      "display:flex",
      "align-items:center",
      "gap:0.7em",
      "min-width:0",
      "white-space:nowrap",
    ])}">${faviconMarkup(favicon, ink)}<span class="collage-back__domain" style="${ellipsized([
      // The page title gives way first; a long domain only once it is gone,
      // so the when-and-how-much never runs into the next column.
      "flex:0 1 auto",
      "min-width:0",
      "max-width:38%",
      `color:${ink.ink}`,
    ])}">${escapeXml(words.domain)}</span><span class="collage-back__page" style="${ellipsized([
      "flex:1 1000 0",
      "min-width:0",
      `color:${ink.muted}`,
    ])}">${escapeXml(words.title)}</span><span class="collage-back__seen" style="${style([
      "flex:none",
      `color:${ink.muted}`,
    ])}">${escapeXml(words.seen)}</span></div>`;
  });
  if (layout.more > 0) {
    lines.push(
      `<div class="collage-back__more" style="${style([
        "display:flex",
        "align-items:center",
        `color:${ink.muted}`,
      ])}">${escapeXml(morePagesLine(layout.more))}</div>`,
    );
  }

  const heading =
    content.sources.length === 0
      ? "sources · nothing placed yet"
      : `sources · ${plural(content.sources.length, "page", "pages")}`;
  const sourcesBlock = `<div class="collage-back__sources" style="${style(
    box(layout.sources),
  )}"><p style="${style([
    "margin:0",
    `height:${SOURCE_HEADER}px`,
    `font:400 12px/1 ${MONO}`,
    "letter-spacing:0.08em",
    `color:${ink.muted}`,
  ])}">${escapeXml(heading)}</p><div class="collage-back__list" style="${style([
    "display:grid",
    `grid-template-columns:repeat(${layout.columns}, minmax(0, 1fr))`,
    `grid-template-rows:repeat(${layout.rows}, ${layout.lineHeight}px)`,
    "grid-auto-flow:column",
    `column-gap:${Math.round(layout.fontSize * 2.4)}px`,
    `font:400 ${layout.fontSize}px/1 ${MONO}`,
    "letter-spacing:0.01em",
  ])}">${lines.join("")}</div></div>`;

  const { rule } = layout;
  const hairline = `<div style="${style([
    "position:absolute",
    `left:${rule.x1}px`,
    `top:${rule.y1}px`,
    `width:${Math.max(1, rule.x2 - rule.x1)}px`,
    `height:${Math.max(1, rule.y2 - rule.y1)}px`,
    `background:${ink.rule}`,
  ])}"></div>`;

  return `<div class="collage-back__sheet" style="${style([
    "position:absolute",
    "left:0",
    "top:0",
    `width:${frame.width}px`,
    `height:${frame.height}px`,
    "overflow:hidden",
    `color:${ink.ink}`,
    "text-align:left",
  ])}">${paperLayer}${bleedLayer}${sourcesBlock}${hairline}${details}</div>`;
}

/**
 * The back as a standalone SVG document, for the bake. Web fonts do not load
 * inside an SVG drawn as an image, so the faces are handed in as `@font-face`
 * rules carrying their bytes as data URLs. The document is drawn at the
 * bake's pixel size, with the writing laid out in frame units. It is a `data:`
 * URL rather than a `blob:` one, which Chromium would treat as tainting.
 */
export function collageBackDocument(options: {
  frame: CollageFrame;
  markup: string;
  fontFaces: string;
  pixelScale: number;
}): string {
  const { frame, markup, fontFaces, pixelScale } = options;
  const width = Math.round(frame.width * pixelScale);
  const height = Math.round(frame.height * pixelScale);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${frame.width} ${frame.height}">`,
    `<defs><style>${escapeXml(fontFaces)}</style></defs>`,
    `<foreignObject x="0" y="0" width="${frame.width}" height="${frame.height}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${frame.width}px;height:${frame.height}px;margin:0;">`,
    markup,
    `</div></foreignObject></svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
