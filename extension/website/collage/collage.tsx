// ABOUTME: View-only page for a collage published from the scraps studio, fetched from the Worker by ?id=.
// ABOUTME: The framed front draws pieces as the studio does; turn it over for the studio's real back face.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ASSETS_URL, WORKER_URL } from "@movement/config";
import {
  ScrapLightbox,
  type ScrapOrigin,
} from "@movement/components/ScrapLightbox";
import { useChromeToggle } from "@movement/hooks/useChromeToggle";
import { COLLAGE_STYLES } from "@movement/components/ScrapCollage";
import { paperBackground } from "@extension/entrypoints/scraps/paperGrain";
import { sourceBoxForCrop } from "@extension/entrypoints/scraps/collageGeometry";
import { PieceMaterial } from "@extension/entrypoints/scraps/PieceMaterial";
import { CollageBackFace } from "@extension/entrypoints/scraps/CollageBackFace";
import {
  BACK_LOOK,
  type CollageBackContent,
} from "@extension/entrypoints/scraps/collageBack";
import { bakeCollage } from "@extension/entrypoints/scraps/bakeCollage";
import {
  CollageMat,
  MAT,
  MAT_CAPTION,
  madeOn,
} from "@extension/entrypoints/scraps/CollageMat";
import { StudioViews } from "@extension/entrypoints/scraps/StudioTools";
import { COLLAGE_PIECE_TOOL_STYLES } from "@extension/entrypoints/scraps/collagePieceToolStyles";
import {
  pieceMaterialTransform,
  type CollagePiece,
} from "@extension/entrypoints/scraps/collageRecord";
import {
  COLLAGE_MAT_STYLES,
  COLLAGE_SHEET_STYLES,
  PIECE_MATERIAL_STYLES,
} from "@extension/entrypoints/scraps/collageSheetStyles";
import { ProvenancePeek } from "@extension/entrypoints/scraps/ProvenancePeek";
import { COLLAGE_PEEK_STYLES } from "@extension/entrypoints/scraps/collageStudioStyles";
import {
  createPeekState,
  stepPeek,
} from "@extension/entrypoints/scraps/peekHold";
import { COLLAGE_VIEW_STYLES } from "@extension/entrypoints/scraps/collageViewStyles";
import type {
  PublishedCollage,
  PublishedCollagePiece,
} from "../../shared/publishedCollage";
import {
  faviconFor,
  fitScale,
  loadPublishedCollage,
  placeholderColor,
  readingOrder,
  revealRanks,
  viewerPieces,
  publishedCollageIdFrom,
  publishedImageUrl,
  type PublishedCollageLoad,
  type RevealFrom,
  type SourcesMode,
  type ViewerPiece,
} from "./publishedCollageView";
import { VIEWER_STYLES } from "./collageViewerStyles";

/** Room above the frame for the mark and the toggle, and below it for the caption. */
/**
 * Breathing room kept clear above and below the mat, in screen pixels: the
 * toolbar row sits in the top band, and the bottom stays open so the framed
 * collage never runs into the window's edge.
 */
const TOOLBAR = 48;
const ROOM = { top: 40, bottom: 56 };
const ROOM_NARROW = { top: 24, bottom: 40 };

/**
 * Opens the connections to the collage server while the page is still
 * starting: the collage's own fetch, and its pictures both as plain images and
 * as the CORS reads the back's bake makes.
 */
function preconnectToWorker(): void {
  const origins = new Set<string>();
  for (const url of [WORKER_URL, ASSETS_URL]) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A malformed override just goes without the head start.
    }
  }
  for (const origin of origins) {
    for (const crossOrigin of ["anonymous", null]) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      if (crossOrigin) link.crossOrigin = crossOrigin;
      document.head.append(link);
    }
  }
}
preconnectToWorker();

/** The longest gap between one piece's turn in the opening reveal and the next. */
const REVEAL_STEP_MS = 45;
/** The opening reveal's whole length, however many pieces the collage holds. */
const REVEAL_SPAN_MS = 1100;
/**
 * How long the reveal waits for every picture before it starts anyway. Pieces
 * whose pictures arrive later land as they come.
 */
const REVEAL_HOLD_MS = 1600;

/** `?reveal=edges` opens the collage from its edges in, for comparing. */
function revealFromSearch(search: string): RevealFrom {
  return new URLSearchParams(search).get("reveal") === "edges"
    ? "edges"
    : "center";
}

