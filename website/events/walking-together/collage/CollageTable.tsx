// ABOUTME: The shared table where a small group drops, moves, turns, and sizes scraps together.
// ABOUTME: Gestures stay local (plus a live preview) and commit to shared data on release.
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { playhtml, usePlayerIdentity } from "@playhtml/react";
import { isAdmin } from "../admin";
import {
  isOnTop,
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
  const [showWho, setShowWho] = useState(false);

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

  /** One shared write per gesture: the new transform if it changed, and a
   * bump to the front if the piece isn't already there. A plain press with no
   * movement is the bring-to-front gesture. */
  const commitGesture = (g: Gesture, final: PieceTransform) => {
    const current = piecesRef.current;
    const raise = !isOnTop(current, g.id);
    if (!g.moved && !raise) return;
    const nextZ = topZ(current) + 1;
    setData((draft) => {
      const piece = draft.pieces?.[g.id];
      // Someone may have removed it mid-gesture.
      if (!piece) return;
      if (g.moved) {
        piece.x = final.x;
        piece.y = final.y;
        piece.width = final.width;
        piece.rotation = final.rotation;
      }
      if (raise) piece.z = nextZ;
    });
  };

  const removePiece = (piece: Piece) => {
    if (piece.placedByPid !== pid) return;
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
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropActive(false);
      }}
      onDrop={onDrop}
    >
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
                <div
                  className="collage-piece__handle"
                  title="turn and resize"
                  onPointerDown={(e) => startGesture(e, piece, "turn")}
                />
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

      {ordered.length === 0 && (
        <p className="collage-empty">
          scraps from the walk land here
        </p>
      )}

      <div className="collage-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        {notice && <span className="collage-toolbar__note">{notice}</span>}
        {ordered.length > 0 && (
          <button
            className="collage-toolbar__toggle"
            onClick={() => setShowWho((on) => !on)}
            aria-pressed={showWho}
          >
            {showWho ? "hide who added what" : "show who added what"}
          </button>
        )}
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
