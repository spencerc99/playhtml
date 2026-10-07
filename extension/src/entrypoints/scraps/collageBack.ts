// ABOUTME: The back of a collage: its title, when it was made and collected, and the sites its pieces came from.
// ABOUTME: One markup the studio shows and the bake rasterizes, plus the layout math that keeps it inside the frame.

import type { BackShows, CollageFrame, CollagePiece } from "./collageRecord";
import type { CollagePaper } from "./collageFormats";
import { paperBackground } from "./paperGrain";
import { escapeXml } from "./svgDocument";

/** What is written on the back, all of it derived from the collage as it stands. */
export interface CollageBackContent {
  title: string;
  createdAt: number;
  /** When the stored collage last changed, or null before it has been stored. */
  changedAt: number | null;
  pieces: readonly CollagePiece[];
  /** Whether each site lists its pieces or the titles of its pages. */
  shows: BackShows;
}

/** One piece as the back shows it: which piece, and the shape it was placed at. */
export interface BackSitePiece {
  id: string;
  /** Width over height of the piece as it sits on the front, after its crop. */
  aspect: number;
}

/** A page title as the back lists it, with how many pieces came from it. */
export interface BackSitePage {
  title: string;
  pieceCount: number;
}

/** A site the collage drew from, with every piece taken from it. */
export interface BackSite {
  domain: string;
  /** The page whose favicon stands for the site. */
  faviconPage: string;
  firstSeenAt: number;
  pageCount: number;
  /** In the order they were collected. */
  pieces: BackSitePiece[];
  /**
   * The site's pages that have a title of their own, in the order they were
   * first collected. Pages whose title only names the site are left out, and
   * pages sharing a title are listed once with their pieces counted together.
   */
  pages: BackSitePage[];
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A page title without the site's own name, which the domain beside it
 * already says: "rod stock | McMaster-Carr" is "rod stock", and a title that is
 * only the site's name is empty.
 */
export function backPageTitle(title: string, domain: string): string {
  const site = slug(
    domain
      .replace(/^(www|en|m|blog)\./, "")
      .replace(/\.[a-z]+$/, ""),
  );
  // A short name only matches whole, so "x" does not swallow "Linux".
  const isSite = (part: string) => {
    const words = slug(part);
    if (words === "" || site === "") return false;
    return (
      words === site ||
      (site.length >= 3 && words.includes(site)) ||
      (words.length >= 4 && site.includes(words))
    );
  };
  let text = title.trim();
  const tail = /^(.*\S)\s+[|:/\u2013\u2014-]\s+([^|:\u2013\u2014]+)$/.exec(text);
  if (tail && isSite(tail[2])) text = tail[1];
  const head = /^([^|:\u2013\u2014]+?)\s+[|:\u2013\u2014-]\s+(.*)$/.exec(text);
  if (head && isSite(head[1])) text = head[2];
  // The whole title is dropped only when it is no more than the site's name,
  // perhaps with its ending ("Amazon.com"); a title that mentions the site stays.
  const whole = slug(text);
  const onlySite =
    whole === site ||
    (whole.length >= 4 && site.includes(whole)) ||
    (site.length >= 3 && whole.startsWith(site) && whole.length - site.length <= 4);
  return onlySite ? "" : text;
}

/**
 * The collage's pieces gathered by site. The sites that gave the most pieces
 * lead, so what the collage is mostly made of is read first; ties go to the
 * site seen first.
 */
export function backSites(pieces: readonly CollagePiece[]): BackSite[] {
  const sites = new Map<
    string,
    {
      pages: Map<string, { title: string; count: number }>;
      faviconPage: string | null;
      firstPage: string;
      firstSeenAt: number;
      pieces: { id: string; aspect: number; ts: number }[];
    }
  >();
  const byTime = [...pieces].sort((a, b) => a.scrap.ts - b.scrap.ts);
  for (const piece of byTime) {
    const { domain, pageUrl, pageTitle, ts, faviconUrl } = piece.scrap;
    if (!(piece.width > 0) || !(piece.height > 0)) {
      throw new Error(`Piece ${piece.id} has no area to show on the back`);
    }
    let site = sites.get(domain);
    if (!site) {
      site = {
        pages: new Map(),
        faviconPage: null,
        firstPage: pageUrl,
        firstSeenAt: ts,
        pieces: [],
      };
      sites.set(domain, site);
    }
    const page = site.pages.get(pageUrl);
    if (page) {
      page.count += 1;
      if (!page.title && pageTitle) page.title = pageTitle;
    } else {
      site.pages.set(pageUrl, { title: pageTitle, count: 1 });
    }
    if (!site.faviconPage && faviconUrl) site.faviconPage = pageUrl;
    site.pieces.push({ id: piece.id, aspect: piece.width / piece.height, ts });
  }
  return [...sites.entries()]
    .map(([domain, site]) => {
      const titled = new Map<string, number>();
      for (const page of site.pages.values()) {
        const title = backPageTitle(page.title, domain);
        if (title) titled.set(title, (titled.get(title) ?? 0) + page.count);
      }
      return {
        domain,
        faviconPage: site.faviconPage ?? site.firstPage,
        firstSeenAt: site.firstSeenAt,
        pageCount: site.pages.size,
        pieces: site.pieces.map(({ id, aspect }) => ({ id, aspect })),
        pages: [...titled.entries()].map(([title, pieceCount]) => ({
          title,
          pieceCount,
        })),
      };
    })
    .sort(
      (a, b) =>
        b.pieces.length - a.pieces.length ||
        a.firstSeenAt - b.firstSeenAt ||
        a.domain.localeCompare(b.domain),
    );
}

/** A date as the back writes it: month, day and year in two digits each. */
export function backDate(ts: number): string {
  const date = new Date(ts);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getMonth() + 1)}/${two(date.getDate())}/${two(date.getFullYear() % 100)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * When the collage's material was collected, as one span, or a single date
 * when it all came from one day. Null with no pieces.
 */
export function collectedRange(pieces: readonly CollagePiece[]): string | null {
  if (pieces.length === 0) return null;
  const times = pieces.map((piece) => piece.scrap.ts);
  const first = backDate(Math.min(...times));
  const last = backDate(Math.max(...times));
  return first === last ? first : `${first}-${last}`;
}

/** The line under the title: when it was made and collected, and how much it holds. */
export function backDetail(content: CollageBackContent): string {
  const parts = [`made ${backDate(content.createdAt)}`];
  if (
    content.changedAt !== null &&
    backDate(content.changedAt) !== backDate(content.createdAt)
  ) {
    parts.push(`changed ${backDate(content.changedAt)}`);
  }
  const range = collectedRange(content.pieces);
  if (!range) {
    parts.push("nothing placed yet");
    return parts.join(" · ");
  }
  const pages = new Set(content.pieces.map((piece) => piece.scrap.pageUrl));
  const sites = new Set(content.pieces.map((piece) => piece.scrap.domain));
  parts.push(`collected ${range}`);
  parts.push(
    `${plural(content.pieces.length, "piece", "pieces")} from ${plural(pages.size, "page", "pages")} on ${plural(sites.size, "site", "sites")}`,
  );
  return parts.join(" · ");
}

/**
 * Heights a site's pieces are shown at, largest first. They are kept small, so
 * the pieces give the feel of where the collage came from without crowding
 * the writing; the back takes the largest that fits while tucking few away.
 */
export const BACK_PIECE_STEPS = [48, 40, 32, 28, 24] as const;
/** A column is never narrower than this, so a row of pieces stays short. */
export const BACK_COLUMN_MIN = 380;
const BACK_COLUMN_MAX = 4;
export const BACK_COLUMN_GAP = 48;
/**
 * How many rows of pieces a site may take, fewest first. A back with room to
 * spare lets a busy site run to more rows instead of counting pieces as "+N".
 */
export const BACK_PIECE_ROWS = [2, 3] as const;
const PIECE_GAP = 5;
/** Sizes page titles are written at, largest first, when the back lists titles. */
export const BACK_TITLE_STEPS = [13, 12] as const;
/** A site lists at most this many page titles; the rest are counted. */
export const BACK_TITLE_LIMIT = 3;
const TITLE_LINE = 1.45;
const TITLE_GAP = 4;
/** Room kept at the end of a site's last row for its "+N". */
const EXTRA_ROOM = 44;
/** The favicon's width and the gap after it, which the name and pieces sit past. */
const SITE_INDENT = 28;
/**
 * The share of the pieces that may be tucked into "+N" so the rest show
 * larger. Past that, smaller pieces that show more are preferred.
 */
const TUCK_ALLOWANCE = 0.15;
/** The margin around everything written on the back, relative to the short side. */
const MARGIN = 0.07;

/** Average advance of a character, as a share of its type size, per face. */
const MONO_ADVANCE = 0.62;
const DETAIL_ADVANCE = 0.65;
const SERIF_ADVANCE = 0.5;
const DOMAIN_SIZE = 14;
const DOMAIN_LINE = DOMAIN_SIZE * 1.4;
const SITE_META_LINE = 12 * 1.4;
const DETAIL_SIZE = 14;
const DETAIL_LINE = DETAIL_SIZE * 1.5;
const SITE_PADDING = 12;
const TAG_SIZE = 12;
const TAG_LINE = 24;
const STRIP_LABEL_WIDTH = 120;
/** The engraving the maker's mark is drawn at, and the room above it. */
const MARK_ROOM = 44 + 16;

/** A long title steps down in size, then wraps; it is never cut off. */
export function backTitleSize(title: string): number {
  if (title.length <= 28) return 40;
  if (title.length <= 60) return 32;
  return 26;
}

/** A site in the list, and how many of its pieces, or page titles, get shown. */
export interface BackRow {
  site: BackSite;
  kept: number;
}

/** One way to size the list: the item size, and how many rows or titles a site may take. */
interface BackOption {
  size: number;
  limit: number;
}

export interface BackLayout {
  pad: number;
  columns: number;
  columnWidth: number;
  titleSize: number;
  shows: BackShows;
  /** The height pieces are drawn at, or the size page titles are written at. */
  itemSize: number;
  rows: BackRow[];
  /** Sites with no row of their own, named in one strip under the list. */
  rest: BackSite[];
  /** Whether the strip names each site or, when that runs long, only marks it. */
  restNamed: boolean;
}

function textLines(chars: number, advance: number, room: number): number {
  return Math.max(1, Math.ceil((chars * advance) / room));
}

/** How wide a piece is drawn at a given height, never wider than its column. */
export function backPieceWidth(
  height: number,
  aspect: number,
  room: number,
): number {
  return Math.min(height * aspect, room);
}

/**
 * Where everything on the back goes: how many columns, how big the pieces,
 * which sites get a row and which are only named in the strip. The sizes are
 * estimates from the type's average advance, kept on the generous side.
 */
export function backLayout(
  frame: CollageFrame,
  title: string,
  detail: string,
  sites: readonly BackSite[],
  shows: BackShows,
): BackLayout {
  const pad = Math.round(Math.min(frame.width, frame.height) * MARGIN);
  const inner = frame.width - pad * 2;
  const columns = Math.max(
    1,
    Math.min(
      BACK_COLUMN_MAX,
      Math.floor((inner + BACK_COLUMN_GAP) / (BACK_COLUMN_MIN + BACK_COLUMN_GAP)),
    ),
  );
  const columnWidth = (inner - BACK_COLUMN_GAP * (columns - 1)) / columns;
  const piecesRoom = columnWidth - SITE_INDENT;
  const titleSize = backTitleSize(title);
  const header =
    textLines(title.length, titleSize * SERIF_ADVANCE, inner) * titleSize * 1.25 +
    10 +
    textLines(detail.length, DETAIL_SIZE * DETAIL_ADVANCE, inner) * DETAIL_LINE +
    21;
  const room = frame.height - pad * 2 - header - MARK_ROOM;

  const place = (
    height: number,
    pieces: readonly BackSitePiece[],
    maxRows: number,
  ) => {
    let row = 1;
    let x = 0;
    let kept = 0;
    for (const piece of pieces) {
      const width = backPieceWidth(height, piece.aspect, piecesRoom) + PIECE_GAP;
      const leftover = kept + 1 < pieces.length;
      const limit =
        row === maxRows && leftover ? piecesRoom - EXTRA_ROOM : piecesRoom;
      if (x > 0 && x + width > limit) {
        if (row === maxRows) break;
        row += 1;
        x = 0;
      }
      x += width;
      kept += 1;
    }
    return { rows: row, kept };
  };
  // A domain wraps only at its dots.
  const domainLines = (domain: string) => {
    let count = 1;
    let x = 0;
    for (const part of domain.split(/(?<=\.)/)) {
      const width = part.length * DOMAIN_SIZE * MONO_ADVANCE;
      if (x > 0 && x + width > piecesRoom) {
        count += 1;
        x = 0;
      }
      x += width;
    }
    return count;
  };
  // Page titles wrap within the column; each ends with its piece count.
  const titleLines = (page: BackSitePage, size: number) =>
    textLines(
      page.title.length + 3 + String(page.pieceCount).length,
      size * MONO_ADVANCE,
      piecesRoom,
    );
  /** How tall a site's list of pieces or titles is, and how much of it shows. */
  const block = (option: BackOption, site: BackSite) => {
    if (shows === "pieces") {
      const placed = place(option.size, site.pieces, option.limit);
      return {
        height: placed.rows * (option.size + PIECE_GAP) - PIECE_GAP,
        kept: placed.kept,
      };
    }
    const kept = Math.min(site.pages.length, option.limit);
    if (kept === 0) return { height: 0, kept };
    const line = option.size * TITLE_LINE;
    const lines = site.pages
      .slice(0, kept)
      .reduce((count, page) => count + titleLines(page, option.size), 0);
    const more = site.pages.length > kept ? 1 : 0;
    return {
      height: (lines + more) * line + (kept + more - 1) * TITLE_GAP,
      kept,
    };
  };
  const siteHeight = (option: BackOption, site: BackSite) => {
    const below = block(option, site).height;
    return (
      SITE_PADDING * 2 +
      1 +
      domainLines(site.domain) * DOMAIN_LINE +
      2 +
      SITE_META_LINE +
      (below > 0 ? 8 + below : 0)
    );
  };
  // Fills columns in order, as the page does; it fits when every site lands.
  const fits = (option: BackOption, list: readonly BackSite[], space: number) => {
    let column = 1;
    let used = 0;
    for (const site of list) {
      const each = siteHeight(option, site);
      if (each > space) return false;
      if (used > 0 && used + each > space) {
        column += 1;
        used = 0;
      }
      used += each;
    }
    return column <= columns;
  };
  const tagWidth = (site: BackSite, named: boolean) =>
    16 +
    5 +
    (named ? site.domain.length * TAG_SIZE * MONO_ADVANCE + 6 : 0) +
    String(site.pieces.length).length * TAG_SIZE * MONO_ADVANCE +
    16;
  const tagLines = (list: readonly BackSite[], named: boolean) => {
    let count = 1;
    let x = STRIP_LABEL_WIDTH;
    for (const site of list) {
      const width = tagWidth(site, named);
      if (x + width > inner) {
        count += 1;
        x = 0;
      }
      x += width;
    }
    return count;
  };
  const strip = (list: readonly BackSite[]) => {
    if (list.length === 0) return { height: 0, named: true };
    const named = tagLines(list, true) <= 2;
    return { height: 14 + 1 + tagLines(list, named) * TAG_LINE, named };
  };

  // Every size and cap that fits, largest first, tightest cap first.
  const options: BackOption[] =
    shows === "pieces"
      ? BACK_PIECE_STEPS.flatMap((size) =>
          BACK_PIECE_ROWS.map((limit) => ({ size, limit })),
        )
      : BACK_TITLE_STEPS.map((size) => ({ size, limit: BACK_TITLE_LIMIT }));
  const tucked = (option: BackOption) =>
    shows === "pieces"
      ? sites.reduce(
          (count, site) => count + site.pieces.length - block(option, site).kept,
          0,
        )
      : 0;
  const fitting = options
    .filter((option) => fits(option, sites, room))
    .map((option) => ({ option, tucked: tucked(option) }));
  const pieceCount = sites.reduce((count, site) => count + site.pieces.length, 0);
  const allowance = Math.max(2, Math.round(pieceCount * TUCK_ALLOWANCE));
  // The largest that tucks few pieces away; failing that, whatever tucks fewest.
  const best =
    fitting.find((entry) => entry.tucked <= allowance) ??
    fitting.reduce<(typeof fitting)[number] | undefined>(
      (found, entry) => (found === undefined || entry.tucked < found.tucked ? entry : found),
      undefined,
    );
  let shown = sites.length;
  let chosen: BackOption;
  if (best) {
    chosen = best.option;
  } else {
    chosen = options[options.length - 1];
    // The tightest cap at the smallest size, so as many sites as can get a row.
    if (shows === "pieces") chosen = { size: chosen.size, limit: BACK_PIECE_ROWS[0] };
    while (
      shown > 1 &&
      !fits(chosen, sites.slice(0, shown), room - strip(sites.slice(shown)).height)
    ) {
      shown -= 1;
    }
  }
  const rest = sites.slice(shown);
  return {
    pad,
    columns,
    columnWidth,
    titleSize,
    shows,
    itemSize: chosen.size,
    rows: sites
      .slice(0, shown)
      .map((site) => ({ site, kept: block(chosen, site).kept })),
    rest,
    restNamed: strip(rest).named,
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

/** How the back is printed: its card, the collage through it, and the maker's mark. */
export interface BackLook {
  /**
   * The card the back is printed on. The paper color belongs to the front,
   * where the pieces mostly cover it; on the back it would be all there is to
   * see, so the back is a plain card and the collage showing through is what
   * gives it its color. The grain follows the front's choice.
   */
  cardColor: string;
  /** How strongly the front shows through the card. */
  bleedOpacity: number;
  /** How soft the show-through is, in frame units. */
  bleedBlur: number;
  /** How strongly the engraving and wordmark are pressed in. */
  markOpacity: number;
  /** The engraving's size in frame units; the wordmark scales with it. */
  markSize: number;
}

export const BACK_LOOK: BackLook = {
  cardColor: "#faf7f2",
  bleedOpacity: 0.3,
  bleedBlur: 1.5,
  markOpacity: 0.8,
  markSize: 44,
};

export function backPaper(paper: CollagePaper, look: BackLook): CollagePaper {
  return { color: look.cardColor, grain: paper.grain };
}

/**
 * A page's favicon as the back can show it: a data URL once it has been
 * fetched, "missing" when the page had none or it could not be fetched, and
 * "pending" while it is still on its way.
 */
export type BackFavicon = { data: string } | "missing" | "pending";

/**
 * A piece drawn small for the back: a data URL once drawn, "missing" when its
 * picture could not be loaded, "pending" while it is still being drawn.
 */
export type BackThumbnail = { data: string } | "missing" | "pending";

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

function style(declarations: string[]): string {
  return escapeXml(declarations.join(";"));
}

function faviconMarkup(favicon: BackFavicon, ink: BackInk, size: number): string {
  const box = [`width:${size}px`, `height:${size}px`, "flex:none", "display:block"];
  if (favicon === "pending") {
    return `<span class="collage-back__favicon" style="${style(box)}"></span>`;
  }
  if (favicon === "missing") {
    // A site with no favicon of its own gets an empty ring, so the column
    // still lines up and the absence reads as an absence.
    return `<span class="collage-back__favicon collage-back__favicon--none" style="${style([
      ...box,
      "box-sizing:border-box",
      `border:1px solid ${ink.muted}`,
      "border-radius:50%",
      "transform:scale(0.75)",
    ])}"></span>`;
  }
  return `<img class="collage-back__favicon" alt="" src="${escapeXml(favicon.data)}" style="${style([
    ...box,
    "object-fit:contain",
  ])}"/>`;
}

function thumbnailMarkup(
  thumbnail: BackThumbnail,
  width: number,
  height: number,
  ink: BackInk,
): string {
  const box = [`width:${Math.round(width)}px`, `height:${Math.round(height)}px`, "flex:none", "display:block"];
  if (thumbnail === "pending") {
    return `<span class="collage-back__piece collage-back__piece--pending" style="${style([
      ...box,
      `background:${ink.rule}`,
      "opacity:0.4",
    ])}"></span>`;
  }
  if (thumbnail === "missing") {
    // A piece whose picture cannot be loaded keeps its place as an outline.
    return `<span class="collage-back__piece collage-back__piece--missing" style="${style([
      ...box,
      "box-sizing:border-box",
      `border:1px dashed ${ink.muted}`,
    ])}"></span>`;
  }
  return `<img class="collage-back__piece" alt="" src="${escapeXml(thumbnail.data)}" style="${style([
    ...box,
    "object-fit:contain",
  ])}"/>`;
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
  /** Each source page's favicon, by page address. */
  favicons: ReadonlyMap<string, BackFavicon>;
  /** Each piece drawn small, by piece id. */
  thumbnails: ReadonlyMap<string, BackThumbnail>;
  /** The front as a data URL, shown mirrored and faint, or null with no front. */
  bleed: string | null;
  /** The extension's engraved icon as a data URL, for the maker's mark. */
  markIcon: string;
  look: BackLook;
}

/**
 * The whole back as XHTML: paper, the front showing through, the writing, the
 * pieces by site and the maker's mark. The same string is set into the
 * studio's back face and wrapped in an SVG foreignObject for the bake, so what
 * the studio shows is what exports. Every value is escaped for XML, and
 * nothing on it is a link.
 */
export function collageBackMarkup(options: CollageBackMarkupOptions): string {
  const { frame, content, favicons, thumbnails, bleed, markIcon, look } = options;
  const paper = backPaper(options.paper, look);
  const ink = backInk(paper.color);
  const title = content.title.trim();
  const shownTitle = title || "untitled collage";
  const detail = backDetail(content);
  const sites = backSites(content.pieces);
  const layout = backLayout(frame, shownTitle, detail, sites, content.shows);
  const piecesRoom = layout.columnWidth - SITE_INDENT;

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
        `opacity:${look.bleedOpacity}`,
        `filter:blur(${look.bleedBlur}px)`,
        `mix-blend-mode:${ink.bleedBlend}`,
      ])}"/>`
    : "";

  const header = `<div class="collage-back__header" style="${style([
    "position:relative",
    "flex:none",
    "display:flex",
    "flex-direction:column",
    "gap:10px",
    "padding-bottom:20px",
    `border-bottom:1px solid ${ink.rule}`,
  ])}"><p class="collage-back__title" style="${style([
    "margin:0",
    `font:600 ${layout.titleSize}px/1.25 ${SERIF}`,
    `color:${title ? ink.ink : ink.muted}`,
    "overflow-wrap:anywhere",
  ])}">${escapeXml(shownTitle)}</p><p class="collage-back__detail" style="${style([
    "margin:0",
    `font:400 ${DETAIL_SIZE}px/1.5 ${MONO}`,
    "letter-spacing:0.03em",
    `color:${ink.muted}`,
  ])}">${escapeXml(detail)}</p></div>`;

  const piecesMarkup = (site: BackSite, kept: number) => {
    const extra = site.pieces.length - kept;
    const pieces = site.pieces
      .slice(0, kept)
      .map((piece) => {
        const width = backPieceWidth(layout.itemSize, piece.aspect, piecesRoom);
        return thumbnailMarkup(
          thumbnails.get(piece.id) ?? "pending",
          width,
          width / piece.aspect,
          ink,
        );
      })
      .join("");
    const more =
      extra > 0
        ? `<span class="collage-back__extra" style="${style([
            `font:400 12px/1 ${MONO}`,
            `color:${ink.muted}`,
            "padding-left:3px",
          ])}">+${extra}</span>`
        : "";
    return `<div class="collage-back__pieces" style="${style([
      "grid-column:2",
      "display:flex",
      "flex-wrap:wrap",
      "align-items:center",
      `gap:${PIECE_GAP}px`,
    ])}">${pieces}${more}</div>`;
  };

  // A site whose pages only carry the site's own name lists nothing below it.
  const titlesMarkup = (site: BackSite, kept: number) => {
    if (kept === 0) return "";
    const size = layout.itemSize;
    const extra = site.pages.length - kept;
    const pages = site.pages
      .slice(0, kept)
      .map(
        (page) =>
          `<span class="collage-back__page" style="${style([
            `font:400 ${size}px/${TITLE_LINE} ${MONO}`,
            `color:${ink.ink}`,
            "overflow-wrap:anywhere",
          ])}">${escapeXml(page.title)}<span style="${style([
            `color:${ink.muted}`,
          ])}"> \u00b7 ${page.pieceCount}</span></span>`,
      )
      .join("");
    const more =
      extra > 0
        ? `<span class="collage-back__extra" style="${style([
            `font:400 ${size}px/${TITLE_LINE} ${MONO}`,
            `color:${ink.muted}`,
          ])}">${escapeXml(`+${plural(extra, "more page", "more pages")}`)}</span>`
        : "";
    return `<div class="collage-back__pages" style="${style([
      "grid-column:2",
      "display:flex",
      "flex-direction:column",
      `gap:${TITLE_GAP}px`,
    ])}">${pages}${more}</div>`;
  };

  const rows = layout.rows.map(({ site, kept }) => {
    const favicon = favicons.get(site.faviconPage) ?? "pending";
    const below =
      layout.shows === "pieces"
        ? piecesMarkup(site, kept)
        : titlesMarkup(site, kept);
    const meta = `${backDate(site.firstSeenAt)} · ${plural(site.pageCount, "page", "pages")} · ${plural(site.pieces.length, "piece", "pieces")}`;
    return `<div class="collage-back__site" style="${style([
      "break-inside:avoid",
      "display:grid",
      "grid-template-columns:16px minmax(0, 1fr)",
      "column-gap:12px",
      "row-gap:8px",
      "align-items:start",
      `padding:${SITE_PADDING}px 0`,
      `border-bottom:1px solid ${ink.rule}`,
    ])}"><span style="${style(["padding-top:3px"])}">${faviconMarkup(favicon, ink, 16)}</span><div style="${style([
      "display:flex",
      "flex-direction:column",
      "gap:2px",
      "min-width:0",
    ])}"><span class="collage-back__domain" style="${style([
      `font:400 ${DOMAIN_SIZE}px/1.4 ${MONO}`,
      `color:${ink.ink}`,
    ])}">${
      // A zero-width space after each dot lets a long domain wrap only there.
      escapeXml(site.domain).replace(/\./g, ".​")
    }</span><span class="collage-back__seen" style="${style([
      `font:400 12px/1.4 ${MONO}`,
      `color:${ink.muted}`,
    ])}">${escapeXml(meta)}</span></div>${below}</div>`;
  });

  const list = `<div class="collage-back__list" style="${style([
    "position:relative",
    "flex:1 1 auto",
    "min-height:0",
    `column-count:${layout.columns}`,
    `column-gap:${BACK_COLUMN_GAP}px`,
    "column-fill:balance",
  ])}">${rows.join("")}</div>`;

  const strip =
    layout.rest.length > 0
      ? `<div class="collage-back__rest" style="${style([
          "position:relative",
          "flex:none",
          "display:flex",
          "flex-wrap:wrap",
          "align-items:center",
          "column-gap:16px",
          "row-gap:6px",
          "padding-top:14px",
          `border-top:1px solid ${ink.rule}`,
          `font:400 ${TAG_SIZE}px/18px ${MONO}`,
        ])}"><span style="${style([
          "letter-spacing:0.06em",
          `color:${ink.muted}`,
        ])}">${escapeXml(`also from ${plural(layout.rest.length, "site", "sites")}`)}</span>${layout.rest
          .map(
            (site) =>
              `<span class="collage-back__also" style="${style([
                "display:inline-flex",
                "align-items:center",
                "gap:5px",
              ])}">${faviconMarkup(favicons.get(site.faviconPage) ?? "pending", ink, 16)}${
                layout.restNamed
                  ? `<span style="${style([`color:${ink.ink}`])}">${escapeXml(site.domain)}</span>`
                  : ""
              }<span style="${style([`color:${ink.muted}`])}">${site.pieces.length}</span></span>`,
          )
          .join("")}</div>`
      : "";

  // Each half of the mark carries its own opacity: an opacity on a shared
  // wrapper would isolate the engraving from the paper it multiplies into.
  const mark = `<div class="collage-back__maker" style="${style([
    "position:relative",
    "flex:none",
    "margin-top:16px",
    "display:flex",
    "align-items:center",
    "justify-content:flex-end",
    `gap:${Math.round(look.markSize * 0.3)}px`,
  ])}"><img alt="" src="${escapeXml(markIcon)}" style="${style([
    `width:${look.markSize}px`,
    `height:${look.markSize}px`,
    "flex:none",
    `opacity:${look.markOpacity}`,
    ...ink.markBlend,
  ])}"/><span class="collage-back__wordmark" style="${style([
    `font:italic 200 ${Math.round(look.markSize * 0.6)}px/1 ${WORDMARK}`,
    `color:${ink.ink}`,
    `opacity:${look.markOpacity}`,
    "white-space:nowrap",
  ])}">we were online</span></div>`;

  const writing = `<div class="collage-back__writing" style="${style([
    "position:absolute",
    "left:0",
    "top:0",
    `width:${frame.width}px`,
    `height:${frame.height}px`,
    "box-sizing:border-box",
    `padding:${layout.pad}px`,
    "display:flex",
    "flex-direction:column",
  ])}">${header}<div style="${style(["height:22px", "flex:none"])}"></div>${list}${strip}${mark}</div>`;

  return `<div class="collage-back__sheet" style="${style([
    "position:absolute",
    "left:0",
    "top:0",
    `width:${frame.width}px`,
    `height:${frame.height}px`,
    "overflow:hidden",
    `color:${ink.ink}`,
    "text-align:left",
  ])}">${paperLayer}${bleedLayer}${writing}</div>`;
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
