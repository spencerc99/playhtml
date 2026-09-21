// ABOUTME: Create mode for the scraps page: arrange collected scraps in a fixed frame.
// ABOUTME: Direct pointer handles plus modal transforms, cropping, cutouts, and undo.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  FULL_CROP,
  boxCenter,
  fitWithin,
  frameScale,
  isFullCrop,
  resizeFromCorner,
  rotationToPointer,
  scaleAboutCenter,
  scaleFromPointer,
  snapDegrees,
  sourceBoxForCrop,
  type CropFraction,
  type PieceBox,
  type Point,
  type ResizeCorner,
} from "./collageGeometry";
import {
  COLLAGE_FRAME,
  clearCrop,
  composeCropOnto,
  createCollageId,
  createPieceId,
  movePieceBackward,
  movePieceForward,
  movePieceToBack,
  movePieceToFront,
  normalizeStack,
  type CollagePiece,
  type CollageRecord,
} from "./collageRecord";
import {
  DEFAULT_CUTOUT_TOLERANCE,
  type PieceCutout,
} from "./backgroundCutout";
import {
  canRedo,
  canUndo,
  createHistory,
  endRun,
  recordArrangement,
  redo,
  undo,
  type ArrangementHistory,
} from "./arrangementHistory";
import { studioCommandFor, type StudioMode } from "./studioKeymap";
import { CollageBakeError, bakeCollage } from "./bakeCollage";
import { saveCollage } from "./collageStore";
import { ScrapTray } from "./ScrapTray";
import { PieceMaterial } from "./PieceMaterial";
import { CropSession } from "./CropSession";
import { KeysPopover } from "./KeysPopover";

/** Longest side a freshly placed piece takes, in frame units. */
const PLACED_MAX_SIDE = 220;
const ROTATION_SNAP_DEGREES = 15;
const ROTATE_HANDLE_OFFSET = 26;
/** How far a pasted or duplicated piece lands from its original. */
const COPY_OFFSET = 24;

const RESIZE_CORNERS: { corner: ResizeCorner; left: string; top: string }[] = [
  { corner: "top-left", left: "0%", top: "0%" },
  { corner: "top-right", left: "100%", top: "0%" },
  { corner: "bottom-left", left: "0%", top: "100%" },
  { corner: "bottom-right", left: "100%", top: "100%" },
];

type Gesture =
  | { kind: "idle" }
  | { kind: "move"; pieceId: string; origin: PieceBox; grabbedAt: Point }
  | {
      kind: "resize";
      pieceId: string;
      corner: ResizeCorner;
      origin: PieceBox;
    }
  | { kind: "rotate"; pieceId: string };

/** A rotate or scale driven by pointer movement with no button held. */
type ModalTransform = {
  kind: "rotate" | "scale";
  pieceId: string;
  /** The piece as it was when the transform began, for cancelling back. */
  before: CollagePiece;
  anchor: Point;
  readout: string;
};

