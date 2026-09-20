// ABOUTME: Create mode for the scraps page: arrange collected scraps in a fixed frame.
// ABOUTME: Handles placing, moving, resizing, rotating, cropping, stacking, and saving.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ScrapContent,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  FULL_CROP,
  cropFromLocalDrag,
  fitWithin,
  frameScale,
  isFullCrop,
  isUsableCrop,
  resizeFromCorner,
  rotationToPointer,
  snapDegrees,
  sourceBoxForCrop,
  toLocalPoint,
  type PieceBox,
  type Point,
  type ResizeCorner,
} from "./collageGeometry";
import {
  COLLAGE_FRAME,
  applyCrop,
  clearCrop,
  createCollageId,
  createPieceId,
  movePieceBackward,
  movePieceForward,
  normalizeStack,
  type CollagePiece,
  type CollageRecord,
} from "./collageRecord";
import { CollageBakeError, bakeCollage } from "./bakeCollage";
import { saveCollage } from "./collageStore";
import { ScrapTray } from "./ScrapTray";

/** Longest side a freshly placed piece takes, in frame units. */
const PLACED_MAX_SIDE = 220;
const ROTATION_SNAP_DEGREES = 15;
const ROTATE_HANDLE_OFFSET = 26;

const RESIZE_CORNERS: { corner: ResizeCorner; left: string; top: string }[] = [
  { corner: "top-left", left: "0%", top: "0%" },
  { corner: "top-right", left: "100%", top: "0%" },
  { corner: "bottom-left", left: "0%", top: "100%" },
  { corner: "bottom-right", left: "100%", top: "100%" },
];

type Gesture =
  | { kind: "idle" }
  | {
      kind: "move";
      pieceId: string;
      origin: PieceBox;
      grabbedAt: Point;
    }
  | {
      kind: "resize";
      pieceId: string;
      corner: ResizeCorner;
      origin: PieceBox;
    }
  | { kind: "rotate"; pieceId: string }
  | {
      kind: "crop";
      pieceId: string;
      start: Point;
      current: Point;
    };

interface CollageStudioProps {
  scraps: readonly ScrapItem[];
  /** The collage being edited, or null when starting a fresh one. */
  editing: CollageRecord | null;
  onSaved: (record: CollageRecord) => void;
  onLeave: () => void;
}

/** Natural aspect of a scrap, so a placed piece keeps its own proportions. */
function naturalSize(item: ScrapItem): { width: number; height: number } {
  switch (item.kind) {
    case "image":
      return { width: item.naturalWidth, height: item.naturalHeight };
    case "svg-icon":
      return { width: item.width, height: item.height };
    case "button":
      return { width: Math.max(80, item.text.length * 11 + 40), height: 40 };
    case "cursor":
      return { width: 32, height: 32 };
  }
}

function placedPiece(item: ScrapItem, at: Point, z: number): CollagePiece {
  const natural = naturalSize(item);
  const size = fitWithin(natural.width, natural.height, PLACED_MAX_SIDE);
  return {
    id: createPieceId(),
    scrapId: item.id,
    scrap: item,
    x: at.x - size.width / 2,
    y: at.y - size.height / 2,
    width: size.width,
    height: size.height,
    rotation: 0,
    z,
    crop: { ...FULL_CROP },
  };
}

