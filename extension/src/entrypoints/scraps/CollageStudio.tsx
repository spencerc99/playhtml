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
import {
  headingDisplayFontSize,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  FULL_CROP,
  boxCenter,
  fanOutPlacement,
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
  clearCrop,
  collageProvenance,
  composeCropOnto,
  createCollageId,
  createPieceId,
  movePieceBackward,
  movePieceForward,
  movePieceToBack,
  movePieceToFront,
  normalizeStack,
  flipPiece,
  pieceMaterialTransform,
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
import {
  leavesKeysAlone,
  studioCommandFor,
  type StudioMode,
} from "./studioKeymap";
import {
  DEFAULT_FORMAT,
  DEFAULT_PAPER,
  formatOf,
  type CollageFormatName,
  type CollagePaper,
} from "./collageFormats";
import {
  defaultDrawerWidth,
  readDrawerPreference,
  writeDrawerPreference,
  type DrawerPreference,
} from "./drawerPreference";
import { PieceActions } from "./PieceActions";
import { StudioTools } from "./StudioTools";
import { FormatControl } from "./FormatControl";
import { CollageBakeError, bakeCollage } from "./bakeCollage";
import { bakeCollageBack, resolveBackFavicons } from "./bakeCollageBack";
import type { CollageBackContent } from "./collageBack";
import { CollageBackFace } from "./CollageBackFace";
import { saveCollage } from "./collageStore";
import { ScrapTray } from "./ScrapTray";
import { PieceMaterial } from "./PieceMaterial";
import { CropSession } from "./CropSession";
import { KeysPopover } from "./KeysPopover";
import { ProvenancePeek } from "./ProvenancePeek";
import { paperBackground } from "./paperGrain";
import { PiecesHereMenu } from "./PiecesHereMenu";
import {
  neighborInStack,
  nextSelectionAt,
  piecesUnder,
  topPieceUnder,
} from "./pieceStack";
import { createPeekState, stepPeek, type PeekEvent } from "./peekHold";
import {
  useCollageAutosave,
  type AutosaveTimers,
  type CollageDraft,
} from "./useCollageAutosave";
import type { SaveStanding } from "./autosaveSchedule";

/** Longest side a freshly placed piece takes, in frame units. */
const PLACED_MAX_SIDE = 220;
/** Average character width as a fraction of font size, for sizing a heading. */
const HEADING_CHARACTER_ADVANCE = 0.68;
const ROTATION_SNAP_DEGREES = 15;
const ROTATE_HANDLE_OFFSET = 26;
/** How far a pasted or duplicated piece lands from its original. */
const COPY_OFFSET = 24;
/** Frame units the pointer must travel before an alt-drag pulls out a copy. */
const ALT_DRAG_THRESHOLD = 4;

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
      copyOnDrag?: boolean;
    }
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
  /** Timers the autosave runs on, so a test can drive the schedule directly. */
  autosaveTimers?: AutosaveTimers;
}

/** What the toolbar says about where the work stands. */
function standingWords(standing: SaveStanding): {
  text: string;
  problem: boolean;
} {
  switch (standing.kind) {
    case "untouched":
      return { text: "", problem: false };
    case "saving":
      return { text: "saving...", problem: false };
    case "saved":
      return { text: "saved", problem: false };
    case "previewBehind":
      return { text: "saved · preview out of date", problem: false };
    case "failed":
      return { text: `not saved — ${standing.reason}`, problem: true };
  }
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
    case "heading": {
      // Sized from the same font size the shared renderer draws the heading
      // at, so a placed heading arrives at the proportions it will keep.
      const fontSize = headingDisplayFontSize(item.styles, item.text);
      const width = Math.max(
        90,
        item.text.trim().length * fontSize * HEADING_CHARACTER_ADVANCE + 16,
      );
      return { width, height: Math.max(28, fontSize * 1.15 + 12) };
    }
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
    flipX: false,
    flipY: false,
  };
}