/** The picture a piece draws, or null for lettering and other drawn content. */
function pictureOf({ piece }: ViewerPiece): string | null {
  return piece.scrap.kind === "image" && piece.scrap.src
    ? piece.scrap.src
    : null;
}

/**
 * Fetches every picture at once, ahead of the pieces' own lazy images, and
 * holds the collage back until they have arrived (or a short wait has passed).
 * Then the pieces are set down in turn, from the middle out, instead of
 * popping in wherever the network happens to finish first.
 */
function useOpeningReveal(
  shown: readonly ViewerPiece[],
  ranks: readonly number[],
  reducedMotion: boolean,
): { arrived: ReadonlySet<number>; settled: boolean } {
  const [arrived, setArrived] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const ready = new Set<number>();
    let started: number | null = null;
    const step = reducedMotion
      ? 0
      : Math.min(REVEAL_STEP_MS, REVEAL_SPAN_MS / Math.max(1, shown.length));
    const show = (index: number) =>
      setArrived((current) => new Set(current).add(index));
    const land = (index: number) => {
      if (started === null) return;
      const wait = started + ranks[index] * step - performance.now();
      if (wait <= 0) show(index);
      else timers.push(window.setTimeout(() => show(index), wait));
    };
    const begin = () => {
      if (cancelled || started !== null) return;
      started = performance.now();
      ready.forEach(land);
    };
    const onReady = (index: number) => {
      if (cancelled) return;
      ready.add(index);
      if (started !== null) land(index);
      else if (ready.size === shown.length) begin();
    };
    shown.forEach((entry, index) => {
      const src = pictureOf(entry);
      if (!src) {
        onReady(index);
        return;
      }
      const image = new Image();
      image.fetchPriority = "high";
      image.src = src;
      // A picture that fails still takes its turn: the piece shows its gap.
      void image
        .decode()
        .catch(() => undefined)
        .then(() => onReady(index));
    });
    timers.push(window.setTimeout(begin, REVEAL_HOLD_MS));
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [shown, ranks, reducedMotion]);
  return { arrived, settled: arrived.size >= shown.length };
}

function useWindowSize() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Holding i shows the sources, by the same rules the studio's peek follows. */
function usePeekHeld(): boolean {
  const [peek, setPeek] = useState(createPeekState);
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      const tag = element?.tagName?.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        Boolean(element?.isContentEditable)
      );
    };
    const onKeyDown = (event: KeyboardEvent) =>
      setPeek((state) =>
        stepPeek(state, {
          kind: "keyDown",
          key: event.key,
          repeat: event.repeat,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          typing: typing(event.target),
          modeActive: false,
        }),
      );
    const onKeyUp = (event: KeyboardEvent) =>
      setPeek((state) => stepPeek(state, { kind: "keyUp", key: event.key }));
    const onBlur = () =>
      setPeek((state) => stepPeek(state, { kind: "windowBlur" }));
    const onHidden = () => {
      if (document.hidden)
        setPeek((state) => stepPeek(state, { kind: "pageHidden" }));
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);
  return peek.held;
}

function Favicon({
  piece,
  size,
}: {
  piece: PublishedCollagePiece;
  size: number;
}) {
  const src = faviconFor(piece);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className="published-collage__favicon"
        style={{
          width: size,
          height: size,
          background: placeholderColor(piece.source.domain),
        }}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      className="published-collage__favicon"
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}

/** The small label that follows a hovered piece: where it came from. */
function HoverLabel({
  piece,
  rect,
}: {
  piece: PublishedCollagePiece;
  rect: DOMRect;
}) {
  const width = Math.min(260, window.innerWidth - 32);
  const left = Math.max(
    16,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - 16,
    ),
  );
  const below = rect.bottom + 10;
  const top =
    below + 52 > window.innerHeight ? Math.max(8, rect.top - 62) : below;
  const title = piece.source.pageTitle.trim();
  return (
    <div
      className="published-collage__hover"
      role="status"
      style={{ left, top, width }}
    >
      <span className="published-collage__hover-where">
        <Favicon piece={piece} size={12} />
        {piece.source.domain || "an unknown site"}
      </span>
      {title && <span className="published-collage__hover-title">{title}</span>}
    </div>
  );
}