export function CollageStudio({
  scraps,
  editing,
  onSaved,
  onLeave,
}: CollageStudioProps) {
  const [pieces, setPieces] = useState<CollagePiece[]>(
    () => editing?.pieces.map((piece) => ({ ...piece })) ?? [],
  );
  const [title, setTitle] = useState(editing?.title ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "problem" | "quiet"; text: string } | null
  >(null);
  const [dropActive, setDropActive] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingScrapRef = useRef<ScrapItem | null>(null);
  const collageIdRef = useRef(editing?.id ?? createCollageId());
  const createdAtRef = useRef(editing?.createdAt ?? Date.now());

  const selected = useMemo(
    () => pieces.find((piece) => piece.id === selectedId) ?? null,
    [pieces, selectedId],
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      setScale(
        frameScale(COLLAGE_FRAME, {
          width: stage.clientWidth - 24,
          height: stage.clientHeight - 24,
        }),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  /** Converts a pointer event into frame coordinates. */
  const framePoint = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const frame = frameRef.current;
      if (!frame) throw new Error("The collage frame is not mounted");
      const rect = frame.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
      };
    },
    [scale],
  );

  const updatePiece = useCallback(
    (pieceId: string, change: (piece: CollagePiece) => CollagePiece) => {
      setPieces((current) =>
        current.map((piece) => (piece.id === pieceId ? change(piece) : piece)),
      );
    },
    [],
  );

  const addPiece = useCallback((item: ScrapItem, at: Point) => {
    setPieces((current) => {
      const nextZ = current.length;
      const piece = placedPiece(item, at, nextZ);
      setSelectedId(piece.id);
      return [...current, piece];
    });
    setNotice(null);
  }, []);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setPieces((current) =>
      normalizeStack(current.filter((piece) => piece.id !== selectedId)),
    );
    setSelectedId(null);
    setCropping(false);
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (cropping) setCropping(false);
        else setSelectedId(null);
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedId
      ) {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cropping, removeSelected, selectedId]);

  const endGesture = useCallback(() => {
    if (gesture.kind === "crop") {
      const piece = pieces.find((item) => item.id === gesture.pieceId);
      if (piece) {
        const box: PieceBox = {
          x: piece.x,
          y: piece.y,
          width: piece.width,
          height: piece.height,
        };
        const inner = cropFromLocalDrag(
          toLocalPoint(gesture.start, box, piece.rotation),
          toLocalPoint(gesture.current, box, piece.rotation),
          box,
        );
        if (isUsableCrop(inner)) {
          updatePiece(piece.id, (target) => applyCrop(target, inner));
          setCropping(false);
        }
      }
    }
    setGesture({ kind: "idle" });
  }, [gesture, pieces, updatePiece]);

  const onFramePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (gesture.kind === "idle") return;
      const point = framePoint(event);
      if (gesture.kind === "move") {
        const { origin, grabbedAt } = gesture;
        updatePiece(gesture.pieceId, (piece) => ({
          ...piece,
          x: origin.x + (point.x - grabbedAt.x),
          y: origin.y + (point.y - grabbedAt.y),
        }));
        return;
      }
      if (gesture.kind === "resize") {
        const next = resizeFromCorner({
          box: gesture.origin,
          rotationDegrees:
            pieces.find((piece) => piece.id === gesture.pieceId)?.rotation ?? 0,
          corner: gesture.corner,
          pointer: point,
          keepAspect: !event.altKey,
        });
        updatePiece(gesture.pieceId, (piece) => ({ ...piece, ...next }));
        return;
      }
      if (gesture.kind === "rotate") {
        updatePiece(gesture.pieceId, (piece) => {
          const degrees = rotationToPointer(piece, point);
          return {
            ...piece,
            rotation: event.shiftKey
              ? snapDegrees(degrees, ROTATION_SNAP_DEGREES)
              : degrees,
          };
        });
        return;
      }
      setGesture({ ...gesture, current: point });
    },
    [framePoint, gesture, pieces, updatePiece],
  );

  const beginMove = (piece: CollagePiece, event: React.PointerEvent) => {
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setSelectedId(piece.id);
    if (cropping && piece.id === selectedId) return;
    setCropping(false);
    setGesture({
      kind: "move",
      pieceId: piece.id,
      origin: {
        x: piece.x,
        y: piece.y,
        width: piece.width,
        height: piece.height,
      },
      grabbedAt: framePoint(event),
    });
  };

  const save = async () => {
    if (pieces.length === 0) {
      setNotice({ tone: "problem", text: "place a scrap before saving" });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const preview = await bakeCollage({ frame: COLLAGE_FRAME, pieces });
      const now = Date.now();
      const record: CollageRecord = {
        id: collageIdRef.current,
        title: title.trim(),
        createdAt: createdAtRef.current,
        updatedAt: now,
        frame: { ...COLLAGE_FRAME },
        pieces: normalizeStack(pieces),
        preview,
      };
      await saveCollage(record);
      setNotice({ tone: "quiet", text: "saved" });
      onSaved(record);
    } catch (error) {
      if (error instanceof CollageBakeError) {
        const names = error.failures.map((failure) => failure.label);
        setNotice({
          tone: "problem",
          text: `not saved — these could not be drawn: ${names.join(", ")}. remove them or try again when you are online.`,
        });
      } else {
        setNotice({
          tone: "problem",
          text: `not saved — ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    if (pieces.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const png = await bakeCollage({ frame: COLLAGE_FRAME, pieces });
      const url = URL.createObjectURL(png);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.trim() || "collage"}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice({
        tone: "problem",
        text: `could not export — ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setSaving(false);
    }
  };

  const ordered = useMemo(
    () => [...pieces].sort((a, b) => a.z - b.z),
    [pieces],
  );

  return (
    <div className="collage-studio">
      <ScrapTray
        items={scraps}
        onPlace={(item) =>
          addPiece(item, {
            x: COLLAGE_FRAME.width / 2,
            y: COLLAGE_FRAME.height / 2,
          })
        }
        onDragStart={(item, event) => {
          draggingScrapRef.current = item;
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", item.id);
        }}
      />

      <div className="collage-frame-area">
        <div className="collage-frame-area__stage" ref={stageRef}>
          <div
            ref={frameRef}
            className={`collage-frame${dropActive ? " collage-frame--drop-target" : ""}`}
            style={{
              width: COLLAGE_FRAME.width,
              height: COLLAGE_FRAME.height,
              transform: `scale(${scale})`,
            }}
            onPointerDown={() => {
              if (!cropping) setSelectedId(null);
            }}
            onPointerMove={onFramePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDropActive(false);
              const item = draggingScrapRef.current;
              draggingScrapRef.current = null;
              if (item) addPiece(item, framePoint(event));
            }}
          >
            {ordered.map((piece) => {
              const source = sourceBoxForCrop(piece, piece.crop);
              const isSelected = piece.id === selectedId;
              return (
                <div
                  key={piece.id}
                  className={`collage-piece${isSelected ? " collage-piece--selected" : ""}`}
                  style={{
                    left: piece.x,
                    top: piece.y,
                    width: piece.width,
                    height: piece.height,
                    zIndex: piece.z + 1,
                    transform: `rotate(${piece.rotation}deg)`,
                    cursor: cropping && isSelected ? "crosshair" : "grab",
                  }}
                  onPointerDown={(event) => beginMove(piece, event)}
                >
                  <div
                    className="collage-piece__source"
                    style={{
                      left: source.x - piece.x,
                      top: source.y - piece.y,
                      width: source.width,
                      height: source.height,
                      pointerEvents: "none",
                    }}
                  >
                    <ScrapContent
                      item={piece.scrap}
                      loaded={true}
                      onLoad={() => {}}
                      onError={() => {}}
                    />
                  </div>
                </div>
              );
            })}

            {selected && !cropping && (
              <PieceHandles
                piece={selected}
                onResizeStart={(corner, event) => {
                  event.stopPropagation();
                  (event.target as Element).setPointerCapture?.(
                    event.pointerId,
                  );
                  setGesture({
                    kind: "resize",
                    pieceId: selected.id,
                    corner,
                    origin: {
                      x: selected.x,
                      y: selected.y,
                      width: selected.width,
                      height: selected.height,
                    },
                  });
                }}
                onRotateStart={(event) => {
                  event.stopPropagation();
                  (event.target as Element).setPointerCapture?.(
                    event.pointerId,
                  );
                  setGesture({ kind: "rotate", pieceId: selected.id });
                }}
              />
            )}

            {selected && cropping && (
              <CropOverlay
                piece={selected}
                gesture={gesture}
                onStart={(point) =>
                  setGesture({
                    kind: "crop",
                    pieceId: selected.id,
                    start: point,
                    current: point,
                  })
                }
                framePoint={framePoint}
              />
            )}

            <div className="collage-frame__edge" />
          </div>
        </div>

        <div className="collage-bar">
          <input
            className="collage-title-input"
            value={title}
            placeholder="untitled collage"
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Collage title"
          />
          <span className="collage-studio__label">
            {pieces.length} piece{pieces.length === 1 ? "" : "s"}
          </span>
          <span className="collage-bar__spacer" />
          <button
            type="button"
            className="collage-action"
            disabled={!selected}
            onClick={() =>
              selected && setPieces((c) => movePieceBackward(c, selected.id))
            }
          >
            send back
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!selected}
            onClick={() =>
              selected && setPieces((c) => movePieceForward(c, selected.id))
            }
          >
            bring forward
          </button>
          <button
            type="button"
            className={`collage-action${cropping ? " collage-action--primary" : ""}`}
            disabled={!selected}
            onClick={() => setCropping((value) => !value)}
          >
            {cropping ? "cropping" : "crop"}
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!selected || isFullCrop(selected.crop)}
            onClick={() => selected && updatePiece(selected.id, clearCrop)}
          >
            uncrop
          </button>
          <button
            type="button"
            className="collage-action collage-action--danger"
            disabled={!selected}
            onClick={removeSelected}
          >
            remove
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={saving || pieces.length === 0}
            onClick={() => void download()}
          >
            export png
          </button>
          <button
            type="button"
            className="collage-action collage-action--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "saving..." : editing ? "update" : "save"}
          </button>
          <button type="button" className="collage-action" onClick={onLeave}>
            done
          </button>
        </div>

        {notice && (
          <p
            className={`collage-notice${notice.tone === "quiet" ? " collage-notice--quiet" : ""}`}
            role="status"
          >
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}

function PieceHandles({
  piece,
  onResizeStart,
  onRotateStart,
}: {
  piece: CollagePiece;
  onResizeStart: (corner: ResizeCorner, event: React.PointerEvent) => void;
  onRotateStart: (event: React.PointerEvent) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: piece.x,
        top: piece.y,
        width: piece.width,
        height: piece.height,
        transform: `rotate(${piece.rotation}deg)`,
        transformOrigin: "center",
        zIndex: 10_000,
        pointerEvents: "none",
      }}
    >
      {RESIZE_CORNERS.map(({ corner, left, top }) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize from ${corner.replace("-", " ")}`}
          className="collage-handle"
          style={{ left, top, pointerEvents: "auto" }}
          onPointerDown={(event) => onResizeStart(corner, event)}
        />
      ))}
      <div
        className="collage-handle__tether"
        style={{
          left: "50%",
          top: -ROTATE_HANDLE_OFFSET,
          height: ROTATE_HANDLE_OFFSET,
        }}
      />
      <button
        type="button"
        aria-label="Rotate piece"
        className="collage-handle collage-handle--rotate"
        style={{
          left: "50%",
          top: -ROTATE_HANDLE_OFFSET,
          pointerEvents: "auto",
        }}
        onPointerDown={onRotateStart}
      />
    </div>
  );
}

function CropOverlay({
  piece,
  gesture,
  onStart,
  framePoint,
}: {
  piece: CollagePiece;
  gesture: Gesture;
  onStart: (point: Point) => void;
  framePoint: (event: { clientX: number; clientY: number }) => Point;
}) {
  const box: PieceBox = {
    x: piece.x,
    y: piece.y,
    width: piece.width,
    height: piece.height,
  };
  const active = gesture.kind === "crop" && gesture.pieceId === piece.id
    ? gesture
    : null;
  const selection = active
    ? (() => {
        const start = toLocalPoint(active.start, box, piece.rotation);
        const end = toLocalPoint(active.current, box, piece.rotation);
        const fraction = cropFromLocalDrag(start, end, box);
        return {
          left: fraction.x * box.width,
          top: fraction.y * box.height,
          width: fraction.width * box.width,
          height: fraction.height * box.height,
        };
      })()
    : null;

  return (
    <div
      className="collage-crop-overlay"
      style={{
        left: piece.x,
        top: piece.y,
        width: piece.width,
        height: piece.height,
        transform: `rotate(${piece.rotation}deg)`,
        transformOrigin: "center",
        zIndex: 10_001,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        (event.target as Element).setPointerCapture?.(event.pointerId);
        onStart(framePoint(event));
      }}
    >
      {selection && selection.width > 0 && (
        <div className="collage-crop-selection" style={selection} />
      )}
    </div>
  );
}