export function CollageStudio({
  scraps,
  editing,
  onSaved,
  onLeave,
  autosaveTimers,
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
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const [format, setFormat] = useState<CollageFormatName>(
    editing?.format ?? DEFAULT_FORMAT,
  );
  const [paper, setPaper] = useState<CollagePaper>(
    editing?.paper ?? DEFAULT_PAPER,
  );
  const frame = formatOf(format);
  const [drawer, setDrawer] = useState(() => readDrawerPreference());
  /** Whether the collage is turned over to its back, where the sources are. */
  const [over, setOver] = useState(false);
  /** The front as the back shows it through the paper. */
  const [bleed, setBleed] = useState<Blob | null>(null);
  /** When the stored collage last changed, for the back's dates. */
  const [changedAt, setChangedAt] = useState<number | null>(
    editing?.updatedAt ?? null,
  );

  const updateDrawer = useCallback(
    (change: Partial<DrawerPreference>) => {
      setDrawer((current) => {
        const next = { ...current, ...change };
        writeDrawerPreference(next);
        return next;
      });
    },
    [],
  );

  const [crop, setCrop] = useState<CropState | null>(null);
  const [transform, setTransform] = useState<ModalTransform | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });
  /** What the slip above the selected piece says while a gesture runs. */
  const [gestureReadout, setGestureReadout] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<CollagePiece | null>(null);
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "problem" | "quiet"; text: string } | null
  >(null);
  const [dropActive, setDropActive] = useState(false);
  const [peek, setPeek] = useState(createPeekState);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** The pile the "pieces here" menu is listing, and where it opened. */
  const [hereMenu, setHereMenu] = useState<{
    at: Point;
    pieceIds: string[];
  } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /**
   * The press in progress, so release can tell a click from a drag. A click
   * that did not travel selects the next piece down; a drag does not.
   */
  const pressRef = useRef<{
    at: Point;
    selectedWas: string | null;
    moved: boolean;
  } | null>(null);
  const draggingScrapRef = useRef<ScrapItem | null>(null);
  const collageIdRef = useRef(editing?.id ?? createCollageId());
  const createdAtRef = useRef(editing?.createdAt ?? Date.now());

  // The collage as it stands, read at the moment of a write rather than
  // captured into the schedule, so a late write stores what is on screen.
  const draftRef = useRef<CollageDraft>({
    record: {
      id: collageIdRef.current,
      title: "",
      createdAt: createdAtRef.current,
      updatedAt: createdAtRef.current,
      frame: { width: frame.width, height: frame.height },
      format,
      paper,
      pieces: [],
    },
    hasContent: false,
  });
  draftRef.current = {
    record: {
      id: collageIdRef.current,
      title: title.trim(),
      createdAt: createdAtRef.current,
      // A write stamps the moment it lands; a re-bake keeps the stamp the
      // arrangement already had.
      updatedAt: Date.now(),
      frame: { width: frame.width, height: frame.height },
      format,
      paper,
      pieces: normalizeStack(pieces),
    },
    hasContent: pieces.length > 0 || title.trim().length > 0,
  };

  const autosave = useCollageAutosave({
    draft: () => ({
      ...draftRef.current,
      record: { ...draftRef.current.record, updatedAt: Date.now() },
    }),
    bake: () =>
      bakeCollage({
        frame: formatOf(draftRef.current.record.format),
        pieces: draftRef.current.record.pieces,
        paper: draftRef.current.record.paper.color,
        grain: draftRef.current.record.paper.grain,
      }),
    store: saveCollage,
    onStored: (record) => {
      setChangedAt(record.updatedAt);
      onSaved(record);
    },
    startsStored: editing !== null,
    reopening: editing,
    ...(autosaveTimers ? { timers: autosaveTimers } : {}),
  });
  const { noteChange, flush } = autosave;

  // Everything the person can change about the collage feeds one schedule, so
  // a move, a retitle, a paper or a format all settle the same way.
  const changeKey = useMemo(
    () => ({
      pieces,
      title: title.trim(),
      paper: paper.color,
      grain: paper.grain,
      format,
    }),
    [pieces, title, paper.color, paper.grain, format],
  );
  const firstChangeRef = useRef(true);
  useEffect(() => {
    // The opening render is the collage as it already stands, not a change.
    if (firstChangeRef.current) {
      firstChangeRef.current = false;
      return;
    }
    noteChange();
  }, [changeKey, noteChange]);

  const mode: StudioMode = over
    ? "back"
    : crop
    ? "crop"
    : transform
      ? transform.kind
      : "idle";

  // Leaving the tab, or the page itself, writes what is pending right away.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onPageHide = () => flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush]);

  // With the autosave healthy there is nothing to warn about; the warning is
  // kept for a write that failed or one still in flight.
  useEffect(() => {
    if (!autosave.unwritten) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosave.unwritten]);

  const selected = useMemo(
    () => pieces.find((piece) => piece.id === selectedId) ?? null,
    [pieces, selectedId],
  );
  const ordered = useMemo(
    () => [...pieces].sort((a, b) => a.z - b.z),
    [pieces],
  );
  const hovered = useMemo(
    () => pieces.find((piece) => piece.id === hoveredId) ?? null,
    [pieces, hoveredId],
  );
  /** The pile the menu is listing, resolved fresh so edits keep it honest. */
  const hereStack = useMemo(() => {
    if (!hereMenu) return [];
    return hereMenu.pieceIds
      .map((id) => pieces.find((piece) => piece.id === id))
      .filter((piece): piece is CollagePiece => piece !== undefined);
  }, [hereMenu, pieces]);

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
        frameScale(frame, {
          width: stage.clientWidth - 24,
          height: stage.clientHeight - 24,
        }),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
    // The fit is recomputed when the format changes, so a new size is shown
    // at its own zoom rather than the one the previous format was fitted at.
  }, [frame]);

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

  /**
   * Turns the collage over or face up again. Whatever was in hand is put
   * down first, so the back is only ever read and nothing is edited behind it.
   */
  const turnOver = useCallback(() => {
    if (transform) confirmTransform();
    if (crop) commitCrop();
    setSelectedId(null);
    setHoveredId(null);
    setHereMenu(null);
    setGesture({ kind: "idle" });
    setOver((value) => !value);
  }, [commitCrop, confirmTransform, crop, transform]);

  const backContent = useMemo<CollageBackContent>(
    () => ({
      title,
      createdAt: createdAtRef.current,
      changedAt,
      pieceCount: pieces.length,
      formatLabel: `${frame.label} \u00b7 ${frame.width} \u00d7 ${frame.height}`,
      sources: collageProvenance(normalizeStack(pieces)),
    }),
    [changedAt, frame, pieces, title],
  );

  // The back shows the front through the paper. The last picture that drew is
  // used straight away; when the arrangement has moved on since, a fresh one
  // replaces it, either from the autosave already drawing or from a bake here.
  const standingKind = autosave.standing.kind;
  const lastPreview = autosave.preview;
  useEffect(() => {
    if (!over) return;
    if (pieces.length === 0) {
      setBleed(null);
      return;
    }
    if (lastPreview) setBleed(lastPreview);
    if (lastPreview && standingKind === "saved") return;
    if (standingKind === "saving") return;
    let cancelled = false;
    bakeCollage({
      frame,
      pieces,
      paper: paper.color,
      grain: paper.grain,
    })
      .then((baked) => {
        if (!cancelled) setBleed(baked);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice({
          tone: "problem",
          text: `the front could not be drawn through the back — ${
            error instanceof CollageBakeError
              ? error.failures.map((failure) => failure.label).join(", ")
              : error instanceof Error
                ? error.message
                : String(error)
          }`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [frame, lastPreview, over, paper.color, paper.grain, pieces, standingKind]);

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

  // The peek is a held key, so it lives outside the command map: it has no
  // command to run, only a state that lasts as long as the key is down.
  useEffect(() => {
    const advance = (event: PeekEvent) =>
      setPeek((current) => stepPeek(current, event));
    const onKeyDown = (event: KeyboardEvent) =>
      advance({
        kind: "keyDown",
        key: event.key,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        typing: leavesKeysAlone({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          target: event.target as HTMLElement | null,
        }),
        modeActive: mode !== "idle",
      });
    const onKeyUp = (event: KeyboardEvent) =>
      advance({ kind: "keyUp", key: event.key });
    const onBlur = () => advance({ kind: "windowBlur" });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        advance({ kind: "pageHidden" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode]);

  // A crop or a modal transform starting while the key is down puts the tags
  // away, so they never hang over a session that owns the frame.
  useEffect(() => {
    if (mode !== "idle") setPeek(createPeekState);
  }, [mode]);

  useEffect(() => {
    const onSaveNow = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      // Only the studio suppresses the browser's own save dialog.
      event.preventDefault();
      flush();
    };
    window.addEventListener("keydown", onSaveNow);
    return () => window.removeEventListener("keydown", onSaveNow);
  }, [flush]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = studioCommandFor(
        {
          key: event.key,
          code: event.code,
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
        case "flip":
          if (selected) {
            editPiece(selected.id, (piece) => flipPiece(piece, command.axis));
          }
          break;
        case "toggleDrawer":
          updateDrawer({ collapsed: !drawer.collapsed });
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
        case "selectInStack": {
          // Stepping into a pile only changes what is in hand, never the
          // order the pieces are stacked in.
          const next = neighborInStack(pieces, selectedId, command.direction);
          if (next) setSelectedId(next);
          break;
        }
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
        case "turnOver":
          turnOver();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    beginTransform,
    cancelCrop,
    drawer.collapsed,
    updateDrawer,
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
    turnOver,
  ]);

  /**
   * Ends a run so the next edit becomes its own undo step. A press that never
   * travelled was a click, and a click on a spot that already holds the
   * selected piece reaches the next piece down in the pile.
   */
  const endGesture = useCallback(
    (event?: React.PointerEvent) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (event && press && !press.moved) {
        const deeper = nextSelectionAt(pieces, press.at, press.selectedWas);
        if (deeper) setSelectedId(deeper);
      }
      setGesture({ kind: "idle" });
      setGestureReadout(null);
      setHistory((current) => endRun(current));
    },
    [pieces],
  );

  const onFramePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const point = framePoint(event);

      // What a click would take, shown faintly so a buried piece can be seen
      // before it is reached for. A rotated-rect test per piece, no pixels.
      if (gesture.kind === "idle" && !transform && !crop) {
        const under = topPieceUnder(pieces, point);
        setHoveredId(under?.id ?? null);
      }

      const press = pressRef.current;
      if (press && !press.moved) {
        // Past the threshold this press is a drag, not a click, so release
        // must not treat it as a request to select deeper.
        if (
          Math.hypot(point.x - press.at.x, point.y - press.at.y) >
          ALT_DRAG_THRESHOLD
        ) {
          press.moved = true;
        }
      }

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
        // A copy is pulled out only after the pointer has clearly moved.
        if (
          gesture.copyOnDrag &&
          Math.hypot(point.x - grabbedAt.x, point.y - grabbedAt.y) >
            ALT_DRAG_THRESHOLD
        ) {
          const source = pieces.find((item) => item.id === gesture.pieceId);
          if (source) {
            const copy = duplicatePiece(source);
            setGesture({
              kind: "move",
              pieceId: copy.id,
              origin: { ...origin, x: copy.x, y: copy.y },
              grabbedAt,
            });
          }
          return;
        }
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
        setGestureReadout(
          `scale ${Math.round((box.width / gesture.origin.width) * 100)}%`,
        );
        return;
      }
      if (gesture.kind === "rotate") {
        const turning = pieces.find((piece) => piece.id === gesture.pieceId);
        if (!turning) return;
        const raw = rotationToPointer(turning, point);
        const degrees = event.shiftKey
          ? snapDegrees(raw, ROTATION_SNAP_DEGREES)
          : raw;
        editPiece(
          gesture.pieceId,
          (piece) => ({ ...piece, rotation: degrees }),
          `rotate:${gesture.pieceId}`,
        );
        setGestureReadout(`rotate ${Math.round(degrees)} deg`);
      }
    },
    [crop, duplicatePiece, editPiece, framePoint, gesture, pieces, transform],
  );

  /**
   * Presses go to whatever is already selected when the press lands on it, so
   * a drag always moves the piece in hand. Which piece a click *selects* is
   * settled on release instead, because only then is it known that the press
   * was a click and not the start of a drag.
   */
  const beginMove = (piece: CollagePiece, event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (transform) {
      confirmTransform();
      return;
    }
    setHereMenu(null);
    const at = framePoint(event);
    const stack = piecesUnder(pieces, at);
    // The press drags whichever piece is in hand if the press is on it; a
    // press elsewhere takes the frontmost piece there straight away.
    const holding =
      selectedId && stack.some((item) => item.id === selectedId)
        ? pieces.find((item) => item.id === selectedId)
        : undefined;
    const dragging = holding ?? stack[0] ?? piece;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setSelectedId(dragging.id);
    setCrop(null);
    pressRef.current = { at, selectedWas: selectedId, moved: false };
    setGesture({
      kind: "move",
      pieceId: dragging.id,
      origin: {
        x: dragging.x,
        y: dragging.y,
        width: dragging.width,
        height: dragging.height,
      },
      grabbedAt: at,
      // Alt-dragging pulls out a copy, but only once the pointer travels, so
      // a plain alt-click just selects.
      copyOnDrag: event.altKey,
    });
  };

  /**
   * Leaving writes what is pending first. A write that is simply in flight is
   * not a reason to stop him: it will land. Only a write that has actually
   * failed asks, because that work really would be lost.
   */
  const leave = () => {
    flush();
    if (autosave.standing.kind === "failed") {
      setConfirmingLeave(true);
      return;
    }
    onLeave();
  };

  /** Hands the browser a file to save under the given name. */
  const saveFile = (png: Blob, name: string) => {
    const url = URL.createObjectURL(png);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Exports the front and the back as two pictures of the same size. The back
   * shows this very front through its paper, so the pair always agree.
   */
  const download = async () => {
    if (pieces.length === 0) return;
    setExporting(true);
    setNotice(null);
    const name = title.trim() || "collage";
    try {
      const front = await bakeCollage({
        frame,
        pieces,
        paper: paper.color,
        grain: paper.grain,
      });
      const back = await bakeCollageBack({
        frame,
        paper,
        content: backContent,
        front,
        favicons: await resolveBackFavicons(backContent.sources),
      });
      saveFile(front, `${name} front.png`);
      saveFile(back, `${name} back.png`);
    } catch (error) {
      // An export is asked for out loud, so it fails out loud, naming the
      // pieces that would have left holes in the picture.
      const text =
        error instanceof CollageBakeError
          ? `could not export — these could not be drawn: ${error.failures
              .map((failure) => failure.label)
              .join(", ")}`
          : `could not export — ${error instanceof Error ? error.message : String(error)}`;
      setNotice({ tone: "problem", text });
    } finally {
      setExporting(false);
    }
  };

  const onBackProblem = useCallback((text: string) => {
    setNotice({ tone: "problem", text });
  }, []);

  const onCutoutFailed = useCallback((pieceId: string, reason: string) => {
    setNotice({
      tone: "problem",
      text: `a background could not be removed — ${reason}`,
    });
    // The piece keeps its cutout so the slider can be retried, but nothing
    // pretends the cut happened.
    void pieceId;
  }, []);

  // Modal transforms and handle drags speak through the same slip.
  const readout = transform
    ? `${transform.kind} ${transform.readout}`
    : gestureReadout;
  const standing = standingWords(autosave.standing);

  const cropping = crop
    ? pieces.find((piece) => piece.id === crop.pieceId) ?? null
    : null;

  return (
    <div className="collage-studio">
      <ScrapTray
        items={scraps}
        width={drawer.width}
        collapsed={drawer.collapsed}
        slotSize={drawer.slotSize}
        onWidth={(width) => updateDrawer({ width })}
        onCollapsed={(collapsed) => updateDrawer({ collapsed })}
        onSlotSize={(slotSize) =>
          // The drawer follows the new slot size so three still fit across.
          updateDrawer({ slotSize, width: defaultDrawerWidth(slotSize) })
        }
        onPlace={(item) => {
          // Placing a scrap is an edit, so the collage turns face up for it.
          if (over) turnOver();
          // Clicked scraps fan out from the middle so each one stays grabbable.
          addPiece(item, fanOutPlacement(pieces.length, frame));
        }}
        onDragStart={(item, event) => {
          draggingScrapRef.current = item;
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", item.id);
        }}
      />

      <div className="collage-frame-area">
        <div className="collage-frame-area__stage" ref={stageRef}>
          {/* The sheet holds both sides of the collage in one place and turns
              over about its vertical axis; only the side facing up is live. */}
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
                ref={frameRef}
                className={`collage-frame${dropActive ? " collage-frame--drop-target" : ""}`}
                inert={over}
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
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  setHereMenu(null);
                  // Clicking away confirms a running mode rather than losing it.
                  if (transform) confirmTransform();
                  else if (crop) commitCrop();
                  else setSelectedId(null);
                }}
                onPointerMove={onFramePointerMove}
                onPointerUp={endGesture}
                onPointerCancel={() => endGesture()}
                onPointerLeave={() => setHoveredId(null)}
                onContextMenu={(event) => {
                  // The browser's own menu never belongs over the collage.
                  event.preventDefault();
                  if (transform) {
                    cancelTransform();
                    return;
                  }
                  if (crop) return;
                  const at = framePoint(event);
                  const stack = piecesUnder(pieces, at);
                  // Bare frame has nothing to list, so nothing opens.
                  if (stack.length === 0) {
                    setHereMenu(null);
                    return;
                  }
                  setHereMenu({ at, pieceIds: stack.map((piece) => piece.id) });
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
                  const offFrame =
                    piece.x + piece.width < 0 ||
                    piece.y + piece.height < 0 ||
                    piece.x > frame.width ||
                    piece.y > frame.height;
                  return (
                    <div
                      key={piece.id}
                      className={`collage-piece${isSelected ? " collage-piece--selected" : ""}${
                        offFrame ? " collage-piece--off-frame" : ""
                      }`}
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
                      onPointerUp={endGesture}
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

                {/* What a click would take, shown faintly so a piece under a pile
                    can be seen before it is reached for. */}
                {hovered && hovered.id !== selectedId && !peek.held && (
                  <div
                    className="collage-piece-hover"
                    aria-hidden="true"
                    style={{
                      left: hovered.x,
                      top: hovered.y,
                      width: hovered.width,
                      height: hovered.height,
                      transform: `rotate(${hovered.rotation}deg)`,
                      borderWidth: 1 / scale,
                    }}
                  />
                )}

                {peek.held && (
                  <ProvenancePeek
                    pieces={ordered}
                    hoveredId={hoveredId}
                    scale={scale}
                  />
                )}

                {hereMenu && hereStack.length > 0 && (
                  <PiecesHereMenu
                    pieces={hereStack}
                    at={hereMenu.at}
                    scale={scale}
                    selectedId={selectedId}
                    onPick={(pieceId) => {
                      setSelectedId(pieceId);
                      setHereMenu(null);
                    }}
                    onClose={() => setHereMenu(null)}
                  />
                )}

                {readout && selected && (
                  <p
                    className="collage-readout"
                    style={{
                      left: selected.x + selected.width / 2,
                      top: selected.y,
                      // The slip stays upright and the same size on screen however
                      // the frame is zoomed or the piece is turned.
                      transform: `translate(-50%, calc(-100% - 12px)) scale(${1 / scale})`,
                    }}
                  >
                    {readout}
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

                {/* The tools for whatever is in hand ride with the piece, and
                    stand aside while a gesture, a mode, or a peek is running. */}
                {selected &&
                  !crop &&
                  !transform &&
                  !peek.held &&
                  gesture.kind === "idle" && (
                  <PieceActions
                    piece={selected}
                    canUncrop={!isFullCrop(selected.crop)}
                    canCutOut={selected.scrap.kind === "image"}
                    scale={scale}
                    frame={frame}
                    onOrder={(to) =>
                      commit(
                        {
                          forward: movePieceForward,
                          backward: movePieceBackward,
                          front: movePieceToFront,
                          back: movePieceToBack,
                        }[to](pieces, selected.id),
                      )
                    }
                    onFlip={(axis) =>
                      editPiece(selected.id, (piece) => flipPiece(piece, axis))
                    }
                    onCrop={enterCrop}
                    onUncrop={() => editPiece(selected.id, clearCrop)}
                    onCutOut={() =>
                      selected.cutout
                        ? editPiece(selected.id, ({ cutout: _cut, ...rest }) => rest)
                        : cutOutSelected()
                    }
                    onDuplicate={() => duplicatePiece(selected)}
                    onRemove={removeSelected}
                  />
                )}

                <div className="collage-frame__edge" />
              </div>

              <CollageBackFace
                frame={frame}
                paper={paper}
                content={backContent}
                front={bleed}
                showing={over}
                onProblem={onBackProblem}
              />
            </div>
          </div>

          <StudioTools
            canUndo={!over && canUndo(history)}
            canRedo={!over && canRedo(history)}
            keysOpen={showKeys}
            turnedOver={over}
            onUndo={() => setHistory((current) => undo(current))}
            onRedo={() => setHistory((current) => redo(current))}
            onKeys={() => setShowKeys((value) => !value)}
            onTurnOver={turnOver}
          />

          <FormatControl
            format={format}
            paper={paper}
            zoom={scale}
            pieceCount={pieces.length}
            onFormat={setFormat}
            onPaper={setPaper}
          />

          {showKeys && <KeysPopover onClose={() => setShowKeys(false)} />}
        </div>

        <div className="collage-bar">
          {/* The back already carries the title and the count, so while it
              is being read the bar only says how to turn it face up. */}
          {over ? (
            <span className="collage-studio__label collage-bar__turned">
              turned over · T or esc to turn back
            </span>
          ) : (
            <>
              <input
                className="collage-title-input"
                value={title}
                placeholder="untitled collage"
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Collage title"
              />
              <span className="collage-bar__spacer" />
              <span className="collage-studio__label">
                {pieces.length} piece{pieces.length === 1 ? "" : "s"}
                {pieces.length > 0 && " · hold i for sources"}
              </span>
            </>
          )}
          <span className="collage-bar__spacer" />
          {standing.text && (
            <p
              className={`collage-standing${
                standing.problem ? " collage-standing--problem" : ""
              }`}
              role="status"
            >
              {standing.text}
            </p>
          )}
          <button
            type="button"
            className="collage-action"
            disabled={exporting || pieces.length === 0}
            onClick={() => void download()}
          >
            export png
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
            <button type="button" className="collage-action" onClick={leave}>
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