type CropState = {
  pieceId: string;
  crop: CropFraction;
  /** The crop the piece had on entry, restored when the session is cancelled. */
  before: CropFraction;
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
  const initial = useMemo<readonly CollagePiece[]>(
    () => editing?.pieces.map((piece) => ({ ...piece })) ?? [],
    [editing],
  );
  const [history, setHistory] = useState<ArrangementHistory>(() =>
    createHistory(initial),
  );
  const pieces = history.present;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Pieces are replaced, never mutated, so identity against the last saved
  // arrangement tells whether there is work that leaving would discard.
  const savedRef = useRef<{ pieces: readonly CollagePiece[]; title: string }>({
    pieces: initial,
    title: editing?.title ?? "",
  });
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const unsaved =
    pieces !== savedRef.current.pieces || title !== savedRef.current.title;

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const [crop, setCrop] = useState<CropState | null>(null);
  const [transform, setTransform] = useState<ModalTransform | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });
  const [clipboard, setClipboard] = useState<CollagePiece | null>(null);
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "problem" | "quiet"; text: string } | null
  >(null);
  const [dropActive, setDropActive] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const draggingScrapRef = useRef<ScrapItem | null>(null);
  const collageIdRef = useRef(editing?.id ?? createCollageId());
  const createdAtRef = useRef(editing?.createdAt ?? Date.now());

  const mode: StudioMode = crop
    ? "crop"
    : transform
      ? transform.kind
      : "idle";

  const selected = useMemo(
    () => pieces.find((piece) => piece.id === selectedId) ?? null,
    [pieces, selectedId],
  );
  const ordered = useMemo(
    () => [...pieces].sort((a, b) => a.z - b.z),
    [pieces],
  );

  /** Commits an arrangement, coalescing a continuous run into one undo step. */
  const commit = useCallback(
    (next: readonly CollagePiece[], runLabel: string | null = null) => {
      setHistory((current) => recordArrangement(current, next, runLabel));
    },
    [],
  );

  const editPiece = useCallback(
    (
      pieceId: string,
      change: (piece: CollagePiece) => CollagePiece,
      runLabel: string | null = null,
    ) => {
      setHistory((current) =>
        recordArrangement(
          current,
          current.present.map((piece) =>
            piece.id === pieceId ? change(piece) : piece,
          ),
          runLabel,
        ),
      );
    },
    [],
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

  const addPiece = useCallback(
    (item: ScrapItem, at: Point) => {
      const piece = placedPiece(item, at, pieces.length);
      commit([...pieces, piece]);
      setSelectedId(piece.id);
      setNotice(null);
    },
    [commit, pieces],
  );

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit(normalizeStack(pieces.filter((piece) => piece.id !== selectedId)));
    setSelectedId(null);
    setCrop(null);
  }, [commit, pieces, selectedId]);

  const duplicatePiece = useCallback(
    (piece: CollagePiece) => {
      const copy: CollagePiece = {
        ...piece,
        id: createPieceId(),
        x: piece.x + COPY_OFFSET,
        y: piece.y + COPY_OFFSET,
        z: pieces.length,
      };
      commit([...pieces, copy]);
      setSelectedId(copy.id);
      return copy;
    },
    [commit, pieces],
  );

  const enterCrop = useCallback(() => {
    if (!selected) return;
    setTransform(null);
    setCrop({
      pieceId: selected.id,
      crop: { ...FULL_CROP },
      before: selected.crop,
    });
  }, [selected]);

  /**
   * Commits the crop session. The piece keeps its place because the crop
   * composes onto the source and the box is re-anchored about the rotation.
   */
  const commitCrop = useCallback(() => {
    if (!crop) return;
    const target = pieces.find((piece) => piece.id === crop.pieceId);
    if (target && !isFullCrop(crop.crop)) {
      editPiece(crop.pieceId, (piece) => composeCropOnto(piece, crop.crop));
    }
    setCrop(null);
  }, [crop, editPiece, pieces]);

  const cancelCrop = useCallback(() => setCrop(null), []);

  const beginTransform = useCallback(
    (kind: "rotate" | "scale") => {
      if (!selected) return;
      setCrop(null);
      const center = boxCenter(selected);
      setTransform({
        kind,
        pieceId: selected.id,
        before: selected,
        // Until the pointer moves, the transform reads from the piece's edge
        // so a scale starts at exactly one.
        anchor: { x: center.x + selected.width / 2, y: center.y },
        readout: kind === "rotate" ? "0 deg" : "100%",
      });
    },
    [selected],
  );

  const confirmTransform = useCallback(() => {
    setTransform(null);
    setHistory((current) => endRun(current));
  }, []);

  const cancelTransform = useCallback(() => {
    if (!transform) return;
    const { before } = transform;
    setHistory((current) =>
      recordArrangement(
        current,
        current.present.map((piece) =>
          piece.id === before.id ? before : piece,
        ),
        `transform:${before.id}`,
      ),
    );
    setTransform(null);
  }, [transform]);

  const cutOutSelected = useCallback(
    (tolerance = DEFAULT_CUTOUT_TOLERANCE) => {
      if (!selected || selected.scrap.kind !== "image") return;
      const cutout: PieceCutout = { method: "edge-color", tolerance };
      editPiece(selected.id, (piece) => ({ ...piece, cutout }));
    },
    [editPiece, selected],
  );

  const stepSelection = useCallback(
    (direction: 1 | -1) => {
      if (ordered.length === 0) return;
      const index = ordered.findIndex((piece) => piece.id === selectedId);
      const next =
        index === -1
          ? direction === 1
            ? 0
            : ordered.length - 1
          : (index + direction + ordered.length) % ordered.length;
      setSelectedId(ordered[next].id);
    },
    [ordered, selectedId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = studioCommandFor(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          target: event.target as HTMLElement | null,
        },
        {
          mode,
          hasSelection: selected !== null,
          hasClipboard: clipboard !== null,
        },
      );
      if (!command) return;
      event.preventDefault();

      switch (command.kind) {
        case "delete":
          removeSelected();
          break;
        case "duplicate":
          if (selected) duplicatePiece(selected);
          break;
        case "copy":
          if (selected) setClipboard(selected);
          break;
        case "paste":
          if (clipboard) duplicatePiece(clipboard);
          break;
        case "undo":
          setHistory((current) => undo(current));
          break;
        case "redo":
          setHistory((current) => redo(current));
          break;
        case "enterCrop":
          enterCrop();
          break;
        case "beginRotate":
          beginTransform("rotate");
          break;
        case "beginScale":
          beginTransform("scale");
          break;
        case "cutout":
          cutOutSelected();
          break;
        case "confirm":
          if (crop) commitCrop();
          else confirmTransform();
          break;
        case "cancel":
          if (crop) cancelCrop();
          else cancelTransform();
          break;
        case "deselect":
          setSelectedId(null);
          break;
        case "selectNext":
          stepSelection(1);
          break;
        case "selectPrevious":
          stepSelection(-1);
          break;
        case "nudge":
          if (selected) {
            editPiece(
              selected.id,
              (piece) => ({
                ...piece,
                x: piece.x + command.dx,
                y: piece.y + command.dy,
              }),
              `nudge:${selected.id}`,
            );
          }
          break;
        case "order":
          if (selected) {
            const move = {
              forward: movePieceForward,
              backward: movePieceBackward,
              front: movePieceToFront,
              back: movePieceToBack,
            }[command.to];
            commit(move(pieces, selected.id));
          }
          break;
        case "showKeys":
          setShowKeys((value) => !value);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    beginTransform,
    cancelCrop,
    cancelTransform,
    clipboard,
    commit,
    commitCrop,
    confirmTransform,
    crop,
    cutOutSelected,
    duplicatePiece,
    editPiece,
    enterCrop,
    mode,
    pieces,
    removeSelected,
    selected,
    stepSelection,
  ]);

  /** Ends a run so the next edit becomes its own undo step. */
  const endGesture = useCallback(() => {
    setGesture({ kind: "idle" });
    setHistory((current) => endRun(current));
  }, []);

  const onFramePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const point = framePoint(event);

      if (transform) {
        const target = pieces.find((piece) => piece.id === transform.pieceId);
        if (!target) return;
        const center = boxCenter(transform.before);
        if (transform.kind === "rotate") {
          const raw = rotationToPointer(transform.before, point);
          const degrees = event.shiftKey
            ? snapDegrees(raw, ROTATION_SNAP_DEGREES)
            : raw;
          editPiece(
            transform.pieceId,
            (piece) => ({ ...piece, rotation: degrees }),
            `transform:${transform.pieceId}`,
          );
          setTransform({ ...transform, readout: `${Math.round(degrees)} deg` });
        } else {
          const factor = scaleFromPointer(center, transform.anchor, point);
          const box = scaleAboutCenter(transform.before, factor);
          editPiece(
            transform.pieceId,
            (piece) => ({ ...piece, ...box }),
            `transform:${transform.pieceId}`,
          );
          setTransform({
            ...transform,
            readout: `${Math.round(factor * 100)}%`,
          });
        }
        return;
      }

      if (gesture.kind === "idle") return;
      if (gesture.kind === "move") {
        const { origin, grabbedAt } = gesture;
        editPiece(
          gesture.pieceId,
          (piece) => ({
            ...piece,
            x: origin.x + (point.x - grabbedAt.x),
            y: origin.y + (point.y - grabbedAt.y),
          }),
          `move:${gesture.pieceId}`,
        );
        return;
      }
      if (gesture.kind === "resize") {
        const rotation =
          pieces.find((piece) => piece.id === gesture.pieceId)?.rotation ?? 0;
        const next = resizeFromCorner({
          box: gesture.origin,
          rotationDegrees: rotation,
          corner: gesture.corner,
          pointer: point,
          // Shift frees the ratio; alt grows the piece about its own center.
          keepAspect: !event.shiftKey,
        });
        const box = event.altKey
          ? scaleAboutCenter(
              gesture.origin,
              next.width / gesture.origin.width,
            )
          : next;
        editPiece(
          gesture.pieceId,
          (piece) => ({ ...piece, ...box }),
          `resize:${gesture.pieceId}`,
        );
        return;
      }
      if (gesture.kind === "rotate") {
        editPiece(
          gesture.pieceId,
          (piece) => {
            const degrees = rotationToPointer(piece, point);
            return {
              ...piece,
              rotation: event.shiftKey
                ? snapDegrees(degrees, ROTATION_SNAP_DEGREES)
                : degrees,
            };
          },
          `rotate:${gesture.pieceId}`,
        );
      }
    },
    [editPiece, framePoint, gesture, pieces, transform],
  );

  const beginMove = (piece: CollagePiece, event: React.PointerEvent) => {
    event.stopPropagation();
    if (transform) {
      confirmTransform();
      return;
    }
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setSelectedId(piece.id);
    setCrop(null);
    // Alt-dragging pulls a copy out and leaves the original where it was.
    const dragged = event.altKey ? duplicatePiece(piece) : piece;
    setGesture({
      kind: "move",
      pieceId: dragged.id,
      origin: {
        x: dragged.x,
        y: dragged.y,
        width: dragged.width,
        height: dragged.height,
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
      const stacked = normalizeStack(pieces);
      const record: CollageRecord = {
        id: collageIdRef.current,
        title: title.trim(),
        createdAt: createdAtRef.current,
        updatedAt: now,
        frame: { ...COLLAGE_FRAME },
        pieces: stacked,
        preview,
      };
      await saveCollage(record);
      savedRef.current = { pieces, title };
      setConfirmingLeave(false);
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

  const onCutoutFailed = useCallback((pieceId: string, reason: string) => {
    setNotice({
      tone: "problem",
      text: `a background could not be removed — ${reason}`,
    });
    // The piece keeps its cutout so the slider can be retried, but nothing
    // pretends the cut happened.
    void pieceId;
  }, []);

  const cropping = crop
    ? pieces.find((piece) => piece.id === crop.pieceId) ?? null
    : null;

  return (
    <div className="collage-studio">
      <ScrapTray
        items={scraps}
        onPlace={(item) => {
          // Clicked scraps fan out from the middle so each one stays grabbable.
          const step = (pieces.length % 8) * 28;
          addPiece(item, {
            x: COLLAGE_FRAME.width / 2 - 98 + step,
            y: COLLAGE_FRAME.height / 2 - 98 + step,
          });
        }}
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
              // Clicking away confirms a running mode rather than losing it.
              if (transform) confirmTransform();
              else if (crop) commitCrop();
              else setSelectedId(null);
            }}
            onPointerMove={onFramePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onContextMenu={(event) => {
              if (!transform) return;
              event.preventDefault();
              cancelTransform();
            }}
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
              const hidden = crop?.pieceId === piece.id;
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
                    visibility: hidden ? "hidden" : "visible",
                  }}
                  onPointerDown={(event) => beginMove(piece, event)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(piece.id);
                    setTransform(null);
                    setCrop({
                      pieceId: piece.id,
                      crop: { ...FULL_CROP },
                      before: piece.crop,
                    });
                  }}
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
                    <PieceMaterial
                      piece={piece}
                      onCutoutFailed={onCutoutFailed}
                    />
                  </div>
                </div>
              );
            })}

            {selected && !crop && !transform && (
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

            {crop && cropping && (
              <CropSession
                piece={cropping}
                crop={crop.crop}
                onChange={(next) => setCrop({ ...crop, crop: next })}
                onCommit={commitCrop}
                framePoint={framePoint}
              />
            )}

            {transform && selected && (
              <p
                className="collage-readout"
                style={{
                  left: selected.x + selected.width / 2,
                  top: selected.y - 34,
                }}
              >
                {transform.kind} {transform.readout}
              </p>
            )}

            {selected &&
              selected.scrap.kind === "image" &&
              selected.cutout &&
              !crop &&
              !transform && (
                <div
                  className="collage-tolerance"
                  style={{
                    left: selected.x + selected.width / 2,
                    top: selected.y + selected.height + 12,
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <span className="collage-studio__label">edge</span>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    value={Math.round(selected.cutout.tolerance * 100)}
                    aria-label="Background cutout tolerance"
                    onChange={(event) =>
                      cutOutSelected(Number(event.target.value) / 100)
                    }
                  />
                </div>
              )}

            <div className="collage-frame__edge" />
          </div>

          {showKeys && <KeysPopover onClose={() => setShowKeys(false)} />}
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
            disabled={!canUndo(history)}
            onClick={() => setHistory((current) => undo(current))}
          >
            undo
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!canRedo(history)}
            onClick={() => setHistory((current) => redo(current))}
          >
            redo
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!selected}
            onClick={() =>
              selected && commit(movePieceBackward(pieces, selected.id))
            }
          >
            send back
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!selected}
            onClick={() =>
              selected && commit(movePieceForward(pieces, selected.id))
            }
          >
            bring forward
          </button>
          <button
            type="button"
            className={`collage-action${crop ? " collage-action--primary" : ""}`}
            disabled={!selected}
            onClick={() => (crop ? commitCrop() : enterCrop())}
          >
            crop
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!selected || isFullCrop(selected.crop)}
            onClick={() => selected && editPiece(selected.id, clearCrop)}
          >
            uncrop
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={!selected || selected.scrap.kind !== "image"}
            onClick={() =>
              selected &&
              (selected.cutout
                ? editPiece(selected.id, ({ cutout: _cut, ...rest }) => rest)
                : cutOutSelected())
            }
          >
            {selected?.cutout ? "restore background" : "cut out"}
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
            className={`collage-action${showKeys ? " collage-action--primary" : ""}`}
            aria-label="Keyboard shortcuts"
            onClick={() => setShowKeys((value) => !value)}
          >
            keys
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
          {confirmingLeave ? (
            <>
              <button
                type="button"
                className="collage-action collage-action--danger"
                onClick={onLeave}
              >
                leave without saving
              </button>
              <button
                type="button"
                className="collage-action"
                onClick={() => setConfirmingLeave(false)}
              >
                stay
              </button>
            </>
          ) : (
            <button
              type="button"
              className="collage-action"
              onClick={() => (unsaved ? setConfirmingLeave(true) : onLeave())}
            >
              done
            </button>
          )}
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
