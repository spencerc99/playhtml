// ABOUTME: View-only page for a collage shared from the scraps studio, fetched from the Worker by ?id=.
// ABOUTME: Hover a piece to see it, click to examine it in the scraps lightbox, toggle or hold i for sources.

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
import { paperBackground } from "@extension/entrypoints/scraps/paperGrain";
import { sourceBoxForCrop } from "@extension/entrypoints/scraps/collageGeometry";
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
  SharedCollage,
  SharedCollagePiece,
} from "../../shared/sharedCollage";
import {
  SOURCES_MODES,
  faviconFor,
  fitScale,
  loadSharedCollage,
  pieceScrapItem,
  placeholderColor,
  placementStyle,
  readingOrder,
  sharedCollageIdFrom,
  sharedImageUrl,
  sourceLabel,
  type SharedCollageLoad,
  type SourcesMode,
} from "./sharedCollageView";
import { VIEWER_STYLES } from "./collageViewerStyles";

/** Room above the frame for the title and the toggle, and below it for the hint. */
const CHROME_TOP = 64;
const CHROME_BOTTOM = 44;
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

function Favicon({ piece, size }: { piece: SharedCollagePiece; size: number }) {
  const src = faviconFor(piece);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className="shared-collage__favicon"
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
      className="shared-collage__favicon"
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
  pieces: readonly SharedCollagePiece[];
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
    <div ref={holderRef} className="shared-collage__tags" aria-hidden="true">
      {pieces.map((piece, index) => {
        const id = String(index);
        const tag = placed.get(id);
        const tint = { "--peek-tint": tints.get(id) } as React.CSSProperties;
        return (
          <React.Fragment key={id}>
            <div
              className={`shared-collage__edge${hovered === index ? " shared-collage__edge--on" : ""}`}
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
              className="shared-collage__tag"
              style={{
                left: tag?.x ?? piece.x,
                top: tag?.y ?? piece.y,
                transform: `scale(${1 / scale})`,
                ...tint,
              }}
            >
              <Favicon piece={piece} size={10} />
              <span className="shared-collage__tag-text">
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
  piece: SharedCollagePiece;
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
      className="shared-collage__hover"
      role="status"
      style={{ left, top, width }}
    >
      <span className="shared-collage__hover-where">
        <Favicon piece={piece} size={12} />
        {piece.source.domain || "an unknown site"}
      </span>
      {title && <span className="shared-collage__hover-title">{title}</span>}
    </div>
  );
}

function SourcesToggle({
  mode,
  onMode,
}: {
  mode: SourcesMode;
  onMode: (mode: SourcesMode) => void;
}) {
  return (
    <div className="collage-views" role="toolbar" aria-label="Sources">
      <span className="shared-collage__views-label">sources</span>
      {SOURCES_MODES.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`collage-view${mode === choice ? " collage-view--on" : ""}`}
          aria-pressed={mode === choice}
          title={
            choice === "off"
              ? "Hide sources (hold i to peek)"
              : choice === "site"
                ? "Label each piece with the site it came from"
                : "Label each piece with the page it came from"
          }
          onClick={() => onMode(choice)}
        >
          <span>{choice}</span>
        </button>
      ))}
    </div>
  );
}

