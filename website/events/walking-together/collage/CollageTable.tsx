// ABOUTME: The shared table where a small group drops, moves, turns, and sizes scraps together.
// ABOUTME: Gestures stay local (plus a live preview) and commit to shared data on release.
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { playhtml, usePlayerIdentity } from "@playhtml/react";
import { PieceActions } from "@extension/entrypoints/scraps/PieceActions";
import { CropSession } from "@extension/entrypoints/scraps/CropSession";
import { CutoutControl } from "@extension/entrypoints/scraps/CutoutControl";
import { PieceMaterial } from "@extension/entrypoints/scraps/PieceMaterial";
import {
  commitCropSession,
  cropSessionStart,
  pieceMaterialTransform,
} from "@extension/entrypoints/scraps/collageRecord";
import {
  DEFAULT_CUTOUT_TOLERANCE,
  type PieceCutout,
} from "@extension/entrypoints/scraps/backgroundCutout";
import type { CropFraction } from "@extension/entrypoints/scraps/collageGeometry";
import { COLLAGE_PIECE_TOOL_STYLES } from "@extension/entrypoints/scraps/collagePieceToolStyles";
import { COLLAGE_VIEW_STYLES } from "@extension/entrypoints/scraps/collageViewStyles";
import { isAdmin } from "../admin";
import {
  makePiece,
  movedTransform,
  orderAroundCentroid,
  piecesOf,
  remoteDragTransforms,
  rotateResizeTransform,
  sortedPieces,
  sourceDomain,
  templatePointsFromCursors,
  topZ,
  transformChanged,
  transformOf,
  type Placer,
  type CollageData,
  type CollageLive,
  type Piece,
  type PieceTransform,
  type Pieces,
} from "./pieces";
import {
  isScrapDrag,
  measureImage,
  scrapInputFromDrag,
  type ScrapInput,
} from "./scrapInput";
import { downloadBlob, renderCollagePng } from "./exportPng";
import { ScrapsPanel } from "./ScrapsPanel";
import {
  duplicatedPiece,
  placementFromStudio,
  reorderedZ,
  toStudioPiece,
  type OrderMove,
} from "./studioBridge";
import "./collage.scss";

interface Props {
  data: CollageData;
  setData: (data: CollageData | ((draft: CollageData) => void)) => void;
  /** Everyone's in-progress drag, from the drag presence channel. */
  peers: Array<{ user: { isMe: boolean }; live: CollageLive | undefined }>;
  setLive: (live: CollageLive) => void;
}

/** A gesture in progress on one piece. Kept out of shared data until release. */
interface Gesture {
  id: string;
  mode: "move" | "turn";
  start: PieceTransform;
  startPointer: { x: number; y: number };
  /** Piece center in table pixels at the start of a turn gesture. */
  centerPx: { x: number; y: number };
  moved: boolean;
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** A head and shoulders: who put each scrap down. Drawn like the studio's
 * view glyphs so the toggle reads as one of them. */
const WHO_GLYPH = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle
      cx="8"
      cy="5.5"
      r="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
    />
    <path
      d="M3 13.5a5 5 0 0 1 10 0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
    />
  </svg>
);

