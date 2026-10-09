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
  cornerPoint,
  type Bounds,
  type BoxEdge,
  fanOutPlacement,
  fitWithin,
  frameScale,
  normalizeDegrees,
  dragCorner,
  dragEdge,
  edgeGrabOffset,
  lockToAxis,
  rotationToPointer,
  sameCrop,
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
  collageProvenance,
  commitCropSession,
  createCollageId,
  cropSessionStart,
  setPieceLocked,
  createPieceId,
  normalizeStack,
  flipPiece,
  pieceMaterialTransform,
  type BackShows,
  type CollagePiece,
  type CollageRecord,
} from "./collageRecord";
import {
  DEFAULT_CUTOUT_TOLERANCE,
  cutoutKeeps,
  invertedCutout,
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
  releaseTypingFocus,
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
  readDrawerPreference,
  writeDrawerPreference,
  type DrawerPreference,
} from "./drawerPreference";
import { PieceActions } from "./PieceActions";
import {
  EditorSwitch,
  collageToHandOver,
  type EditorSwitchChoice,
} from "./EditorSwitch";
import { KeysButton, StudioTools, StudioViews } from "./StudioTools";
import { FormatControl } from "./FormatControl";
import {
  CollageBakeError,
  bakeCollage,
  bakeCollagePreview,
} from "./bakeCollage";
import {
  bakeCollageBack,
  resolveBackFavicons,
  resolveBackThumbnails,
} from "./bakeCollageBack";
import { videoExportSupport } from "./imageAnimation";
import { useCollageAnimates } from "./useCollageAnimates";
import { CollageBackFace } from "./CollageBackFace";
import { BackLookTuner } from "./BackLookTuner";
import {
  BACK_LOOK,
  type BackLook,
  type CollageBackContent,
} from "./collageBack";
import { saveCollage } from "./collageStore";
import { ScrapTray } from "./ScrapTray";
import { PieceMaterial } from "./PieceMaterial";
import { naturalScrapSize } from "./pieceLettering";
import { CropSession } from "./CropSession";
import { KeysPopover } from "./KeysPopover";
import { ProvenancePeek } from "./ProvenancePeek";
import { paperBackground } from "./paperGrain";
import { PiecesHereMenu } from "./PiecesHereMenu";
import {
  neighborInStack,
  piecesUnder,
  stackOrder,
  topPieceUnder,
} from "./pieceStack";
import {
  EMPTY_SELECTION,
  isSelected,
  marqueeSelection,
  planBarePress,
  planSelectionPress,
  pruneSelection,
  selectAll,
  selectMany,
  selectablePieces,
  selectOnly,
  soleSelected,
  type Selection,
} from "./studioSelection";
import {
  MIN_GROUP_FACTOR,
  angleAbout,
  groupBounds,
  groupScaleFromCorner,
  groupScaleFromEdge,
  mirrorGroup,
  piecesInRect,
  rectBetween,
  rotateGroup,
  scaleGroup,
  translateGroup,
  type PlacedBox,
} from "./groupGeometry";
import {
  copiesOnTop,
  moveGroupBackward,
  moveGroupForward,
  moveGroupToBack,
  moveGroupToFront,
  piecesById,
  removePieces,
  replacePieces,
} from "./pieceGroup";
import { handleZones, type HandleZone } from "./handleZones";
import {
  toolSessionActive,
  visiblePanel,
  type PanelState,
} from "./studioPanels";
import { CutoutControl } from "./CutoutControl";
import { CropControl } from "./CropControl";
import { createPeekState, stepPeek, type PeekEvent } from "./peekHold";
import {
  useCollageAutosave,
  type AutosaveTimers,
  type CollageDraft,
} from "./useCollageAutosave";
import type { SaveStanding } from "./autosaveSchedule";
import { collageExportName } from "./collageFile";

/** Longest side a freshly placed piece takes, in frame units. */
const PLACED_MAX_SIDE = 220;
const ROTATION_SNAP_DEGREES = 15;
/** How far a pasted or duplicated piece lands from its original. */
const COPY_OFFSET = 24;
/** Stage padding around the frame, in screen pixels. */
const STAGE_PADDING = 12;
/**
 * Room kept clear at the top of the stage for the tool and format bars that
 * float there, so a frame fitted to a tall stage never slides under them.
 */
const STAGE_TOP_BAND = 52;
/** The mat around the frame, in screen pixels, and the band under it that carries the caption. */
const MAT = 26;
const MAT_CAPTION = 44;
/** How far inside the stage's edge a pinned handle stays, in screen pixels. */
const HANDLE_INSET = 10;
/** Frame units the pointer must travel before an alt-drag pulls out a copy. */
const ALT_DRAG_THRESHOLD = 4;
/**
 * Longest a press may be held and still count as a click. A press held longer
 * was the start of a drag that never got going, so it leaves the selection be.
 */
const CLICK_MAX_MS = 350;

/** What a scaling drag took hold of: a corner or an edge of the box. */
type ScaleGrip =
  | { kind: "corner"; corner: ResizeCorner }
  | { kind: "edge"; edge: BoxEdge };

type Gesture =
  | { kind: "idle" }
  | {
      kind: "move";
      /** The pieces being carried, as they were when the press landed. */
      origins: readonly CollagePiece[];
      grabbedAt: Point;
      copyOnDrag?: boolean;
    }
  | {
      kind: "resize";
      grip: ScaleGrip;
      /** The piece as it was when the drag began. */
      before: CollagePiece;
      /**
       * From where the press landed to the real corner or edge. A handle
       * pinned into view sits away from its corner, and an edge's grip is a
       * few pixels wide; either way the drag acts as if the corner or the
       * edge line itself had been grabbed.
       */
      toGrip: Point;
    }
  | {
      kind: "rotate";
      /** The piece as it was when the turn began. */
      before: CollagePiece;
      /** The angle from the piece's center to where the press landed. */
      grabAngle: number;
    }
  | {
      kind: "groupScale";
      grip: ScaleGrip;
      /** The group's box when the drag began. */
      bounds: Bounds;
      before: readonly CollagePiece[];
      /** From the press to the real corner or edge, as for a single piece. */
      toGrip: Point;
    }
  | {
      kind: "groupRotate";
      /** The group's box when the turn began; it turns with the pieces. */
      bounds: Bounds;
      before: readonly CollagePiece[];
      /** The angle from the group's center to where the press landed. */
      grabAngle: number;
      /** How far the group has turned so far, in degrees. */
      turned: number;
    }
  | {
      kind: "marquee";
      start: Point;
      end: Point;
      /** What was held when the marquee began, kept under a shift marquee. */
      base: Selection;
      additive: boolean;
    };