function formatShared(ts: number | undefined): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Viewer({ collage, id }: { collage: SharedCollage; id: string }) {
  const { frame, paper, pieces } = collage;
  const windowSize = useWindowSize();
  const chromeHidden = useChromeToggle();
  const peekHeld = usePeekHeld();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<SourcesMode>("off");
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
  const pieceRefs = useRef(new Map<number, HTMLDivElement>());

  const narrow = windowSize.width < 600;
  const gutter = narrow ? 16 : 32;
  // On a phone the sources toggle sits under the collage, above the footer.
  const chromeBottom = narrow ? 84 : CHROME_BOTTOM;
  const scale = fitScale(frame, {
    width: windowSize.width - gutter * 2,
    height:
      windowSize.height -
      (chromeHidden ? gutter * 2 : CHROME_TOP + chromeBottom),
  });
  const shownMode: SourcesMode = mode === "off" && peekHeld ? "title" : mode;

  const order = useMemo(
    () => readingOrder(pieces, frame.height),
    [pieces, frame.height],
  );
  const items = useMemo(
    () =>
      pieces.map((piece, index) =>
        pieceScrapItem(
          piece,
          index,
          sharedImageUrl(WORKER_URL, id, piece.image),
        ),
      ),
    [id, pieces],
  );

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

  const examinedIndex = examining ? order[examining.at] : null;
  const examinedItem = examinedIndex === null ? null : items[examinedIndex];
  const examinedPiece = examinedIndex === null ? null : pieces[examinedIndex];
  const sharedOn = formatShared(collage.sharedAt);

  return (
    <div
      className={`shared-collage${chromeHidden ? " shared-collage--bare" : ""}`}
    >
      {!chromeHidden && (
        <header className="shared-collage__head">
          <a className="shared-collage__mark" href="/">
            we were online
          </a>
          <h1 className="shared-collage__title">
            {collage.title || "untitled collage"}
          </h1>
        </header>
      )}
      {!chromeHidden && <SourcesToggle mode={mode} onMode={setMode} />}

      <div
        className="shared-collage__stage"
        style={{
          top: chromeHidden ? gutter : CHROME_TOP,
          bottom: chromeHidden ? gutter : chromeBottom,
        }}
      >
        <div
          className="shared-collage__fit"
          style={{ width: frame.width * scale, height: frame.height * scale }}
        >
          <div
            className={`shared-collage__frame${hovered ? " shared-collage__frame--looking" : ""}`}
            data-testid="shared-collage-frame"
            style={{
              width: frame.width,
              height: frame.height,
              transform: `scale(${scale})`,
              ...paperBackground(
                paper.color,
                paper.grain,
                frame.width,
                frame.height,
              ),
            }}
          >
            <div className="shared-collage__pieces">
              {pieces.map((piece, index) => {
                const source = sourceBoxForCrop(piece, piece.crop);
                const lifted = hovered?.index === index;
                const flip = `scale(${piece.flipX ? -1 : 1}, ${piece.flipY ? -1 : 1})`;
                return (
                  <div
                    key={index}
                    ref={(element) => {
                      if (element) pieceRefs.current.set(index, element);
                      else pieceRefs.current.delete(index);
                    }}
                    className={`shared-collage__piece${lifted ? " shared-collage__piece--lifted" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${piece.source.alt || piece.source.kind} from ${piece.source.domain}`}
                    data-piece={index}
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
                      className="shared-collage__source"
                      style={{
                        left: source.x - piece.x,
                        top: source.y - piece.y,
                        width: source.width,
                        height: source.height,
                        transform: flip === "scale(1, 1)" ? "none" : flip,
                      }}
                    >
                      <img
                        className="shared-collage__image"
                        src={
                          items[index].kind === "image"
                            ? items[index].src
                            : undefined
                        }
                        alt=""
                        draggable={false}
                        style={placementStyle(piece)}
                      />
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
          </div>
        </div>
      </div>

      {!chromeHidden && (
        <footer className="shared-collage__foot">
          <span>
            {pieces.length} {pieces.length === 1 ? "piece" : "pieces"}
            {sharedOn ? ` · shared ${sharedOn}` : ""}
          </span>
          <span className="shared-collage__hint">
            hover to look · click to examine · hold i for sources
          </span>
        </footer>
      )}

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
    <div className="shared-collage shared-collage--notice">
      <header className="shared-collage__head">
        <a className="shared-collage__mark" href="/">
          we were online
        </a>
      </header>
      <div className="shared-collage__notice" role="status">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SharedCollagePage() {
  const id = useMemo(() => sharedCollageIdFrom(window.location.search), []);
  const [load, setLoad] = useState<SharedCollageLoad | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void loadSharedCollage(WORKER_URL, id).then((result) => {
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
        <p>This link does not name a shared collage.</p>
      </Notice>
    );
  } else if (!load) {
    body = (
      <Notice title="unfolding the collage…">
        <p className="shared-collage__loading" aria-hidden="true" />
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
          className="shared-collage__retry"
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
      <style>{VIEWER_STYLES}</style>
      <style>{COLLAGE_VIEW_STYLES}</style>
      {body}
    </>
  );
}

const container = document.getElementById("reactContent");
if (container) createRoot(container).render(<SharedCollagePage />);