function newPieceId(pid: string): string {
  return `${pid.slice(0, 8)}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function CollageTable({ data, setData, peers, setLive }: Props) {
  const { pid, name, color } = usePlayerIdentity();
  const admin = isAdmin(name, color);
  const pieces = piecesOf(data);
  const templatePoints = Object.values(data?.templatePoints ?? {});

  const tableRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(tableRef);

  // Latest shared pieces for event handlers, so handlers never need to be
  // recreated (or re-subscribed) when shared data changes.
  const piecesRef = useRef<Pieces>(pieces);
  piecesRef.current = pieces;

  const [gesture, setGesture] = useState<{
    id: string;
    transform: PieceTransform;
  } | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});
  const [dropActive, setDropActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [whoOn, setWhoOn] = useState(false);
  // Holding i shows who added what while it's held, as holding i shows
  // sources in the studio.
  const [whoHeld, setWhoHeld] = useState(false);
  const showWho = whoOn || whoHeld;
  // Editing state is local to this viewer: the piece in hand, and a crop or
  // cutout being tuned. Only the finished edit is written to shared data.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cropping, setCropping] = useState<{
    id: string;
    crop: CropFraction;
  } | null>(null);
  const [cutting, setCutting] = useState<{
    id: string;
    tolerance: number;
    inverted: boolean;
  } | null>(null);
  const [failedCuts, setFailedCuts] = useState<Record<string, true>>({});

  const remote = remoteDragTransforms(peers);

  const flashNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(
      () => setNotice((current) => (current === message ? null : current)),
      3200,
    );
  }, []);

  /** The one entrypoint every scrap source uses to put a scrap on the table.
   * `at` is a point relative to the table; omitted, the scrap lands near the
   * middle. */
  const addScrap = useCallback(
    async (input: ScrapInput, at?: { x: number; y: number }) => {
      if (!pid) {
        flashNotice("still connecting, try again in a moment");
        return;
      }
      const measured =
        input.naturalWidth && input.naturalHeight
          ? { width: input.naturalWidth, height: input.naturalHeight }
          : await measureImage(input.src);
      const table = tableRef.current;
      const tableAspect =
        table && table.clientHeight > 0
          ? table.clientWidth / table.clientHeight
          : 16 / 9;
      const point = at ?? {
        x: 0.5 + (Math.random() - 0.5) * 0.2,
        y: 0.5 + (Math.random() - 0.5) * 0.2,
      };
      const piece = makePiece(
        {
          src: input.src,
          pageUrl: input.pageUrl,
          alt: input.alt,
          aspect: measured ? measured.height / measured.width : NaN,
        },
        { pid, name: name || "someone", color: color || "#888888" },
        point,
        piecesRef.current,
        tableAspect,
        { id: newPieceId(pid), now: Date.now(), random: Math.random },
      );
      setData((draft) => {
        // A room whose collage data predates a field has no map to key into.
        if (!draft.pieces) {
          draft.pieces = { [piece.id]: piece };
          return;
        }
        draft.pieces[piece.id] = piece;
      });
    },
    [pid, name, color, setData, flashNotice],
  );

  // ---- Gestures: move and turn ------------------------------------------

  const tablePoint = (clientX: number, clientY: number) => {
    const rect = tableRef.current?.getBoundingClientRect();
    return rect
      ? { x: clientX - rect.left, y: clientY - rect.top }
      : { x: clientX, y: clientY };
  };

  const startGesture = (
    e: React.PointerEvent,
    piece: Piece,
    mode: Gesture["mode"],
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (selectedId !== piece.id) finishEditing();
    setSelectedId(piece.id);
    // A locked piece can be picked up to unlock it, but not moved or turned.
    if (piece.locked) return;
    const start = transformOf(piece);
    gestureRef.current = {
      id: piece.id,
      mode,
      start,
      startPointer: tablePoint(e.clientX, e.clientY),
      centerPx: { x: piece.x * size.width, y: piece.y * size.height },
      moved: false,
    };
    setGesture({ id: piece.id, transform: start });

    let frame = 0;
    let latest = start;
    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || size.width <= 0 || size.height <= 0) return;
      const pointer = tablePoint(ev.clientX, ev.clientY);
      latest =
        g.mode === "move"
          ? movedTransform(g.start, {
              dx: (pointer.x - g.startPointer.x) / size.width,
              dy: (pointer.y - g.startPointer.y) / size.height,
            })
          : rotateResizeTransform(g.start, g.centerPx, g.startPointer, pointer);
      g.moved = g.moved || transformChanged(g.start, latest);
      setGesture({ id: g.id, transform: latest });
      // Broadcast the in-progress transform at most once per frame. This is
      // presence, not shared data: nothing is stored until release.
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setLive({ drag: { id: g.id, transform: latest } });
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (frame) cancelAnimationFrame(frame);
      const g = gestureRef.current;
      gestureRef.current = null;
      setGesture(null);
      setLive({ drag: null });
      if (!g) return;
      commitGesture(g, latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /** One shared write per gesture, only when the piece actually moved. A
   * plain press just picks the piece up; layering is in its tools. */
  const commitGesture = (g: Gesture, final: PieceTransform) => {
    if (!g.moved) return;
    setData((draft) => {
      const piece = draft.pieces?.[g.id];
      // Someone may have removed it mid-gesture.
      if (!piece) return;
      piece.x = final.x;
      piece.y = final.y;
      piece.width = final.width;
      piece.rotation = final.rotation;
    });
  };

  // ---- Piece tools, reused from the scraps studio -------------------------

  const placer = (): Placer | null =>
    pid ? { pid, name: name || "someone", color: color || "#888888" } : null;

  const orderPiece = (id: string, to: OrderMove) => {
    const changed = reorderedZ(piecesRef.current, id, to);
    if (Object.keys(changed).length === 0) return;
    setData((draft) => {
      for (const [pieceId, z] of Object.entries(changed)) {
        const piece = draft.pieces?.[pieceId];
        if (piece) piece.z = z;
      }
    });
  };

  const flipPiece = (id: string, axis: "x" | "y") => {
    setData((draft) => {
      const piece = draft.pieces?.[id];
      if (!piece) return;
      if (axis === "x") piece.flipX = !piece.flipX;
      else piece.flipY = !piece.flipY;
    });
  };

  const toggleLock = (id: string) => {
    setData((draft) => {
      const piece = draft.pieces?.[id];
      if (!piece) return;
      if (piece.locked) delete piece.locked;
      else piece.locked = true;
    });
  };

  const duplicate = (id: string) => {
    const source = piecesRef.current[id];
    const me = placer();
    if (!source || !me) return;
    const copy = duplicatedPiece(source, me, {
      id: newPieceId(me.pid),
      now: Date.now(),
      z: topZ(piecesRef.current) + 1,
    });
    setData((draft) => {
      if (!draft.pieces) {
        draft.pieces = { [copy.id]: copy };
        return;
      }
      draft.pieces[copy.id] = copy;
    });
    setSelectedId(copy.id);
  };

  const startCrop = (id: string) => {
    const piece = piecesRef.current[id];
    if (!piece || size.width <= 0) return;
    setCutting(null);
    setCropping({ id, crop: cropSessionStart(toStudioPiece(piece, size)) });
  };

  /** Writes the crop a session ended on; one that ended where it began writes
   * nothing. */
  const commitCrop = () => {
    const session = cropping;
    setCropping(null);
    if (!session) return;
    const piece = piecesRef.current[session.id];
    if (!piece || size.width <= 0) return;
    const before = toStudioPiece(piece, size);
    const after = commitCropSession(before, session.crop);
    if (after === before) return;
    const placement = placementFromStudio(after, size);
    setData((draft) => {
      const target = draft.pieces?.[session.id];
      if (!target) return;
      target.x = placement.x;
      target.y = placement.y;
      target.width = placement.width;
      target.aspect = placement.aspect;
      target.crop = placement.crop;
    });
  };

  const startCutout = (id: string) => {
    const piece = piecesRef.current[id];
    if (!piece) return;
    setCropping(null);
    setFailedCuts((failed) => {
      if (!failed[id]) return failed;
      const { [id]: _gone, ...rest } = failed;
      return rest;
    });
    setCutting({
      id,
      tolerance: piece.cutout?.tolerance ?? DEFAULT_CUTOUT_TOLERANCE,
      inverted: piece.cutout?.keep === "background",
    });
  };

  const cutoutOf = (session: { tolerance: number; inverted: boolean }) =>
    ({
      method: "edge-color",
      tolerance: session.tolerance,
      ...(session.inverted ? { keep: "background" } : {}),
    }) satisfies PieceCutout;

  /** Writes the tuned cutout, or takes it off when `keep` is false. */
  const finishCutout = (keep: boolean) => {
    const session = cutting;
    setCutting(null);
    if (!session) return;
    setData((draft) => {
      const piece = draft.pieces?.[session.id];
      if (!piece) return;
      if (keep) piece.cutout = cutoutOf(session);
      else if (piece.cutout) delete piece.cutout;
    });
  };

  const onCutoutFailed = useCallback(
    (pieceId: string) => {
      setFailedCuts((failed) =>
        failed[pieceId] ? failed : { ...failed, [pieceId]: true },
      );
      flashNotice("this scrap's site won't share its pixels, so it can't be cut out");
    },
    [flashNotice],
  );

  /** Ends any crop or cutout in progress, keeping what was tuned. */
  const finishEditing = () => {
    if (cropping) commitCrop();
    if (cutting) finishCutout(true);
  };

  const deselect = () => {
    finishEditing();
    setSelectedId(null);
  };

  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      !!(e.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable]",
      );
    const down = (e: KeyboardEvent) => {
      if (e.key === "i" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e))
        setWhoHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "i") setWhoHeld(false);
    };
    const release = () => setWhoHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Enter or Escape ends a crop; Escape alone puts the piece down.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Enter" && cropping) commitCrop();
      if (e.key === "Escape") deselect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A piece someone else removed can't stay in hand.
  const selectedGone = !!selectedId && !pieces[selectedId];
  useEffect(() => {
    if (!selectedGone) return;
    setSelectedId(null);
    setCropping(null);
    setCutting(null);
  }, [selectedGone]);

  const removePiece = (piece: Piece) => {
    if (piece.placedByPid !== pid) {
      flashNotice(`only ${piece.placedByName || "whoever added it"} can remove this scrap`);
      return;
    }
    if (selectedId === piece.id) {
      setSelectedId(null);
      setCropping(null);
      setCutting(null);
    }
    setData((draft) => {
      if (draft.pieces?.[piece.id]) delete draft.pieces[piece.id];
    });
  };

  // ---- Drop from the film strip ------------------------------------------

  const onDragOver = (e: React.DragEvent) => {
    if (!isScrapDrag(Array.from(e.dataTransfer.types))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  };

  const onDrop = (e: React.DragEvent) => {
    setDropActive(false);
    e.preventDefault();
    const input = scrapInputFromDrag(e.dataTransfer);
    if (!input) return;
    const p = tablePoint(e.clientX, e.clientY);
    void addScrap(
      input,
      size.width > 0 && size.height > 0
        ? { x: p.x / size.width, y: p.y / size.height }
        : undefined,
    );
  };

  // ---- Admin ------------------------------------------------------------

  const captureShape = () => {
    const table = tableRef.current;
    const client = playhtml.cursorClient;
    if (!table || !client) {
      flashNotice("cursors are not connected yet");
      return;
    }
    const cursors = Array.from(client.getCursorPresences().entries()).flatMap(
      ([key, presence]) =>
        presence.cursor
          ? [
              {
                key,
                x: presence.cursor.x,
                y: presence.cursor.y,
                color:
                  presence.playerIdentity?.playerStyle.colorPalette[0] ??
                  "#888888",
              },
            ]
          : [],
    );
    // The admin's own cursor is on this button, not in the shape.
    const points = templatePointsFromCursors(
      cursors,
      table.getBoundingClientRect(),
      pid,
    );
    if (Object.keys(points).length === 0) {
      flashNotice("no cursors on the table to capture");
      return;
    }
    setData((draft) => {
      draft.templatePoints = points;
    });
  };

  const clearShape = () => {
    setData((draft) => {
      draft.templatePoints = {};
    });
  };

  /** Clears every scrap off the table, for a fresh start between runs. */
  const clearTable = () => {
    if (!window.confirm("Clear every scrap off the table for everyone?")) return;
    setData((draft) => {
      for (const id of Object.keys(draft.pieces ?? {})) delete draft.pieces[id];
    });
  };

  const exportPng = async () => {
    if (exporting || size.width <= 0) return;
    setExporting(true);
    try {
      const blob = await renderCollagePng(piecesRef.current, size);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `walking-together-collage-${stamp}.png`);
    } catch (err) {
      console.error("[collage] export failed", err);
      flashNotice("export failed, see the console");
    } finally {
      setExporting(false);
    }
  };

  // ---- Render -----------------------------------------------------------

  const ordered = sortedPieces(pieces);
  const frontZ = topZ(pieces) + 1;
  const tableAspect = size.height > 0 ? size.width / size.height : 1;
  const outline = orderAroundCentroid(templatePoints, tableAspect);

  return (
    <div
      ref={tableRef}
      className={[
        "collage-table",
        dropActive ? "collage-table--drop" : "",
        showWho ? "collage-table--who" : "",
      ].join(" ")}
      onPointerDown={(e) => {
        // Pieces and controls stop their own presses; anything reaching the
        // table itself is a press on the bare table.
        if (e.button === 0) deselect();
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      <style>{COLLAGE_PIECE_TOOL_STYLES}</style>
      <style>{COLLAGE_VIEW_STYLES}</style>
      {templatePoints.length > 0 && size.width > 0 && (
        <svg
          className="collage-template"
          width={size.width}
          height={size.height}
          aria-hidden="true"
        >
          {outline.length >= 3 && (
            <polygon
              points={outline
                .map((p) => `${p.x * size.width},${p.y * size.height}`)
                .join(" ")}
            />
          )}
          {outline.length === 2 && (
            <line
              x1={outline[0].x * size.width}
              y1={outline[0].y * size.height}
              x2={outline[1].x * size.width}
              y2={outline[1].y * size.height}
            />
          )}
          {templatePoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x * size.width}
              cy={p.y * size.height}
              r={4}
              style={{ fill: p.color }}
            />
          ))}
        </svg>
      )}

      {size.width > 0 &&
        ordered.map((piece) => {
          const mine = gesture?.id === piece.id;
          const t = mine
            ? gesture.transform
            : remote[piece.id] ?? transformOf(piece);
          const widthPx = t.width * size.width;
          const heightPx = widthPx * piece.aspect;
          const hovered = hoveredId === piece.id;
          const own = !!pid && piece.placedByPid === pid;
          const failed = !!failedSrcs[piece.src];
          const domain = sourceDomain(piece);
          const selected = selectedId === piece.id;
          const tuning = cutting?.id === piece.id ? cutting : null;
          // While its cutout is tuned, the piece shows the edge being tuned.
          const shown: Piece = tuning
            ? { ...piece, cutout: cutoutOf(tuning) }
            : piece;
          const studio = toStudioPiece(shown, size, t);
          const crop = studio.crop;
          const cut = !!shown.cutout && !failedCuts[piece.id];
          // Height of the turned scrap's bounding box, so the hover label sits
          // just under the scrap at any rotation.
          const turn = (t.rotation * Math.PI) / 180;
          const boundsHeight =
            Math.abs(widthPx * Math.sin(turn)) +
            Math.abs(heightPx * Math.cos(turn));
          return (
            <div
              key={piece.id}
              className={[
                "collage-piece",
                mine ? "collage-piece--active" : "",
                remote[piece.id] ? "collage-piece--remote" : "",
                selected ? "collage-piece--selected" : "",
                piece.locked ? "collage-piece--locked" : "",
                cut ? "collage-piece--cut" : "",
                cropping?.id === piece.id ? "collage-piece--cropping" : "",
              ].join(" ")}
              data-piece-id={piece.id}
              style={{
                left: t.x * size.width,
                top: t.y * size.height,
                width: widthPx,
                height: heightPx,
                zIndex: mine ? frontZ : piece.z,
              }}
            >
              <div
                className="collage-piece__paper"
                style={
                  {
                    transform: `rotate(${t.rotation}deg)`,
                    "--placed-by-color": piece.placedByColor,
                  } as React.CSSProperties
                }
                onPointerDown={(e) => startGesture(e, piece, "move")}
                onPointerEnter={() => setHoveredId(piece.id)}
                onPointerLeave={() =>
                  setHoveredId((h) => (h === piece.id ? null : h))
                }
              >
                {failed ? (
                  <div className="collage-piece__torn">
                    <span>{domain || "a scrap"}</span>
                  </div>
                ) : (
                  <div className="collage-piece__window">
                    {/* The whole source image, placed so the crop lands in
                        the piece's box and mirrored inside it. */}
                    <div
                      className="collage-piece__source"
                      style={{
                        left: `${(-crop.x / crop.width) * 100}%`,
                        top: `${(-crop.y / crop.height) * 100}%`,
                        width: `${100 / crop.width}%`,
                        height: `${100 / crop.height}%`,
                        transform: pieceMaterialTransform(studio),
                      }}
                    >
                      {cut ? (
                        <PieceMaterial
                          piece={studio}
                          onCutoutFailed={onCutoutFailed}
                        />
                      ) : (
                        <img
                          src={piece.src}
                          alt={piece.alt}
                          draggable={false}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedSrcs((f) => ({ ...f, [piece.src]: true }))
                          }
                        />
                      )}
                    </div>
                  </div>
                )}
                {!piece.locked && (
                  <div
                    className="collage-piece__handle"
                    title="turn and resize"
                    onPointerDown={(e) => startGesture(e, piece, "turn")}
                  />
                )}
                {own && (
                  <button
                    className="collage-piece__remove"
                    title="remove your scrap"
                    aria-label="remove your scrap"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removePiece(piece)}
                  >
                    ×
                  </button>
                )}
              </div>
              {(hovered || mine || showWho) && (
                <div
                  className="collage-piece__label"
                  style={{ top: `calc(50% + ${boundsHeight / 2 + 10}px)` }}
                >
                  <span style={{ color: piece.placedByColor }}>
                    {piece.placedByName}
                  </span>
                  {domain && <span className="collage-piece__domain">{domain}</span>}
                </div>
              )}
            </div>
          );
        })}

      {(() => {
        const piece = selectedId ? pieces[selectedId] : undefined;
        if (!piece || size.width <= 0) return null;
        const studio = toStudioPiece(piece, size);
        const frameSize = { width: size.width, height: size.height };
        if (cropping?.id === piece.id) {
          return (
            <div
              className="collage-crop-layer"
              style={{ zIndex: frontZ + 1 }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <CropSession
                piece={studio}
                crop={cropping.crop}
                onChange={(crop) => setCropping({ id: piece.id, crop })}
                onCommit={commitCrop}
                framePoint={(e) => tablePoint(e.clientX, e.clientY)}
              />
            </div>
          );
        }
        if (cutting?.id === piece.id) {
          return (
            <CutoutControl
              piece={studio}
              tolerance={cutting.tolerance}
              inverted={cutting.inverted}
              scale={1}
              frame={frameSize}
              onTolerance={(tolerance) =>
                setCutting((c) => (c ? { ...c, tolerance } : c))
              }
              onInvert={() =>
                setCutting((c) => (c ? { ...c, inverted: !c.inverted } : c))
              }
              onKeepBackground={() => finishCutout(false)}
              onDone={() => finishCutout(true)}
            />
          );
        }
        if (gesture?.id === piece.id) return null;
        return (
          <PieceActions
            box={studio}
            piece={studio}
            canCutOut={true}
            scale={1}
            frame={frameSize}
            onOrder={(to) => orderPiece(piece.id, to)}
            onFlip={(axis) => flipPiece(piece.id, axis)}
            onCrop={() => startCrop(piece.id)}
            onCutOut={() => startCutout(piece.id)}
            onLock={() => toggleLock(piece.id)}
            lockHint={piece.locked ? "anyone can unlock it" : "nobody can move it until it's unlocked"}
            locked={!!piece.locked}
            onDuplicate={() => duplicate(piece.id)}
            onRemove={() => removePiece(piece)}
          />
        );
      })()}

      {ordered.length === 0 && (
        <p className="collage-empty">
          scraps from the walk land here
        </p>
      )}

      <div className="collage-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        {notice && <span className="collage-toolbar__note">{notice}</span>}
      </div>

      <div className="collage-views" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`collage-view${showWho && ordered.length > 0 ? " collage-view--on" : ""}`}
          title="Show who added each scrap (or hold i)"
          aria-label="Show who added what"
          aria-pressed={showWho && ordered.length > 0}
          disabled={ordered.length === 0}
          onClick={() => setWhoOn((on) => !on)}
        >
          {WHO_GLYPH}
          <span>who added</span>
        </button>
      </div>

      <ScrapsPanel
        placedSrcs={new Set(ordered.map((p) => p.src))}
        onPick={(input) => void addScrap(input)}
      />

      {admin && (
        <div
          className="collage-admin"
          data-admin-control
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={captureShape}
            title="Snapshot everyone's cursors as a shape guide"
          >
            capture shape
          </button>
          {templatePoints.length > 0 && (
            <button onClick={clearShape}>clear shape</button>
          )}
          <button onClick={clearTable}>clear table</button>
          <button onClick={exportPng} disabled={exporting}>
            {exporting ? "exporting" : "export png"}
          </button>
        </div>
      )}
    </div>
  );
}