/** A rotate or scale driven by pointer movement with no button held. */
type ModalTransform = {
  kind: "rotate" | "scale";
  /** The pieces in hand as they were when the transform began, for cancelling back. */
  before: readonly CollagePiece[];
  /** What the pieces turn or grow about: the piece's center or the group's. */
  center: Point;
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
  /** The choice of editor, offered to people with experiment access. */
  editorSwitch?: EditorSwitchChoice;
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

function placedPiece(item: ScrapItem, at: Point, z: number): CollagePiece {
  const natural = naturalScrapSize(item);
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

/** The day a collage was started, the way the history cards write it. */
function madeOn(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toLowerCase();
}

export function CollageStudio({
  scraps,
  editing,
  onSaved,
  onLeave,
  autosaveTimers,
  editorSwitch,
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
  /** The pieces in hand, which is studio state only and never stored. */
  const [heldSelection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const [format, setFormat] = useState<CollageFormatName>(
    editing?.format ?? DEFAULT_FORMAT,
  );
  const [paper, setPaper] = useState<CollagePaper>(
    editing?.paper ?? DEFAULT_PAPER,
  );
  // A collage stored before the back could list titles has always shown pieces.
  const [backShows, setBackShows] = useState<BackShows>(
    editing?.backShows ?? "pieces",
  );
  const frame = formatOf(format);
  const [drawer, setDrawer] = useState(() => readDrawerPreference());
  /** Whether the collage is turned over to its back, where the sources are. */
  const [over, setOver] = useState(false);
  const [backLook, setBackLook] = useState<BackLook>(BACK_LOOK);
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
  /**
   * The picture whose cutout edge is being tuned, and the cutout it had when
   * the control opened, restored if the session is cancelled.
   */
  const [cutoutSession, setCutoutSession] = useState<{
    pieceId: string;
    before: PieceCutout | undefined;
  } | null>(null);
  const [gesture, setGesture] = useState<Gesture>({ kind: "idle" });
  /** What the slip above the selected piece says while a gesture runs. */
  const [gestureReadout, setGestureReadout] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<readonly CollagePiece[] | null>(
    null,
  );
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);
  /** How far a video export has come, as a share of its frames, while it runs. */
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "problem" | "quiet"; text: string } | null
  >(null);
  const [dropActive, setDropActive] = useState(false);
  const [peek, setPeek] = useState(createPeekState);
  /** The sources view left on from its toggle; holding i shows it too. */
  const [sourcesOn, setSourcesOn] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** The pile the "pieces here" menu is listing, and where it opened. */
  const [hereMenu, setHereMenu] = useState<{
    at: Point;
    pieceIds: string[];
  } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  /**
   * The press in progress, so release can tell a click from a drag. A press
   * that never travelled was a click and settles on the piece it planned to
   * select; a drag leaves the selection with the piece it moved.
   */
  const pressRef = useRef<{
    at: Point;
    downAt: number;
    selectOnClick: Selection;
    moved: boolean;
  } | null>(null);
  /** Where the pointer last was over the stage, in frame units. */
  const lastPointerRef = useRef<Point | null>(null);
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
      backShows,
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
      bakeCollagePreview({
        frame: formatOf(draftRef.current.record.format),
        pieces: draftRef.current.record.pieces,
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
      backShows,
    }),
    [pieces, title, paper.color, paper.grain, format, backShows],
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
      : cutoutSession
        ? "cutout"
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

  const ordered = useMemo(() => stackOrder(pieces), [pieces]);
  /** The pieces a click, a hover or a step can reach; locked ones are passed over. */
  const reachable = useMemo(() => selectablePieces(ordered), [ordered]);
  // An undo or a delete can take away pieces that were in hand, and a lock
  // holds a piece out of reach; the hand only ever holds pieces that are on
  // the collage and free to move, so no group edit can touch a locked one.
  const selection = useMemo(
    () => pruneSelection(heldSelection, reachable),
    [heldSelection, reachable],
  );
  /** Everything in hand, back to front. */
  const selectedPieces = useMemo(
    () => ordered.filter((piece) => isSelected(selection, piece.id)),
    [ordered, selection],
  );
  const multiple = selectedPieces.length > 1;
  /** The piece in hand when it is the only one, which single-piece tools act on. */
  const selectedId = soleSelected(selection);
  const selected = useMemo(
    () => pieces.find((piece) => piece.id === selectedId) ?? null,
    [pieces, selectedId],
  );
  /**
   * The box the selection is drawn on and its tools float beside: the piece
   * itself, or the upright box around several.
   */
  const selectionBox = useMemo<PlacedBox | null>(() => {
    if (selectedPieces.length === 0) return null;
    if (selectedPieces.length === 1) return selectedPieces[0];
    return { ...groupBounds(selectedPieces), rotation: 0 };
  }, [selectedPieces]);
  const selectPiece = useCallback((id: string | null) => {
    setSelection(id ? selectOnly(id) : EMPTY_SELECTION);
  }, []);
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

  // One decision picks the floating panel on screen, so a tool's own controls
  // can never be covered by the piece strip or the stack menu.
  const panelState: PanelState = {
    turnedOver: over,
    cropping: crop !== null,
    transforming: transform !== null,
    cuttingOut: cutoutSession !== null,
    piecesHereOpen: hereStack.length > 0,
    gestureRunning: gesture.kind !== "idle",
    peekHeld: (peek.held || sourcesOn) && !over,
    hasSelection: selectedPieces.length > 0,
  };
  const panel = visiblePanel(panelState);
  const toolActive = toolSessionActive(panelState);

  // The cutout session belongs to one piece; once that piece is no longer in
  // hand, however that happened, the session is over and keeps what it made.
  useEffect(() => {
    if (cutoutSession && cutoutSession.pieceId !== selectedId) {
      setCutoutSession(null);
      setHistory((current) => endRun(current));
    }
  }, [cutoutSession, selectedId]);

  /** Commits an arrangement, coalescing a continuous run into one undo step. */
  const commit = useCallback(
    (next: readonly CollagePiece[], runLabel: string | null = null) => {
      setHistory((current) => recordArrangement(current, next, runLabel));
    },
    [],
  );

  /** Puts changed pieces back into the arrangement as one edit. */
  const editPieces = useCallback(
    (changed: readonly CollagePiece[], runLabel: string | null = null) => {
      setHistory((current) =>
        recordArrangement(
          current,
          replacePieces(current.present, changed),
          runLabel,
        ),
      );
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
          width: stage.clientWidth - STAGE_PADDING * 2 - MAT * 2,
          height:
            stage.clientHeight - STAGE_TOP_BAND - STAGE_PADDING - MAT - MAT_CAPTION,
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

  /**
   * The part of the stage in view, in frame units, kept clear of the bars
   * along its top. A corner handle that would fall outside it is pinned to
   * its edge.
   */
  const [inView, setInView] = useState<Bounds | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const frameNode = frameRef.current;
    if (!stage || !frameNode) return;
    const measure = () => {
      const area = stage.getBoundingClientRect();
      const origin = frameNode.getBoundingClientRect();
      const inset = HANDLE_INSET;
      setInView({
        x: (area.left + inset - origin.left) / scale,
        y: (area.top + STAGE_TOP_BAND - origin.top) / scale,
        width: (area.width - inset * 2) / scale,
        height: (area.height - STAGE_TOP_BAND - inset) / scale,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [scale, frame]);

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
      selectPiece(piece.id);
      setNotice(null);
    },
    [commit, pieces, selectPiece],
  );

  const removeSelected = useCallback(() => {
    if (selection.ids.length === 0) return;
    commit(removePieces(pieces, selection.ids));
    setSelection(EMPTY_SELECTION);
    setCrop(null);
  }, [commit, pieces, selection]);

  /**
   * Lays copies of the given pieces on top of the stack and takes them in
   * hand. A run label lets an alt-drag's copy and its move undo together.
   */
  const duplicatePieces = useCallback(
    (originals: readonly CollagePiece[], runLabel: string | null = null) => {
      const copies = copiesOnTop(pieces, originals, COPY_OFFSET, createPieceId);
      commit([...pieces, ...copies], runLabel);
      setSelection(selectMany(copies.map((copy) => copy.id)));
      return copies;
    },
    [commit, pieces],
  );

  /** Mirrors what is in hand: one piece flips in place, several as a whole. */
  const flipSelection = useCallback(
    (axis: "x" | "y") => {
      if (selectedPieces.length === 0) return;
      if (selectedPieces.length === 1) {
        editPiece(selectedPieces[0].id, (piece) => flipPiece(piece, axis));
        return;
      }
      editPieces(mirrorGroup(selectedPieces, axis));
    },
    [editPiece, editPieces, selectedPieces],
  );

  /**
   * Holds everything in hand in place and puts it down. Each piece is let go
   * again on its own, from the list of pieces under a point.
   */
  const lockSelection = useCallback(() => {
    if (selectedPieces.length === 0) return;
    editPieces(selectedPieces.map((piece) => setPieceLocked(piece, true)));
    setSelection(EMPTY_SELECTION);
  }, [editPieces, selectedPieces]);

  const restackSelection = useCallback(
    (to: "forward" | "backward" | "front" | "back") => {
      if (selection.ids.length === 0) return;
      const move = {
        forward: moveGroupForward,
        backward: moveGroupBackward,
        front: moveGroupToFront,
        back: moveGroupToBack,
      }[to];
      commit(move(pieces, selection.ids));
    },
    [commit, pieces, selection],
  );

  const enterCrop = useCallback(() => {
    if (!selected) return;
    setTransform(null);
    setCrop({
      pieceId: selected.id,
      crop: cropSessionStart(selected),
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
    if (target && !sameCrop(target.crop, crop.crop)) {
      editPiece(crop.pieceId, (piece) => commitCropSession(piece, crop.crop));
    }
    setCrop(null);
  }, [crop, editPiece, pieces]);

  const cancelCrop = useCallback(() => setCrop(null), []);

  /**
   * Whether the running crop has changed the piece. The crop lives outside
   * the history until it is committed, so this is an edit undo can take back.
   */
  const cropPending = useMemo(() => {
    if (!crop) return false;
    const target = pieces.find((piece) => piece.id === crop.pieceId);
    return Boolean(target && !sameCrop(target.crop, crop.crop));
  }, [crop, pieces]);

  const beginTransform = useCallback(
    (kind: "rotate" | "scale") => {
      if (!selectionBox) return;
      setCrop(null);
      const center = boxCenter(selectionBox);
      // Until the pointer moves, the transform reads from the selection's
      // edge so a scale starts at exactly one. A group turns by how far the
      // pointer goes round from where it was, so it starts where it stands.
      const edge = { x: center.x + selectionBox.width / 2, y: center.y };
      const pointer = lastPointerRef.current;
      const anchor =
        kind === "rotate" &&
        multiple &&
        pointer &&
        Math.hypot(pointer.x - center.x, pointer.y - center.y) > 1
          ? pointer
          : edge;
      setTransform({
        kind,
        before: selectedPieces,
        center,
        anchor,
        readout: kind === "rotate" ? "0 deg" : "100%",
      });
    },
    [multiple, selectedPieces, selectionBox],
  );

  const confirmTransform = useCallback(() => {
    setTransform(null);
    setHistory((current) => endRun(current));
  }, []);

  const cancelTransform = useCallback(() => {
    if (!transform) return;
    editPieces(transform.before, "transform");
    setTransform(null);
  }, [editPieces, transform]);

  /**
   * Opens the cutout's edge control on the selected picture, cutting its
   * background away first if it still has one. The whole session, from the
   * first cut through every change of edge, is one undo step.
   */
  const beginCutout = useCallback(() => {
    if (!selected || selected.scrap.kind !== "image") return;
    setCutoutSession({ pieceId: selected.id, before: selected.cutout });
    if (!selected.cutout) {
      const cutout: PieceCutout = {
        method: "edge-color",
        tolerance: DEFAULT_CUTOUT_TOLERANCE,
      };
      editPiece(
        selected.id,
        (piece) => ({ ...piece, cutout }),
        `cutout:${selected.id}`,
      );
    }
  }, [editPiece, selected]);

  const reshapeCutout = useCallback(
    (change: (cutout: PieceCutout) => PieceCutout) => {
      if (!cutoutSession) return;
      editPiece(
        cutoutSession.pieceId,
        (piece) =>
          piece.cutout ? { ...piece, cutout: change(piece.cutout) } : piece,
        `cutout:${cutoutSession.pieceId}`,
      );
    },
    [cutoutSession, editPiece],
  );

  const tuneCutout = useCallback(
    (tolerance: number) => reshapeCutout((cutout) => ({ ...cutout, tolerance })),
    [reshapeCutout],
  );

  const invertCutout = useCallback(
    () => reshapeCutout(invertedCutout),
    [reshapeCutout],
  );

  const confirmCutout = useCallback(() => {
    setCutoutSession(null);
    setHistory((current) => endRun(current));
  }, []);

  /** Puts the piece back the way it was when the edge control opened. */
  const cancelCutout = useCallback(() => {
    if (!cutoutSession) return;
    const { pieceId, before } = cutoutSession;
    editPiece(
      pieceId,
      ({ cutout: _cut, ...rest }) => (before ? { ...rest, cutout: before } : rest),
      `cutout:${pieceId}`,
    );
    confirmCutout();
  }, [confirmCutout, cutoutSession, editPiece]);

  const keepBackground = useCallback(() => {
    if (!cutoutSession) return;
    editPiece(
      cutoutSession.pieceId,
      ({ cutout: _cut, ...rest }) => rest,
      `cutout:${cutoutSession.pieceId}`,
    );
    confirmCutout();
  }, [confirmCutout, cutoutSession, editPiece]);

  /**
   * Turns the collage over or face up again. Whatever was in hand is put
   * down first, so the back is only ever read and nothing is edited behind it.
   */
  const turnOver = useCallback(() => {
    if (transform) confirmTransform();
    if (crop) commitCrop();
    setSelection(EMPTY_SELECTION);
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
      pieces: normalizeStack(pieces),
      shows: backShows,
    }),
    [backShows, changedAt, pieces, title],
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
    bakeCollagePreview({ frame, pieces })
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
  }, [frame, lastPreview, over, pieces, standingKind]);

  const stepSelection = useCallback(
    (direction: 1 | -1) => {
      if (reachable.length === 0) return;
      const index = reachable.findIndex(
        (piece) => piece.id === selection.primary,
      );
      const next =
        index === -1
          ? direction === 1
            ? 0
            : reachable.length - 1
          : (index + direction + reachable.length) % reachable.length;
      selectPiece(reachable[next].id);
    },
    [reachable, selectPiece, selection.primary],
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

  /**
   * Ends a run so the next edit becomes its own undo step. A press that never
   * travelled was a click, which settles on what its plan chose: the frontmost
   * piece under the pointer, the deeper one a cmd-click reached, the one piece
   * a click narrows a group to, or nothing for a click on bare paper.
   */
  const endGesture = useCallback((event?: React.PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (
      event &&
      press &&
      !press.moved &&
      performance.now() - press.downAt <= CLICK_MAX_MS
    ) {
      setSelection(press.selectOnClick);
    }
    setGesture({ kind: "idle" });
    setGestureReadout(null);
    setHistory((current) => endRun(current));
  }, []);

  /**
   * Finishes whatever is running so undo and redo step from a settled
   * arrangement: a crop, cutout or modal transform is kept as it stands, and
   * a drag stops where it is and no longer follows the pointer.
   */
  const finishRunning = useCallback(() => {
    if (crop) commitCrop();
    else if (cutoutSession) confirmCutout();
    else if (transform) confirmTransform();
    if (gesture.kind !== "idle") endGesture();
  }, [
    commitCrop,
    confirmCutout,
    confirmTransform,
    crop,
    cutoutSession,
    endGesture,
    gesture.kind,
    transform,
  ]);

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
          hasSelection: selectedPieces.length > 0,
          multiple,
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
          if (selectedPieces.length > 0) duplicatePieces(selectedPieces);
          break;
        case "copy":
          if (selectedPieces.length > 0) setClipboard(selectedPieces);
          break;
        case "paste":
          if (clipboard) duplicatePieces(clipboard);
          break;
        case "undo":
          finishRunning();
          setHistory((current) => undo(current));
          break;
        case "redo":
          finishRunning();
          setHistory((current) => redo(current));
          break;
        case "withhold":
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
          beginCutout();
          break;
        case "flip":
          flipSelection(command.axis);
          break;
        case "toggleDrawer":
          updateDrawer({ collapsed: !drawer.collapsed });
          break;
        case "confirm":
          if (crop) commitCrop();
          else if (cutoutSession) confirmCutout();
          else confirmTransform();
          break;
        case "cancel":
          if (crop) cancelCrop();
          else if (cutoutSession) cancelCutout();
          else cancelTransform();
          break;
        case "deselect":
          setSelection(EMPTY_SELECTION);
          break;
        case "selectAll":
          setSelection(selectAll(ordered));
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
          const next = neighborInStack(
            reachable,
            selection.primary,
            command.direction,
          );
          if (next) selectPiece(next);
          break;
        }
        case "nudge":
          if (selectedPieces.length > 0) {
            // A burst of nudges to the same hand undoes as one step.
            editPieces(
              translateGroup(selectedPieces, command.dx, command.dy),
              `nudge:${selection.ids.join(",")}`,
            );
          }
          break;
        case "order":
          restackSelection(command.to);
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
    beginCutout,
    cancelCutout,
    confirmCutout,
    cutoutSession,
    duplicatePieces,
    editPieces,
    enterCrop,
    finishRunning,
    flipSelection,
    mode,
    multiple,
    ordered,
    pieces,
    reachable,
    removeSelected,
    restackSelection,
    selectPiece,
    selectedPieces,
    selection,
    stepSelection,
    turnOver,
  ]);

  /**
   * Carries the pieces a move gesture holds to follow the pointer. Shift keeps
   * the move to the axis the drag has mostly travelled along, decided afresh
   * each time so the axis can change mid-drag.
   */
  const carry = useCallback(
    (
      origins: readonly CollagePiece[],
      grabbedAt: Point,
      point: Point,
      lockAxis: boolean,
    ) => {
      const travel = { x: point.x - grabbedAt.x, y: point.y - grabbedAt.y };
      const delta = lockAxis ? lockToAxis(travel) : travel;
      editPieces(translateGroup(origins, delta.x, delta.y), "move");
    },
    [editPieces],
  );

  // Pressing or letting go of shift mid-drag locks or frees the axis at once,
  // without waiting for the pointer to move again.
  useEffect(() => {
    if (gesture.kind !== "move") return;
    const { origins, grabbedAt } = gesture;
    const onShift = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      const point = lastPointerRef.current;
      if (!point || !pressRef.current?.moved) return;
      carry(origins, grabbedAt, point, event.type === "keydown");
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  }, [carry, gesture]);

  const onStagePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (over) return;
      const point = framePoint(event);
      lastPointerRef.current = point;

      // What a click would take, shown faintly so a buried piece can be seen
      // before it is reached for. A rotated-rect test per piece, no pixels.
      if (gesture.kind === "idle" && !toolActive) {
        const under = topPieceUnder(reachable, point);
        setHoveredId(under?.id ?? null);
      }

      const press = pressRef.current;
      if (press && !press.moved) {
        // Past the threshold this press is a drag, not a click, so release
        // leaves the selection with the pieces that moved.
        if (
          Math.hypot(point.x - press.at.x, point.y - press.at.y) >
          ALT_DRAG_THRESHOLD
        ) {
          press.moved = true;
        }
      }

      if (transform) {
        const { before, center, anchor } = transform;
        if (transform.kind === "rotate") {
          if (before.length === 1) {
            const raw = rotationToPointer(before[0], point);
            const degrees = event.shiftKey
              ? snapDegrees(raw, ROTATION_SNAP_DEGREES)
              : raw;
            editPieces([{ ...before[0], rotation: degrees }], "transform");
            setTransform({ ...transform, readout: `${Math.round(degrees)} deg` });
          } else {
            const raw = normalizeDegrees(
              angleAbout(center, point) - angleAbout(center, anchor),
            );
            const degrees = event.shiftKey
              ? snapDegrees(raw, ROTATION_SNAP_DEGREES)
              : raw;
            editPieces(rotateGroup(before, center, degrees), "transform");
            setTransform({ ...transform, readout: `${Math.round(degrees)} deg` });
          }
        } else {
          const factor = scaleFromPointer(center, anchor, point);
          if (before.length === 1) {
            editPieces(
              [{ ...before[0], ...scaleAboutCenter(before[0], factor) }],
              "transform",
            );
            setTransform({
              ...transform,
              readout: `${Math.round(factor * 100)}%`,
            });
          } else {
            const even = Math.max(MIN_GROUP_FACTOR, factor);
            editPieces(
              scaleGroup(before, { anchor: center, x: even, y: even }),
              "transform",
            );
            setTransform({
              ...transform,
              readout: `${Math.round(even * 100)}%`,
            });
          }
        }
        return;
      }

      if (gesture.kind === "idle") return;
      if (gesture.kind === "marquee") {
        // Until the press travels it may still be a click on bare paper, so
        // the hand is left as the press found it.
        if (!press?.moved) return;
        const area = rectBetween(gesture.start, point);
        const touched = piecesInRect(reachable, area).map((piece) => piece.id);
        setSelection(marqueeSelection(gesture.base, touched, gesture.additive));
        setGesture({ ...gesture, end: point });
        return;
      }
      if (gesture.kind === "move") {
        const { origins, grabbedAt } = gesture;
        // A copy is pulled out only after the pointer has clearly moved, and
        // the copy and its move undo together.
        if (
          gesture.copyOnDrag &&
          Math.hypot(point.x - grabbedAt.x, point.y - grabbedAt.y) >
            ALT_DRAG_THRESHOLD
        ) {
          const copies = duplicatePieces(origins, "move");
          setGesture({ kind: "move", origins: copies, grabbedAt });
          return;
        }
        carry(origins, grabbedAt, point, event.shiftKey);
        return;
      }
      if (gesture.kind === "groupScale") {
        const { grip } = gesture;
        const reach = {
          bounds: gesture.bounds,
          pointer: {
            x: point.x + gesture.toGrip.x,
            y: point.y + gesture.toGrip.y,
          },
          // As on one piece: shift frees the ratio, alt grows about the middle.
          keepAspect: !event.shiftKey,
          aboutCenter: event.altKey,
        };
        const grow =
          grip.kind === "corner"
            ? groupScaleFromCorner({ ...reach, corner: grip.corner })
            : groupScaleFromEdge({ ...reach, edge: grip.edge });
        editPieces(scaleGroup(gesture.before, grow), "groupScale");
        const across = grow.x < 0 || grow.y < 0 ? " · flipped" : "";
        const wide = Math.round(Math.abs(grow.x) * 100);
        const tall = Math.round(Math.abs(grow.y) * 100);
        setGestureReadout(
          wide === tall
            ? `scale ${wide}%${across}`
            : `scale ${wide}% × ${tall}%${across}`,
        );
        return;
      }
      if (gesture.kind === "groupRotate") {
        const center = boxCenter(gesture.bounds);
        const raw = normalizeDegrees(
          angleAbout(center, point) - gesture.grabAngle,
        );
        const degrees = event.shiftKey
          ? snapDegrees(raw, ROTATION_SNAP_DEGREES)
          : raw;
        editPieces(rotateGroup(gesture.before, center, degrees), "groupRotate");
        setGesture({ ...gesture, turned: degrees });
        setGestureReadout(`rotate ${Math.round(degrees)} deg`);
        return;
      }
      if (gesture.kind === "resize") {
        const { before, grip } = gesture;
        const reach = {
          box: before,
          rotationDegrees: before.rotation,
          pointer: {
            x: point.x + gesture.toGrip.x,
            y: point.y + gesture.toGrip.y,
          },
          // A picture keeps its proportions, from an edge as from a corner;
          // shift frees them and alt grows the piece about its own center.
          keepAspect: !event.shiftKey,
          aboutCenter: event.altKey,
        };
        const drag =
          grip.kind === "corner"
            ? dragCorner({ ...reach, corner: grip.corner })
            : dragEdge({ ...reach, edge: grip.edge });
        // Pulled past the far side, the piece turns over across that axis.
        editPieces(
          [
            {
              ...before,
              ...drag.box,
              flipX: drag.flippedX ? !before.flipX : before.flipX,
              flipY: drag.flippedY ? !before.flipY : before.flipY,
            },
          ],
          `resize:${before.id}`,
        );
        const wide = Math.round((drag.box.width / before.width) * 100);
        const tall = Math.round((drag.box.height / before.height) * 100);
        const across = drag.flippedX || drag.flippedY ? " · flipped" : "";
        setGestureReadout(
          wide === tall
            ? `scale ${wide}%${across}`
            : `scale ${wide}% × ${tall}%${across}`,
        );
        return;
      }
      if (gesture.kind === "rotate") {
        const { before, grabAngle } = gesture;
        // The piece turns by as much as the pointer has gone round its
        // center since the press, so grabbing any corner starts it still.
        const raw = normalizeDegrees(
          before.rotation + angleAbout(boxCenter(before), point) - grabAngle,
        );
        const degrees = event.shiftKey
          ? snapDegrees(raw, ROTATION_SNAP_DEGREES)
          : raw;
        editPieces([{ ...before, rotation: degrees }], `rotate:${before.id}`);
        setGestureReadout(`rotate ${Math.round(degrees)} deg`);
      }
    },
    [
      carry,
      duplicatePieces,
      editPiece,
      editPieces,
      framePoint,
      gesture,
      over,
      reachable,
      toolActive,
      transform,
    ],
  );

  /**
   * A press is planned the moment it lands (see planSelectionPress): a drag
   * moves what is in hand when the press is inside it, and a click settles on
   * release, because only then is it known that the press was a click and not
   * the start of a drag. Shift adds or takes away a piece; cmd or ctrl
   * reaches the next piece down instead.
   */
  const beginMove = (piece: CollagePiece, event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (transform) {
      confirmTransform();
      return;
    }
    // Pressing a piece puts a running cutout down, keeping the edge it has.
    if (cutoutSession) confirmCutout();
    setHereMenu(null);
    const at = framePoint(event);
    // The element took the press, so when the rotated-box test misses by a
    // rounding hair at an edge, the piece the page hit is the answer.
    const plan = planSelectionPress(
      reachable,
      at,
      selection,
      multiple ? selectionBox : null,
      {
        deep: event.metaKey || event.ctrlKey,
        additive: event.shiftKey,
      },
    ) ?? {
      selectOnDown: selectOnly(piece.id),
      dragIds: [piece.id],
      selectOnClick: selectOnly(piece.id),
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setSelection(plan.selectOnDown);
    setCrop(null);
    pressRef.current = {
      at,
      downAt: performance.now(),
      selectOnClick: plan.selectOnClick,
      moved: false,
    };
    setGesture({
      kind: "move",
      origins: piecesById(pieces, plan.dragIds),
      grabbedAt: at,
      // Alt-dragging pulls out a copy, but only once the pointer travels, so
      // a plain alt-click just selects.
      copyOnDrag: event.altKey,
    });
  };

  /**
   * A press on bare paper, in the frame or on the stage around it. It puts a
   * running tool down. Inside the box around several held pieces it grabs
   * them all (see planBarePress); elsewhere it lets go of what is in hand
   * (shift keeps it) and starts a marquee that takes every piece it touches.
   */
  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || over) return;
    const target = event.target as HTMLElement;
    const onBarePaper = target.dataset.marqueeGround !== undefined;
    const inFrame = frameRef.current?.contains(target) ?? false;
    // The bars floating over the stage keep their own presses.
    if (!onBarePaper && !inFrame) return;
    setHereMenu(null);
    // Clicking away confirms a running mode rather than losing it.
    if (transform) {
      confirmTransform();
      return;
    }
    if (crop) {
      commitCrop();
      return;
    }
    if (cutoutSession) {
      confirmCutout();
      return;
    }
    if (!onBarePaper) {
      setSelection(EMPTY_SELECTION);
      return;
    }
    const at = framePoint(event);
    const plan = planBarePress(
      at,
      selection,
      multiple ? selectionBox : null,
      event.shiftKey,
    );
    event.currentTarget.setPointerCapture(event.pointerId);
    if (plan.kind === "drag") {
      // Bare paper inside the group's box is part of the group: a drag from
      // there carries every piece, and the hand is kept until release.
      pressRef.current = {
        at,
        downAt: performance.now(),
        selectOnClick: plan.selectOnClick,
        moved: false,
      };
      setGesture({
        kind: "move",
        origins: piecesById(pieces, plan.dragIds),
        grabbedAt: at,
        copyOnDrag: event.altKey,
      });
      return;
    }
    setSelection(plan.base);
    pressRef.current = {
      at,
      downAt: performance.now(),
      selectOnClick: plan.base,
      moved: false,
    };
    setGesture({
      kind: "marquee",
      start: at,
      end: at,
      base: plan.base,
      additive: plan.additive,
    });
  };

  /**
   * Starts a drag from one of the grips around the selection: a corner or an
   * edge scales it, and the squares just past the corners turn it about its
   * middle. One piece and several work the same way.
   */
  const beginGrip = (zone: HandleZone, event: React.PointerEvent) => {
    event.stopPropagation();
    if (event.button !== 0 || !selectionBox) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const pressed = framePoint(event);
    const box = selectionBox;
    if (zone.kind === "rotate") {
      const grabAngle = angleAbout(boxCenter(box), pressed);
      if (multiple) {
        setGesture({
          kind: "groupRotate",
          bounds: box,
          before: selectedPieces,
          grabAngle,
          turned: 0,
        });
      } else {
        setGesture({ kind: "rotate", before: selectedPieces[0], grabAngle });
      }
      return;
    }
    const grip: ScaleGrip =
      zone.kind === "corner"
        ? { kind: "corner", corner: zone.corner }
        : { kind: "edge", edge: zone.edge };
    let toGrip: Point;
    if (grip.kind === "corner") {
      const actual = cornerPoint(box, box.rotation, grip.corner);
      toGrip = { x: actual.x - pressed.x, y: actual.y - pressed.y };
    } else {
      toGrip = edgeGrabOffset(box, box.rotation, grip.edge, pressed);
    }
    if (multiple) {
      setGesture({
        kind: "groupScale",
        grip,
        bounds: box,
        before: selectedPieces,
        toGrip,
      });
    } else {
      setGesture({ kind: "resize", grip, before: selectedPieces[0], toGrip });
    }
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
  const saveFile = (file: Blob, name: string) => {
    const url = URL.createObjectURL(file);
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
    const name = collageExportName(title);
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
        favicons: await resolveBackFavicons(collageProvenance(backContent.pieces)),
        thumbnails: await resolveBackThumbnails(backContent.pieces),
        look: backLook,
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

  const animates = useCollageAnimates(pieces);
  const videoSupport = videoExportSupport();

  /**
   * Exports the front as a looping video of its animated pieces. The encoder
   * loads only when asked for, so the studio stays light without it.
   */
  const downloadVideo = async () => {
    if (!videoSupport.ok) {
      setNotice({
        tone: "problem",
        text: `could not export mp4 — ${videoSupport.reason}`,
      });
      return;
    }
    setVideoProgress(0);
    setNotice(null);
    try {
      const { bakeCollageVideo } = await import("./collageVideo");
      const video = await bakeCollageVideo({
        frame,
        pieces,
        paper: paper.color,
        grain: paper.grain,
        onProgress: (done, total) => setVideoProgress(done / total),
      });
      saveFile(video, `${collageExportName(title)}.mp4`);
    } catch (error) {
      const text =
        error instanceof CollageBakeError
          ? `could not export mp4 — these could not be drawn: ${error.failures
              .map((failure) => failure.label)
              .join(", ")}`
          : `could not export mp4 — ${error instanceof Error ? error.message : String(error)}`;
      setNotice({ tone: "problem", text });
    } finally {
      setVideoProgress(null);
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

  /**
   * The area a marquee is sweeping. Its far corner only moves once the press
   * has become a drag, so a click on bare paper draws nothing.
   */
  const marqueeArea =
    gesture.kind === "marquee" &&
    (gesture.end.x !== gesture.start.x || gesture.end.y !== gesture.start.y)
      ? rectBetween(gesture.start, gesture.end)
      : null;

  return (
    <div className="collage-studio">
      <ScrapTray
        items={scraps}
        width={drawer.width}
        collapsed={drawer.collapsed}
        onWidth={(width) => updateDrawer({ width })}
        onCollapsed={(collapsed) => updateDrawer({ collapsed })}
        onPlace={(item) => {
          // Placing a scrap is an edit, so the collage turns face up for it.
          if (over) turnOver();
          releaseTypingFocus(document.activeElement);
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
        <div
          className="collage-frame-area__stage"
          ref={stageRef}
          style={{ padding: STAGE_PADDING, paddingTop: STAGE_TOP_BAND }}
          data-marquee-ground=""
          // Any press here, on a piece, a grip or bare paper, turns from a
          // text field to the collage, so undo reaches the collage.
          onPointerDownCapture={(event) =>
            releaseTypingFocus(
              document.activeElement,
              event.target as HTMLElement,
            )
          }
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={endGesture}
          onPointerCancel={() => endGesture()}
          onPointerLeave={() => setHoveredId(null)}
        >
          {/* The sheet holds both sides of the collage in one place and turns
              over about its vertical axis; only the side facing up is live. */}
          {/* The frame sits on a mat, and the mat carries the collage's name,
              count and date under it, so a screenshot of the mat says what it is. */}
          <div
            className="collage-mat"
            data-marquee-ground=""
            style={{
              width: frame.width * scale + MAT * 2,
              height: frame.height * scale + MAT + MAT_CAPTION,
            }}
          >
          <div
            className="collage-mat__window"
            data-marquee-ground=""
            style={{
              left: MAT,
              top: MAT,
              width: frame.width * scale,
              height: frame.height * scale,
            }}
          >
          <div
            className={`collage-sheet${over ? " collage-sheet--over" : ""}`}
            data-marquee-ground=""
            style={{
              width: frame.width,
              height: frame.height,
              transform: `scale(${scale})`,
            }}
          >
            <div className="collage-sheet__leaf" data-marquee-ground="">
              <div
                ref={frameRef}
                className={`collage-frame${dropActive ? " collage-frame--drop-target" : ""}`}
                inert={over}
                data-marquee-ground=""
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
                onContextMenu={(event) => {
                  // The browser's own menu never belongs over the collage.
                  event.preventDefault();
                  if (transform) {
                    cancelTransform();
                    return;
                  }
                  // A running tool owns the space, so the stack menu waits.
                  if (toolActive) return;
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
                  releaseTypingFocus(document.activeElement);
                  if (item) addPiece(item, framePoint(event));
                }}
              >
                {/* Only the pieces are cut off at the frame's edge. The selection,
                    its handles and the other overlays may hang past it, so a
                    piece mostly off the frame can still be grabbed and scaled. */}
                <div className="collage-frame__pieces" data-marquee-ground="">
                {ordered.map((piece) => {
                  const source = sourceBoxForCrop(piece, piece.crop);
                  const held = isSelected(selection, piece.id);
                  const hidden = crop?.pieceId === piece.id;
                  const offFrame =
                    piece.x + piece.width < 0 ||
                    piece.y + piece.height < 0 ||
                    piece.x > frame.width ||
                    piece.y > frame.height;
                  return (
                    <div
                      key={piece.id}
                      className={`collage-piece${held ? " collage-piece--selected" : ""}${
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
                        // A locked piece lets clicks through to what is beneath.
                        pointerEvents: piece.locked ? "none" : undefined,
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
                </div>

                {/* With several in hand, each one's own edge is traced lightly
                    so it is clear which pieces the box around them holds. */}
                {multiple &&
                  !transform &&
                  selectedPieces.map((piece) => (
                    <div
                      key={piece.id}
                      className="collage-piece-member"
                      aria-hidden="true"
                      style={{
                        left: piece.x,
                        top: piece.y,
                        width: piece.width,
                        height: piece.height,
                        transform: `rotate(${piece.rotation}deg)`,
                        borderWidth: 1.5 / scale,
                      }}
                    />
                  ))}

                {multiple && selectionBox && !crop && !transform && (
                  <PieceHandles
                    box={
                      gesture.kind === "groupRotate"
                        ? { ...gesture.bounds, rotation: gesture.turned }
                        : selectionBox
                    }
                    label="selection"
                    scale={scale}
                    inView={inView}
                    onGrip={beginGrip}
                  />
                )}

                {marqueeArea && (
                  <div
                    className="collage-marquee"
                    aria-hidden="true"
                    style={{
                      left: marqueeArea.x,
                      top: marqueeArea.y,
                      width: marqueeArea.width,
                      height: marqueeArea.height,
                      borderWidth: 1 / scale,
                    }}
                  />
                )}

                {selected && !crop && !transform && (
                  <PieceHandles
                    box={selected}
                    label="piece"
                    scale={scale}
                    inView={inView}
                    onGrip={beginGrip}
                  />
                )}

                {panel === "crop" && crop && cropping && (
                  <>
                    <CropSession
                      piece={cropping}
                      crop={crop.crop}
                      onChange={(next) => setCrop({ ...crop, crop: next })}
                      onCommit={commitCrop}
                      framePoint={framePoint}
                    />
                    <CropControl
                      piece={cropping}
                      crop={crop.crop}
                      scale={scale}
                      frame={frame}
                      onWhole={() => setCrop({ ...crop, crop: { ...FULL_CROP } })}
                      onDone={commitCrop}
                    />
                  </>
                )}

                {/* What a click would take, shown faintly so a piece under a pile
                    can be seen before it is reached for. */}
                {hovered &&
                  !isSelected(selection, hovered.id) &&
                  gesture.kind !== "marquee" &&
                  !(peek.held || sourcesOn) &&
                  !toolActive && (
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

                {(peek.held || sourcesOn) && !over && (
                  <ProvenancePeek
                    pieces={ordered}
                    hoveredId={hoveredId}
                    scale={scale}
                    bounds={{ x: 0, y: 0, width: frame.width, height: frame.height }}
                  />
                )}

                {panel === "piecesHere" && hereMenu && (
                  <PiecesHereMenu
                    pieces={hereStack}
                    at={hereMenu.at}
                    scale={scale}
                    selectedId={selection.primary}
                    onPick={(pieceId) => {
                      selectPiece(pieceId);
                      setHereMenu(null);
                    }}
                    onLock={(pieceId, locked) => {
                      // A piece locked here also leaves the hand, since the
                      // hand only ever holds pieces free to move.
                      editPiece(pieceId, (piece) => setPieceLocked(piece, locked));
                    }}
                    onClose={() => setHereMenu(null)}
                  />
                )}

                {readout && selectionBox && (
                  <p
                    className="collage-readout"
                    style={{
                      left: selectionBox.x + selectionBox.width / 2,
                      top: selectionBox.y,
                      // The slip stays upright and the same size on screen however
                      // the frame is zoomed or the piece is turned.
                      transform: `translate(-50%, calc(-100% - 12px)) scale(${1 / scale})`,
                    }}
                  >
                    {readout}
                  </p>
                )}

                {panel === "cutout" && selected?.cutout && (
                  <CutoutControl
                    piece={selected}
                    tolerance={selected.cutout.tolerance}
                    inverted={cutoutKeeps(selected.cutout) === "background"}
                    scale={scale}
                    frame={frame}
                    onTolerance={tuneCutout}
                    onInvert={invertCutout}
                    onKeepBackground={keepBackground}
                    onDone={confirmCutout}
                  />
                )}

                {/* The tools for whatever is in hand ride with the piece, and
                    stand aside while a gesture, a tool, or a peek is running. */}
                {panel === "pieceActions" && selectionBox && (
                  <PieceActions
                    box={selectionBox}
                    piece={selected}
                    canCutOut={selected?.scrap.kind === "image"}
                    scale={scale}
                    frame={frame}
                    onOrder={restackSelection}
                    onFlip={flipSelection}
                    onCrop={enterCrop}
                    onCutOut={beginCutout}
                    onLock={lockSelection}
                    onDuplicate={() => duplicatePieces(selectedPieces)}
                    onRemove={removeSelected}
                  />
                )}

                <div className="collage-frame__edge" data-marquee-ground="" />
              </div>

              <CollageBackFace
                frame={frame}
                paper={paper}
                content={backContent}
                look={backLook}
                front={bleed}
                showing={over}
                onProblem={onBackProblem}
                onTitle={setTitle}
              />
            </div>
          </div>
          </div>
            <div className="collage-mat__caption" style={{ left: MAT, right: MAT }}>
              {over ? (
                <span className="collage-studio__label">
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
                    {pieces.length} piece{pieces.length === 1 ? "" : "s"} · made{" "}
                    {madeOn(createdAtRef.current)}
                  </span>
                </>
              )}
            </div>
          </div>

          <StudioTools
            canUndo={!over && (canUndo(history) || cropPending)}
            canRedo={!over && canRedo(history)}
            onUndo={() => {
              finishRunning();
              setHistory((current) => undo(current));
            }}
            onRedo={() => {
              finishRunning();
              setHistory((current) => redo(current));
            }}
            onBack={leave}
          />

          <StudioViews
            turnedOver={over}
            sourcesOn={sourcesOn}
            canShowSources={!over && pieces.length > 0}
            onTurnOver={turnOver}
            onSources={() => setSourcesOn((value) => !value)}
            backShows={backShows}
            onBackShows={setBackShows}
          />

          {showKeys && <KeysPopover onClose={() => setShowKeys(false)} />}
        </div>

        {import.meta.env.DEV && over && (
          <BackLookTuner look={backLook} onLook={setBackLook} />
        )}

        <div className="collage-bar">
          <FormatControl
            format={format}
            paper={paper}
            zoom={scale}
            pieceCount={pieces.length}
            onFormat={setFormat}
            onPaper={setPaper}
          />
          <span className="collage-bar__spacer" />
          {editorSwitch && (
            <EditorSwitch
              choice={editorSwitch}
              handOver={() => {
                flush();
                return collageToHandOver({
                  draft: draftRef.current,
                  standing: autosave.standing,
                  opened: editing,
                  preview: autosave.preview,
                });
              }}
            />
          )}
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
          <KeysButton
            open={showKeys}
            onToggle={() => setShowKeys((value) => !value)}
          />
          <button
            type="button"
            className="collage-action"
            disabled={exporting || videoProgress !== null || pieces.length === 0}
            onClick={() => void download()}
          >
            export png
          </button>
          {animates && (
            <button
              type="button"
              className="collage-action"
              disabled={exporting || videoProgress !== null}
              title={videoSupport.ok ? undefined : videoSupport.reason}
              onClick={() => void downloadVideo()}
            >
              {videoProgress === null
                ? "export mp4"
                : // No wider than "export mp4" in the monospace face, so
                  // the bar does not reflow while the video encodes.
                  `mp4 · ${Math.round(videoProgress * 100)}%`}
            </button>
          )}
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
          ) : null}
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
  box,
  label,
  scale,
  inView,
  onGrip,
}: {
  /** The box the handles sit on: one piece, or the box around several. */
  box: PlacedBox;
  /** What the handles act on, for their accessible names. */
  label: "piece" | "selection";
  /** The frame's zoom, so the outline and grips keep one size on screen. */
  scale: number;
  /** The part of the stage in view, in frame units, once it is measured. */
  inView: Bounds | null;
  onGrip: (zone: HandleZone, event: React.PointerEvent) => void;
}) {
  const zones = handleZones(box, scale, inView);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          transform: `rotate(${box.rotation}deg)`,
          transformOrigin: "center",
          zIndex: 10_000,
          pointerEvents: "none",
        }}
      >
        {/* Drawn above every piece, so a selection buried in a pile still
            shows its whole edge. */}
        <div
          className="collage-selection-edge"
          aria-hidden="true"
          style={{ "--collage-zoom": scale } as React.CSSProperties}
        />
      </div>
      {/* The grips sit in frame space at a fixed size on screen: the edges
          and the squares just past the corners carry no mark of their own,
          only a cursor that says what a drag there does. */}
      {zones.map((zone) => {
        if (zone.kind === "corner") {
          return (
            <button
              key={`corner-${zone.corner}`}
              type="button"
              aria-label={`Resize ${label} from ${zone.corner.replace("-", " ")}`}
              data-grip={`corner-${zone.corner}`}
              className={`collage-handle${zone.pinned ? " collage-handle--pinned" : ""}`}
              style={{
                left: zone.center.x,
                top: zone.center.y,
                zIndex: 10_003,
                cursor: zone.cursor,
                transform: `scale(${1 / scale}) rotate(${zone.rotation}deg)`,
              }}
              onPointerDown={(event) => onGrip(zone, event)}
            />
          );
        }
        const key =
          zone.kind === "edge" ? `edge-${zone.edge}` : `rotate-${zone.corner}`;
        return (
          <div
            key={key}
            data-grip={key}
            aria-hidden="true"
            className="collage-grip"
            style={{
              left: zone.center.x,
              top: zone.center.y,
              width: zone.width,
              height: zone.height,
              zIndex: zone.kind === "edge" ? 10_002 : 10_001,
              cursor: zone.cursor,
              transform: `translate(-50%, -50%) scale(${1 / scale}) rotate(${zone.rotation}deg)`,
            }}
            onPointerDown={(event) => onGrip(zone, event)}
          />
        );
      })}
    </>
  );
}
