// ABOUTME: View-only page for a collage published from the scraps studio, fetched from the Worker by ?id=.
// ABOUTME: The framed front draws pieces as the studio does; turn it over for the studio's real back face.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { WORKER_URL } from "@movement/config";
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
import {
  pieceBounds,
  placeTags,
  tintPieces,
  type TagRequest,
} from "@extension/entrypoints/scraps/peekTags";
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
  viewerPieces,
  publishedCollageIdFrom,
  publishedImageUrl,
  sourceLabel,
  type PublishedCollageLoad,
  type SourcesMode,
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
/** A tag's size before it has been measured, in screen pixels. */
const ASSUMED_TAG = { width: 120, height: 18 };
const NEAR_ON_SCREEN = 48;

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

/** Labels pinned beside every piece while the sources show, set like the studio's peek. */
function SourceTags({
  pieces,
  mode,
  scale,
  frame,
  hovered,
}: {
  pieces: readonly PublishedCollagePiece[];
  mode: Exclude<SourcesMode, "off">;
  scale: number;
  frame: { width: number; height: number };
  hovered: number | null;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const tintsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});

  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const measure = () => {
      const measured: Record<string, { width: number; height: number }> = {};
      for (const node of holder.querySelectorAll<HTMLElement>("[data-tag]")) {
        const id = node.dataset.tag;
        if (!id) continue;
        const box = node.getBoundingClientRect();
        measured[id] = { width: box.width / scale, height: box.height / scale };
      }
      setSizes(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of holder.querySelectorAll("[data-tag]"))
      observer.observe(node);
    return () => observer.disconnect();
  }, [pieces, scale, mode]);

  const covered = pieces.map((piece, index) => ({
    id: String(index),
    bounds: pieceBounds(piece),
  }));
  const tints = tintPieces(covered, tintsRef.current, NEAR_ON_SCREEN / scale);
  tintsRef.current = tints;
  const requests: TagRequest[] = covered.map(({ id, bounds }) => {
    const size = sizes[id] ?? {
      width: ASSUMED_TAG.width / scale,
      height: ASSUMED_TAG.height / scale,
    };
    return {
      pieceId: id,
      piece: bounds,
      width: size.width,
      height: size.height,
    };
  });
  const placed = new Map(
    placeTags(requests, {
      x: 0,
      y: 0,
      width: frame.width,
      height: frame.height,
    }).map((tag) => [tag.pieceId, tag] as const),
  );

  return (
    <div ref={holderRef} className="published-collage__tags" aria-hidden="true">
      {pieces.map((piece, index) => {
        const id = String(index);
        const tag = placed.get(id);
        const tint = { "--peek-tint": tints.get(id) } as React.CSSProperties;
        return (
          <React.Fragment key={id}>
            <div
              className={`published-collage__edge${hovered === index ? " published-collage__edge--on" : ""}`}
              style={{
                left: piece.x,
                top: piece.y,
                width: piece.width,
                height: piece.height,
                transform: `rotate(${piece.rotation}deg)`,
                borderWidth: 1 / scale,
                ...tint,
              }}
            />
            <div
              data-tag={id}
              className="published-collage__tag"
              style={{
                left: tag?.x ?? piece.x,
                top: tag?.y ?? piece.y,
                transform: `scale(${1 / scale})`,
                ...tint,
              }}
            >
              <Favicon piece={piece} size={10} />
              <span className="published-collage__tag-text">
                {sourceLabel(piece, mode)}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
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
 * The baked front, for the back to show faintly through, drawn only once the
 * collage is first turned over. Without it the back is plain paper.
 */
function useBakedFront(
  wanted: boolean,
  collage: PublishedCollage,
  pieces: readonly CollagePiece[],
): Blob | null {
  const [front, setFront] = useState<Blob | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || started.current) return;
    started.current = true;
    bakeCollage({
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
  }, [collage, pieces, wanted]);
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
      viewerPieces(collage, (ref) => publishedImageUrl(WORKER_URL, id, ref)),
    [collage, id],
  );
  const studioPieces = useMemo(
    () => shown.map((entry) => entry.piece),
    [shown],
  );

  const front = useBakedFront(over, collage, studioPieces);
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
                        className={`collage-piece published-collage__piece${lifted ? " published-collage__piece--lifted" : ""}`}
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
                  <SourceTags
                    pieces={pieces}
                    mode={shownMode}
                    scale={scale}
                    frame={frame}
                    hovered={hovered?.index ?? null}
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
      <Notice title="unfolding the collage…">
        <p className="published-collage__loading" aria-hidden="true" />
      </Notice>
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
      <style>{VIEWER_STYLES}</style>
      {body}
    </>
  );
}

const container = document.getElementById("reactContent");
if (container) createRoot(container).render(<PublishedCollagePage />);