/** The quiet line on the mat: how much the collage holds, and when it was made. */
function captionMeta(collage: PublishedCollage, short: boolean): string {
  const count = collage.pieces.length;
  const sites = new Set(collage.pieces.map((piece) => piece.source.domain))
    .size;
  const parts = [`${count} ${count === 1 ? "piece" : "pieces"}`];
  // A phone's mat is too narrow for the site count beside the title.
  if (!short) parts.push(`${sites} ${sites === 1 ? "site" : "sites"}`);
  // The date the studio's mat shows: when it was made, else when it was shared.
  if (collage.createdAt) parts.push(`made ${madeOn(collage.createdAt)}`);
  else if (collage.sharedAt) parts.push(`shared ${madeOn(collage.sharedAt)}`);
  return parts.join(" · ");
}

/**
 * The baked front, for the back to show faintly through. It is drawn in idle
 * time once the front's pictures have arrived, so the back is ready before
 * anyone turns the collage over; turning it over sooner draws it right away.
 * Without it the back is plain paper.
 */
function useBakedFront(
  turnedOver: boolean,
  frontSettled: boolean,
  collage: PublishedCollage,
  pieces: readonly CollagePiece[],
): Blob | null {
  const [front, setFront] = useState<Blob | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || (!turnedOver && !frontSettled)) return;
    const bake = () => {
      if (started.current) return;
      started.current = true;
      void bakeCollage({
        frame: collage.frame,
        pieces,
        paper: collage.paper.color,
        grain: collage.paper.grain,
      })
        .then(setFront)
        .catch((error: unknown) => {
          console.warn(
            "[published collage] the front could not be baked:",
            error,
          );
        });
    };
    if (turnedOver) {
      bake();
      return;
    }
    // Past the reveal's end, so the bake never stutters the opening.
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(bake, {
        timeout: REVEAL_SPAN_MS * 2,
      });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(bake, REVEAL_SPAN_MS);
    return () => window.clearTimeout(timer);
  }, [collage, pieces, turnedOver, frontSettled]);
  return front;
}

function Viewer({ collage, id }: { collage: PublishedCollage; id: string }) {
  const { frame, paper, pieces } = collage;
  const windowSize = useWindowSize();
  const chromeHidden = useChromeToggle();
  const peekHeld = usePeekHeld();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [sourcesOn, setSourcesOn] = useState(false);
  const [over, setOver] = useState(false);
  const [hovered, setHovered] = useState<{
    index: number;
    rect: DOMRect;
  } | null>(null);
  const [examining, setExamining] = useState<{
    at: number;
    origin: ScrapOrigin;
  } | null>(null);
  const [failedFavicons, setFailedFavicons] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const pieceRefs = useRef(new Map<number, HTMLDivElement>());

  const narrow = windowSize.width < 600;
  const gutter = narrow ? 16 : 32;
  const room = narrow ? ROOM_NARROW : ROOM;
  const toolbar = chromeHidden ? 0 : TOOLBAR;
  // The whole mat, caption and all, fits between the toolbar and the room
  // kept below it, so the collage never touches the window's edges.
  const scale = fitScale(frame, {
    width: windowSize.width - gutter * 2 - MAT * 2,
    height:
      windowSize.height - room.top - toolbar - room.bottom - MAT - MAT_CAPTION,
  });
  const shownMode: SourcesMode =
    !over && (sourcesOn || peekHeld) ? "title" : "off";

  const order = useMemo(
    () => readingOrder(pieces, frame.height),
    [pieces, frame.height],
  );
  // Markup is sanitized here, every time the collage is shown.
  const shown = useMemo(
    () =>
      viewerPieces(collage, (ref) => publishedImageUrl(ASSETS_URL, id, ref)),
    [collage, id],
  );
  const studioPieces = useMemo(
    () => shown.map((entry) => entry.piece),
    [shown],
  );

  const ranks = useMemo(
    () => revealRanks(pieces, frame, revealFromSearch(window.location.search)),
    [pieces, frame],
  );
  const reveal = useOpeningReveal(shown, ranks, prefersReducedMotion);
  const front = useBakedFront(over, reveal.settled, collage, studioPieces);
  const backContent = useMemo<CollageBackContent>(
    () => ({
      title: collage.title,
      createdAt:
        collage.createdAt ??
        collage.sharedAt ??
        Math.min(...pieces.map((piece) => piece.source.ts)),
      changedAt: null,
      pieces: studioPieces,
      shows: collage.backShows ?? "pieces",
    }),
    [collage, pieces, studioPieces],
  );
  const onBackProblem = useCallback((text: string) => setProblem(text), []);

  const originOf = useCallback(
    (index: number): ScrapOrigin | null => {
      const element = pieceRefs.current.get(index);
      if (!element?.isConnected) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        rotation: pieces[index].rotation,
      };
    },
    [pieces],
  );

  const examine = (index: number) => {
    const origin = originOf(index);
    if (!origin) return;
    setHovered(null);
    setExamining({ at: order.indexOf(index), origin });
  };

  const step = (direction: 1 | -1) => {
    setExamining((current) => {
      if (!current) return current;
      const at = current.at + direction;
      if (at < 0 || at >= order.length) return current;
      return { at, origin: originOf(order[at]) ?? current.origin };
    });
  };

  const turn = useCallback(() => {
    setHovered(null);
    setOver((value) => !value);
  }, []);

  // T turns the collage over and esc turns it face up, as in the studio.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (examining || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "t" || event.key === "T") turn();
      else if (event.key === "Escape" && over) turn();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [examining, over, turn]);

  const examinedIndex = examining ? order[examining.at] : null;
  const examinedItem =
    examinedIndex === null ? null : shown[examinedIndex].item;
  const examinedPiece = examinedIndex === null ? null : pieces[examinedIndex];
  const title = collage.title.trim() || "untitled collage";
  const fitWidth = frame.width * scale;
  const fitHeight = frame.height * scale;

  return (
    <div
      className={`published-collage${chromeHidden ? " published-collage--bare" : ""}`}
    >
      <div
        className="published-collage__stage"
        style={{ paddingTop: room.top, paddingBottom: room.bottom }}
      >
        {!chromeHidden && (
          <div
            className="published-collage__toolbar"
            style={{ width: fitWidth + MAT * 2, height: TOOLBAR }}
          >
            <a className="published-collage__mark" href="/">
              we were online
            </a>
            <StudioViews
              turnedOver={over}
              sourcesOn={sourcesOn}
              canShowSources={!over}
              onTurnOver={turn}
              onSources={() => setSourcesOn((value) => !value)}
            />
          </div>
        )}
        <CollageMat
          width={fitWidth}
          height={fitHeight}
          caption={
            <>
              <h1 className="collage-title-input published-collage__title">
                {title}
              </h1>
              <span className="collage-bar__spacer" />
              <span className="collage-studio__label published-collage__meta">
                {captionMeta(collage, narrow)}
              </span>
            </>
          }
        >
          <div
            className={`collage-sheet${over ? " collage-sheet--over" : ""}`}
            style={{
              width: frame.width,
              height: frame.height,
              transform: `scale(${scale})`,
            }}
          >
            <div className="collage-sheet__leaf">
              <div
                className="collage-frame published-collage__frame"
                data-testid="published-collage-frame"
                inert={over}
                aria-label={`The front of ${title}`}
                style={{
                  width: frame.width,
                  height: frame.height,
                  ...paperBackground(
                    paper.color,
                    paper.grain,
                    frame.width,
                    frame.height,
                  ),
                }}
              >
                <div className="collage-frame__pieces">
                  {shown.map(({ piece }, index) => {
                    const source = sourceBoxForCrop(piece, piece.crop);
                    const lifted = hovered?.index === index;
                    const published = pieces[index];
                    return (
                      <div
                        key={piece.id}
                        ref={(element) => {
                          if (element) pieceRefs.current.set(index, element);
                          else pieceRefs.current.delete(index);
                        }}
                        className={`collage-piece published-collage__piece${
                          reveal.arrived.has(index)
                            ? " published-collage__piece--arrived"
                            : " published-collage__piece--waiting"
                        }${lifted ? " published-collage__piece--lifted" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${published.source.alt || published.source.kind} from ${published.source.domain || "an unknown site"}`}
                        data-piece={index}
                        data-kind={published.source.kind}
                        style={
                          {
                            left: piece.x,
                            top: piece.y,
                            width: piece.width,
                            height: piece.height,
                            zIndex: lifted ? pieces.length + 1 : piece.z + 1,
                            "--piece-rotation": `${piece.rotation}deg`,
                          } as React.CSSProperties
                        }
                        onPointerEnter={(event) => {
                          if (event.pointerType === "touch") return;
                          setHovered({
                            index,
                            rect: event.currentTarget.getBoundingClientRect(),
                          });
                        }}
                        onPointerLeave={() =>
                          setHovered((current) =>
                            current?.index === index ? null : current,
                          )
                        }
                        onClick={() => examine(index)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            examine(index);
                          }
                        }}
                      >
                        <div
                          className="collage-piece__source"
                          style={{
                            left: source.x - piece.x,
                            top: source.y - piece.y,
                            width: source.width,
                            height: source.height,
                            transform: pieceMaterialTransform(piece),
                            transformOrigin: "center",
                            pointerEvents: "none",
                          }}
                        >
                          <PieceMaterial piece={piece} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {shownMode !== "off" && (
                  <ProvenancePeek
                    pieces={studioPieces}
                    hoveredId={
                      hovered ? (studioPieces[hovered.index]?.id ?? null) : null
                    }
                    scale={scale}
                    bounds={{
                      x: 0,
                      y: 0,
                      width: frame.width,
                      height: frame.height,
                    }}
                  />
                )}
                <div className="collage-frame__edge" />
              </div>
              <CollageBackFace
                frame={frame}
                paper={paper}
                content={backContent}
                look={BACK_LOOK}
                front={front}
                showing={over}
                prepare={reveal.settled}
                onProblem={onBackProblem}
              />
            </div>
          </div>
        </CollageMat>
        {problem && (
          <p className="published-collage__problem" role="status">
            {problem}
          </p>
        )}
      </div>

      {hovered && !examining && shownMode === "off" && (
        <HoverLabel piece={pieces[hovered.index]} rect={hovered.rect} />
      )}

      {examining &&
        examinedItem &&
        examinedPiece &&
        createPortal(
          <ScrapLightbox
            key={examinedItem.key}
            item={examinedItem}
            origin={examining.origin}
            faviconSrc={faviconFor(examinedPiece) ?? ""}
            faviconAvailable={
              faviconFor(examinedPiece) !== null &&
              !failedFavicons.has(examinedPiece.source.domain)
            }
            onFaviconError={() =>
              setFailedFavicons((current) =>
                new Set(current).add(examinedPiece.source.domain),
              )
            }
            placeholderColor={placeholderColor(examinedPiece.source.domain)}
            hasPrevious={examining.at > 0}
            hasNext={examining.at < order.length - 1}
            prefersReducedMotion={prefersReducedMotion}
            currentOrigin={() =>
              examinedIndex === null ? null : originOf(examinedIndex)
            }
            onClose={() => setExamining(null)}
            onPrevious={() => step(-1)}
            onNext={() => step(1)}
          />,
          document.body,
        )}
    </div>
  );
}

function Notice({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="published-collage published-collage--notice">
      <header className="published-collage__head">
        <a className="published-collage__mark" href="/">
          we were online
        </a>
      </header>
      <div className="published-collage__notice" role="status">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function PublishedCollagePage() {
  const id = useMemo(() => publishedCollageIdFrom(window.location.search), []);
  const [load, setLoad] = useState<PublishedCollageLoad | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void loadPublishedCollage(WORKER_URL, id).then((result) => {
      if (!cancelled) setLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (load?.kind === "ok" && load.collage.title) {
      document.title = `${load.collage.title} · a collage on we were online`;
    }
  }, [load]);

  let body: React.ReactNode;
  if (!id) {
    body = (
      <Notice title="no collage here">
        <p>This link does not name a published collage.</p>
      </Notice>
    );
  } else if (!load) {
    body = (
      // A quiet line, as the studio shows while it opens.
      <div className="published-collage published-collage--notice">
        <p className="collage-studio__label" role="status">
          opening the collage...
        </p>
      </div>
    );
  } else if (load.kind === "missing") {
    body = (
      <Notice title="this collage is no longer shared">
        <p>Whoever shared it has taken the link down, or it never existed.</p>
      </Notice>
    );
  } else if (load.kind === "error") {
    body = (
      <Notice title="the collage could not be opened">
        <p>{load.message}</p>
        <button
          type="button"
          className="published-collage__retry"
          onClick={() => window.location.reload()}
        >
          try again
        </button>
      </Notice>
    );
  } else {
    body = <Viewer collage={load.collage} id={id} />;
  }

  return (
    <>
      <style>{COLLAGE_STYLES}</style>
      <style>{COLLAGE_SHEET_STYLES}</style>
      <style>{PIECE_MATERIAL_STYLES}</style>
      <style>{COLLAGE_MAT_STYLES}</style>
      <style>{COLLAGE_PIECE_TOOL_STYLES}</style>
      <style>{COLLAGE_VIEW_STYLES}</style>
      <style>{COLLAGE_PEEK_STYLES}</style>
      <style>{VIEWER_STYLES}</style>
      {body}
    </>
  );
}

const container = document.getElementById("reactContent");
if (container) createRoot(container).render(<PublishedCollagePage />);
