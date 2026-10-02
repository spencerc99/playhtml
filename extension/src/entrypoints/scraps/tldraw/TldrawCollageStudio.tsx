// ABOUTME: The collage editor built on the tldraw SDK, chosen in settings in place of the regular one.
// ABOUTME: Edits the same collage records through the same autosave, so either editor can open any collage.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tldraw,
  useEditor,
  useValue,
  type Editor,
  type TLAssetStore,
  type TLCameraOptions,
  type TLComponents,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  type TLUiActionItem,
  type TLUiOverrides,
  type TldrawOptions,
} from "tldraw";
import "tldraw/tldraw.css";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";
import {
  collageProvenance,
  createCollageId,
  normalizeStack,
  type CollagePiece,
  type CollageRecord,
} from "../collageRecord";
import {
  DEFAULT_FORMAT,
  DEFAULT_PAPER,
  formatOf,
  type CollageFormat,
  type CollageFormatName,
  type CollagePaper,
} from "../collageFormats";
import { fanOutPlacement, type PieceBox, type Point } from "../collageGeometry";
import { DEFAULT_CUTOUT_TOLERANCE, type PieceCutout } from "../backgroundCutout";
import { paperBackground } from "../paperGrain";
import { ScrapTray } from "../ScrapTray";
import { KeysButton, StudioTools, StudioViews } from "../StudioTools";
import { FormatControl } from "../FormatControl";
import { PieceActions } from "../PieceActions";
import {
  EditorSwitch,
  collageToHandOver,
  type EditorSwitchChoice,
} from "../EditorSwitch";
import { CutoutControl } from "../CutoutControl";
import {
  defaultDrawerWidth,
  readDrawerPreference,
  writeDrawerPreference,
  type DrawerPreference,
} from "../drawerPreference";
import { CollageBakeError, bakeCollage } from "../bakeCollage";
import { bakeCollageBack, resolveBackFavicons } from "../bakeCollageBack";
import { BACK_LOOK, type CollageBackContent } from "../collageBack";
import { videoExportSupport } from "../imageAnimation";
import { useCollageAnimates } from "../useCollageAnimates";
import { saveCollage } from "../collageStore";
import { useCollageAutosave, type CollageDraft } from "../useCollageAutosave";
import type { SaveStanding } from "../autosaveSchedule";
import { ScrapPieceShapeUtil } from "./ScrapPieceShapeUtil";
import { TLDRAW_ASSET_URLS } from "./tldrawAssetUrls";
import { collageExportName } from "../collageFile";
import {
  SCRAP_PIECE_TYPE,
  imageAssetFor,
  pieceForDrawing,
  pieceToShape,
  piecesToShapes,
  placedPiece,
  shapesToPieces,
  type PieceShape,
  type PieceSources,
} from "./pieceShapes";

/** Stage padding around the frame, in screen pixels, as in the regular editor. */
const STAGE_PADDING = 12;
/** Room kept clear at the top of the stage for the tool row. */
const STAGE_TOP_BAND = 52;
/** How far a duplicate lands from its original, in frame units. */
const COPY_OFFSET = 24;
/** The teal the regular editor draws its selection in. */
const SELECTION_TEAL = "#4a9a8a";

const SHAPE_UTILS = [ScrapPieceShapeUtil];

const OPTIONS: Partial<TldrawOptions> = {
  createTextOnCanvasDoubleClick: false,
  maxPages: 1,
};

/** Scrap images display from their kept local copies, like everywhere else on the page. */
const ASSET_STORE: TLAssetStore = {
  upload: async () => {
    throw new Error("The collage editor places scraps from the drawer and never uploads files");
  },
  resolve: (asset) => {
    const src = asset.props.src;
    return src ? resolveScrapImageSrc(src) : null;
  },
};

/**
 * tldraw's actions kept here, with the keys the regular editor uses for
 * stacking: brackets move one step, shift + brackets go all the way.
 */
const KEPT_ACTIONS: Record<string, string | undefined> = {
  undo: undefined,
  redo: undefined,
  copy: undefined,
  cut: undefined,
  paste: undefined,
  delete: undefined,
  duplicate: undefined,
  "select-all": undefined,
  "select-none": undefined,
  "flip-horizontal": undefined,
  "flip-vertical": undefined,
  "bring-forward": "]",
  "send-backward": "[",
  "bring-to-front": "shift+]",
  "send-to-back": "shift+[",
};

function cameraOptionsFor(frame: CollageFormat): Partial<TLCameraOptions> {
  return {
    wheelBehavior: "none",
    // Min and max zoom are both the fitted zoom, so the frame never zooms.
    zoomSteps: [1],
    constraints: {
      bounds: { x: 0, y: 0, w: frame.width, h: frame.height },
      padding: { x: STAGE_PADDING, y: STAGE_TOP_BAND },
      origin: { x: 0.5, y: 0.5 },
      // tldraw's "fit-max" takes the smaller of the two axis fits, so the
      // whole frame shows, never above 100% like the regular editor.
      initialZoom: "fit-max-100",
      baseZoom: "fit-max-100",
      behavior: "fixed",
    },
  };
}

/** The paper, drawn under the camera so it sits exactly where the frame is. */
function paperComponent(frame: CollageFormat, paper: CollagePaper) {
  return function Paper() {
    const editor = useEditor();
    const camera = useValue("camera", () => editor.getCamera(), [editor]);
    return (
      <div
        className="collage-tldraw__paper"
        style={{
          width: frame.width,
          height: frame.height,
          transform: `scale(${camera.z}) translate(${camera.x}px, ${camera.y}px)`,
          ...paperBackground(paper.color, paper.grain, frame.width, frame.height),
        }}
      />
    );
  };
}

function isPieceShape(shape: TLShape): boolean {
  return shape.type === "image" || shape.type === SCRAP_PIECE_TYPE;
}

function pieceShapesOf(editor: Editor): PieceShape[] {
  return editor.getCurrentPageShapes().filter(isPieceShape) as unknown as PieceShape[];
}

function asShapeId(id: string): TLShapeId {
  return id as TLShapeId;
}

/** What the toolbar says about where the work stands, as the regular editor says it. */
function standingWords(standing: SaveStanding): { text: string; problem: boolean } {
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

/**
 * Swaps a shape for the one a changed piece draws as, keeping its id, place,
 * stacking and the piece it was made from. Cutting a picture's background
 * turns tldraw's image shape into our scrap shape and back.
 */
function replaceShape(editor: Editor, shape: PieceShape, next: CollagePiece): PieceShape {
  const drawn = pieceToShape(next, shape.index);
  const replacement = {
    ...drawn,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    meta: { ...drawn.meta, pieceId: shape.meta.pieceId },
  } as PieceShape;
  editor.run(() => {
    if (replacement.type === "image" && next.scrap.kind === "image") {
      const asset = imageAssetFor(next.scrap);
      if (!editor.getAsset(asset.id)) editor.createAssets([asset]);
    }
    if (replacement.type === shape.type) {
      editor.updateShape(replacement as unknown as TLShapePartial);
    } else {
      editor.deleteShapes([asShapeId(shape.id)]);
      editor.createShape(replacement as unknown as TLShapePartial);
    }
    editor.select(asShapeId(replacement.id));
  });
  return replacement;
}

interface TldrawCollageStudioProps {
  /** A license key already known to be in date. */
  licenseKey: string;
  scraps: readonly ScrapItem[];
  /** The collage being edited, or null when starting a fresh one. */
  editing: CollageRecord | null;
  onSaved: (record: CollageRecord) => void;
  onLeave: () => void;
  /** The choice of editor, offered to people with experiment access. */
  editorSwitch?: EditorSwitchChoice;
}

export default function TldrawCollageStudio({
  licenseKey,
  scraps,
  editing,
  onSaved,
  onLeave,
  editorSwitch,
}: TldrawCollageStudioProps) {
  const [format, setFormat] = useState<CollageFormatName>(editing?.format ?? DEFAULT_FORMAT);
  const [paper, setPaper] = useState<CollagePaper>(editing?.paper ?? DEFAULT_PAPER);
  const [title, setTitle] = useState(editing?.title ?? "");
  const frame = formatOf(format);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [drawer, setDrawer] = useState(() => readDrawerPreference());
  const [notice, setNotice] = useState<{ tone: "problem" | "quiet"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [cutoutSession, setCutoutSession] = useState<{
    shapeId: string;
    before: PieceCutout | undefined;
  } | null>(null);
  const draggingScrapRef = useRef<ScrapItem | null>(null);

  // Every piece handed to tldraw, so it comes back with nothing lost.
  const sourcesRef = useRef<PieceSources>(new Map());
  const recordOrderRef = useRef<string[]>(editing?.pieces.map((piece) => piece.id) ?? []);
  const collageIdRef = useRef(editing?.id ?? createCollageId());
  const createdAtRef = useRef(editing?.createdAt ?? Date.now());

  const updateDrawer = useCallback((change: Partial<DrawerPreference>) => {
    setDrawer((current) => {
      const next = { ...current, ...change };
      writeDrawerPreference(next);
      return next;
    });
  }, []);

  const piecesNow = useCallback(
    (from: Editor | null): CollagePiece[] =>
      from
        ? shapesToPieces(pieceShapesOf(from), sourcesRef.current, recordOrderRef.current)
        : (editing?.pieces ?? []),
    [editing],
  );

  const pieces = useValue("collage pieces", () => piecesNow(editor), [editor, piecesNow]);

  // The collage as it stands, read at the moment of a write. Whatever the
  // opened record carried that this editor does not show rides along as it was.
  const settingsRef = useRef({ title, format, paper });
  settingsRef.current = { title, format, paper };
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const draft = useCallback((): CollageDraft => {
    const { title: name, format: formatName, paper: sheet } = settingsRef.current;
    const size = formatOf(formatName);
    const current = piecesNow(editorRef.current);
    const { preview: _preview, ...carried } = editing ?? ({} as Partial<CollageRecord>);
    return {
      record: {
        ...carried,
        id: collageIdRef.current,
        title: name.trim(),
        createdAt: createdAtRef.current,
        updatedAt: Date.now(),
        frame: { width: size.width, height: size.height },
        format: formatName,
        paper: sheet,
        pieces: current,
      },
      hasContent: current.length > 0 || name.trim().length > 0,
    };
  }, [editing, piecesNow]);

  const autosave = useCollageAutosave({
    draft,
    bake: () => {
      const { record } = draft();
      return bakeCollage({
        frame: formatOf(record.format),
        pieces: record.pieces,
        paper: record.paper.color,
        grain: record.paper.grain,
      });
    },
    store: saveCollage,
    onStored: onSaved,
    startsStored: editing !== null,
    reopening: editing,
  });
  const { noteChange, flush } = autosave;

  // A title, paper or format change is an edit like any move.
  const firstSettingsRef = useRef(true);
  useEffect(() => {
    if (firstSettingsRef.current) {
      firstSettingsRef.current = false;
      return;
    }
    noteChange();
  }, [title, format, paper.color, paper.grain, noteChange]);

  // Every edit to the pieces feeds the same schedule.
  useEffect(() => {
    if (!editor) return;
    return editor.store.listen(() => noteChange(), { source: "user", scope: "document" });
  }, [editor, noteChange]);

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

  const cameraOptions = useMemo(() => cameraOptionsFor(frame), [frame]);
  const components = useMemo<TLComponents>(
    () => ({ Background: paperComponent(frame, paper) }),
    [frame, paper],
  );

  // A new format moves the locked frame, so the camera fits to it again.
  useEffect(() => {
    if (!editor) return;
    editor.setCameraOptions(cameraOptions);
    editor.setCamera(editor.getCamera(), { immediate: true });
  }, [editor, cameraOptions]);

  const selectedShapes = useValue(
    "selected pieces",
    () =>
      editor
        ? (editor.getSelectedShapes().filter(isPieceShape) as unknown as PieceShape[])
        : [],
    [editor],
  );
  const only = selectedShapes.length === 1 ? selectedShapes[0] : null;
  const selectedIds = selectedShapes.map((shape) => asShapeId(shape.id));

  // The cutout session belongs to one piece and ends when it is let go.
  useEffect(() => {
    if (cutoutSession && only?.id !== cutoutSession.shapeId) setCutoutSession(null);
  }, [cutoutSession, only?.id]);

  const addPiece = useCallback(
    (item: ScrapItem, at: Point) => {
      if (!editor) return;
      const piece = placedPiece(item, at);
      const shape = pieceToShape(piece, editor.getHighestIndexForParent(editor.getCurrentPageId()));
      sourcesRef.current.set(piece.id, { piece, written: shape });
      editor.markHistoryStoppingPoint("place scrap");
      editor.run(() => {
        if (item.kind === "image") {
          const asset = imageAssetFor(item);
          if (!editor.getAsset(asset.id)) editor.createAssets([asset]);
        }
        editor.createShape(shape as unknown as TLShapePartial);
        editor.select(asShapeId(shape.id));
      });
    },
    [editor],
  );

  const startCrop = useCallback(() => {
    if (!editor || !only) return;
    editor.select(asShapeId(only.id));
    editor.setCroppingShape(asShapeId(only.id));
    editor.setCurrentTool("select.crop.idle");
    // The strip's button had focus; the crop's keys belong to the editor.
    editor.focus();
  }, [editor, only]);

  /** Opens the edge control on the one selected picture, cutting it at the default edge first. */
  const beginCutout = useCallback(() => {
    if (!editor || !only || only.meta.scrap.kind !== "image") return;
    const piece = pieceForDrawing(only);
    setCutoutSession({ shapeId: only.id, before: piece.cutout });
    if (piece.cutout) return;
    editor.markHistoryStoppingPoint("cutout");
    replaceShape(editor, only, {
      ...piece,
      cutout: { method: "edge-color", tolerance: DEFAULT_CUTOUT_TOLERANCE },
    });
  }, [editor, only]);

  const tuneCutout = useCallback(
    (tolerance: number) => {
      if (!editor || !only || only.type !== SCRAP_PIECE_TYPE) return;
      editor.updateShape({
        id: asShapeId(only.id),
        type: SCRAP_PIECE_TYPE,
        props: { cutout: { method: "edge-color", tolerance } },
      } as TLShapePartial);
    },
    [editor, only],
  );

  const keepBackground = useCallback(() => {
    if (!editor || !only) return;
    const { cutout: _cut, ...uncut } = pieceForDrawing(only);
    editor.markHistoryStoppingPoint("keep background");
    replaceShape(editor, only, uncut);
    setCutoutSession(null);
  }, [editor, only]);

  const order = useCallback(
    (to: "forward" | "backward" | "front" | "back") => {
      if (!editor || selectedIds.length === 0) return;
      editor.markHistoryStoppingPoint("restack");
      if (to === "forward") editor.bringForward(selectedIds);
      else if (to === "backward") editor.sendBackward(selectedIds);
      else if (to === "front") editor.bringToFront(selectedIds);
      else editor.sendToBack(selectedIds);
      editor.focus();
    },
    [editor, selectedIds],
  );

  /**
   * Holds what is in hand in place as one undo step. A locked shape can be
   * neither selected nor moved in tldraw, so it also leaves the hand.
   */
  const lock = useCallback(() => {
    if (!editor || selectedIds.length === 0) return;
    editor.markHistoryStoppingPoint("lock");
    editor.run(
      () => {
        editor.selectNone();
        editor.updateShapes(
          selectedShapes.map((shape) => ({ id: asShapeId(shape.id), type: shape.type, isLocked: true })) as TLShapePartial[],
        );
      },
      { ignoreShapeLock: true },
    );
    editor.focus();
  }, [editor, selectedIds, selectedShapes]);

  /** Lets every locked piece go again, as one undo step. */
  const unlockAll = useCallback(() => {
    if (!editor) return;
    const locked = pieceShapesOf(editor).filter((shape) => shape.isLocked);
    if (locked.length === 0) return;
    editor.markHistoryStoppingPoint("unlock all");
    editor.run(
      () =>
        editor.updateShapes(
          locked.map((shape) => ({ id: asShapeId(shape.id), type: shape.type, isLocked: false })) as TLShapePartial[],
        ),
      { ignoreShapeLock: true },
    );
  }, [editor]);

  const duplicate = useCallback(() => {
    if (!editor || selectedIds.length === 0) return;
    editor.markHistoryStoppingPoint("duplicate");
    editor.duplicateShapes(selectedIds, { x: COPY_OFFSET, y: COPY_OFFSET });
    editor.focus();
  }, [editor, selectedIds]);

  const remove = useCallback(() => {
    if (!editor || selectedIds.length === 0) return;
    editor.markHistoryStoppingPoint("remove");
    editor.deleteShapes(selectedIds);
    editor.focus();
  }, [editor, selectedIds]);

  // The strip's single-letter keys, read through a ref so tldraw's action
  // list can stay put while the selection changes.
  const keysRef = useRef({ crop: startCrop, cutout: beginCutout });
  keysRef.current = { crop: startCrop, cutout: beginCutout };
  const overrides = useMemo<TLUiOverrides>(
    () => ({
      tools(_editor, tools) {
        return { select: tools.select };
      },
      actions(_editor, actions) {
        const kept = Object.fromEntries(
          Object.entries(actions)
            .filter(([id]) => id in KEPT_ACTIONS)
            .map(([id, action]) => [
              id,
              KEPT_ACTIONS[id] ? { ...action, kbd: KEPT_ACTIONS[id] } : action,
            ]),
        ) as Record<string, TLUiActionItem>;
        kept["collage-crop"] = {
          id: "collage-crop",
          label: "action.crop" as TLUiActionItem["label"],
          kbd: "c",
          onSelect: () => keysRef.current.crop(),
        };
        kept["collage-cutout"] = {
          id: "collage-cutout",
          label: "action.cutout" as TLUiActionItem["label"],
          kbd: "b",
          onSelect: () => keysRef.current.cutout(),
        };
        return kept;
      },
    }),
    [],
  );

  const onMount = useCallback(
    (mounted: Editor) => {
      // Pieces snap only while cmd/ctrl is held, tldraw's own default.
      mounted.user.updateUserPreferences({ isSnapMode: false });
      // The selection is drawn in the regular editor's teal.
      const theme = mounted.getCurrentTheme();
      mounted.updateTheme({
        ...theme,
        colors: {
          ...theme.colors,
          light: {
            ...theme.colors.light,
            selectionStroke: SELECTION_TEAL,
            selectionFill: "rgba(74, 154, 138, 0.14)",
            brushStroke: SELECTION_TEAL,
            brushFill: "rgba(74, 154, 138, 0.1)",
          },
        },
      });
      // Only scraps from the drawer become pieces; pasted text, links and
      // files are ignored rather than turned into tldraw's own shapes.
      for (const type of ["text", "url", "files", "svg-text", "embed", "excalidraw"] as const) {
        mounted.registerExternalContentHandler(type, () => {});
      }
      if (editing && editing.pieces.length > 0) {
        const { shapes, assets, sources } = piecesToShapes(editing.pieces);
        sourcesRef.current = sources;
        mounted.run(
          () => {
            mounted.createAssets(assets);
            mounted.createShapes(shapes as unknown as TLShapePartial[]);
          },
          { history: "ignore" },
        );
        mounted.clearHistory();
      }
      // Reachable from devtools in development builds, for looking into the
      // editor's own state.
      if (import.meta.env.MODE === "development") {
        (window as unknown as { collageEditor?: Editor }).collageEditor = mounted;
      }
      setEditor(mounted);
    },
    [editing],
  );

  const canUndo = useValue("can undo", () => editor?.getCanUndo() ?? false, [editor]);
  const canRedo = useValue("can redo", () => editor?.getCanRedo() ?? false, [editor]);
  const camera = useValue("camera", () => editor?.getCamera() ?? { x: 0, y: 0, z: 1 }, [editor]);
  /** Tools float over the selection only while it rests. */
  const resting = useValue(
    "selection at rest",
    () => (editor ? editor.isInAny("select.idle", "select.pointing_selection", "select.pointing_shape") : false),
    [editor],
  );
  /** The bounds of what is selected, for placing the strip beside it. */
  const selection = useValue(
    "selection frame",
    () => {
      if (!editor || editor.getSelectedShapeIds().length === 0) return null;
      const bounds = editor.getSelectionPageBounds();
      if (!bounds) return null;
      return {
        box: { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h } as PieceBox,
      };
    },
    [editor],
  );

  const animates = useCollageAnimates(pieces);
  const videoSupport = videoExportSupport();

  const backContent = useMemo<CollageBackContent>(
    () => ({
      title,
      createdAt: createdAtRef.current,
      changedAt: editing?.updatedAt ?? null,
      pieceCount: pieces.length,
      formatLabel: `${frame.label} · ${frame.width} × ${frame.height}`,
      sources: collageProvenance(normalizeStack(pieces)),
    }),
    [editing, frame, pieces, title],
  );

  const saveFile = (file: Blob, name: string) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const failure = (what: string, error: unknown) =>
    error instanceof CollageBakeError
      ? `could not export ${what} — these could not be drawn: ${error.failures
          .map((item) => item.label)
          .join(", ")}`
      : `could not export ${what} — ${error instanceof Error ? error.message : String(error)}`;

  /** Exports the front and the back as two pictures, as the regular editor does. */
  const download = async () => {
    if (pieces.length === 0) return;
    setExporting(true);
    setNotice(null);
    const name = collageExportName(title);
    try {
      const front = await bakeCollage({ frame, pieces, paper: paper.color, grain: paper.grain });
      const back = await bakeCollageBack({
        frame,
        paper,
        content: backContent,
        front,
        favicons: await resolveBackFavicons(backContent.sources),
        look: BACK_LOOK,
      });
      saveFile(front, `${name} front.png`);
      saveFile(back, `${name} back.png`);
    } catch (error) {
      setNotice({ tone: "problem", text: failure("png", error) });
    } finally {
      setExporting(false);
    }
  };

  const downloadVideo = async () => {
    if (!videoSupport.ok) {
      setNotice({ tone: "problem", text: `could not export mp4 — ${videoSupport.reason}` });
      return;
    }
    setVideoProgress(0);
    setNotice(null);
    try {
      const { bakeCollageVideo } = await import("../collageVideo");
      const video = await bakeCollageVideo({
        frame,
        pieces,
        paper: paper.color,
        grain: paper.grain,
        onProgress: (done, total) => setVideoProgress(done / total),
      });
      saveFile(video, `${collageExportName(title)}.mp4`);
    } catch (error) {
      setNotice({ tone: "problem", text: failure("mp4", error) });
    } finally {
      setVideoProgress(null);
    }
  };

  const leave = () => {
    flush();
    onLeave();
  };

  const standing = standingWords(autosave.standing);
  const onlyPiece = only ? pieceForDrawing(only) : null;
  const scale = camera.z;
  const lockedCount = pieces.filter((piece) => piece.locked).length;
  const cropping = useValue("cropping", () => editor?.isIn("select.crop") ?? false, [editor]);

  return (
    <div className="collage-studio collage-tldraw">
      <style>{`
        .collage-tldraw .tl-container {
          --tl-color-background: transparent;
          --tl-color-selected: ${SELECTION_TEAL};
          --tl-color-selection-stroke: ${SELECTION_TEAL};
          --tl-color-selection-fill: rgba(74, 154, 138, 0.14);
          background: transparent;
        }
        .collage-tldraw .tl-background__wrapper { overflow: hidden; }
        .collage-tldraw__paper {
          position: absolute;
          left: 0;
          top: 0;
          transform-origin: 0 0;
          box-shadow: 0 1px 2px rgba(61, 56, 51, 0.18), 0 8px 24px rgba(61, 56, 51, 0.12);
        }
        /* Pieces are cut off at the frame's edge; the selection is drawn in a
           separate layer and still hangs past it. */
        .collage-tldraw .tl-shapes {
          clip-path: polygon(0px 0px, ${frame.width}px 0px, ${frame.width}px ${frame.height}px, 0px ${frame.height}px);
        }
        .collage-tldraw__over {
          position: absolute;
          inset: 0;
          z-index: 10000;
          overflow: hidden;
          pointer-events: none;
        }
        .collage-tldraw__page {
          position: absolute;
          left: 0;
          top: 0;
          transform-origin: 0 0;
        }
        .collage-tldraw__page .collage-piece-actions,
        .collage-tldraw__page .collage-tolerance {
          pointer-events: auto;
        }
      `}</style>
      <ScrapTray
        items={scraps}
        width={drawer.width}
        collapsed={drawer.collapsed}
        slotSize={drawer.slotSize}
        onWidth={(width) => updateDrawer({ width })}
        onCollapsed={(collapsed) => updateDrawer({ collapsed })}
        onSlotSize={(slotSize) => updateDrawer({ slotSize, width: defaultDrawerWidth(slotSize) })}
        onPlace={(item) => addPiece(item, fanOutPlacement(pieces.length, frame))}
        onDragStart={(item, event) => {
          draggingScrapRef.current = item;
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", item.id);
        }}
      />

      <div className="collage-frame-area" style={{ flex: "1 1 auto" }}>
        <div
          className="collage-frame-area__stage"
          // A scrap dragged from the drawer is caught before tldraw's own drop
          // handling, which would otherwise read it as pasted text.
          onDragOverCapture={(event) => {
            if (!draggingScrapRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDropCapture={(event) => {
            const item = draggingScrapRef.current;
            draggingScrapRef.current = null;
            if (!item || !editor) return;
            event.preventDefault();
            event.stopPropagation();
            addPiece(item, editor.screenToPage({ x: event.clientX, y: event.clientY }));
          }}
        >
          <div style={{ position: "absolute", inset: 0 }}>
            <Tldraw
              licenseKey={licenseKey}
              assetUrls={TLDRAW_ASSET_URLS}
              assets={ASSET_STORE}
              shapeUtils={SHAPE_UTILS}
              components={components}
              overrides={overrides}
              options={OPTIONS}
              cameraOptions={cameraOptions}
              locale="en"
              hideUi
              autoFocus={false}
              onMount={onMount}
            />
          </div>

          {/* The regular editor's tools, laid over tldraw in frame units so
              they follow the camera. */}
          <div className="collage-tldraw__over">
            <div
              className="collage-tldraw__page"
              style={{
                transform: `scale(${scale}) translate(${camera.x}px, ${camera.y}px)`,
                width: frame.width,
                height: frame.height,
              }}
            >
              {selection && resting && !cutoutSession && (
                <PieceActions
                  box={onlyPiece ?? selection.box}
                  piece={onlyPiece}
                  canCutOut={onlyPiece?.scrap.kind === "image"}
                  scale={scale}
                  frame={frame}
                  onOrder={order}
                  onCrop={startCrop}
                  onLock={lock}
                  lockHint="unlock from the bar below"
                  onCutOut={beginCutout}
                  onDuplicate={duplicate}
                  onRemove={remove}
                />
              )}

              {cutoutSession && onlyPiece?.cutout && (
                <CutoutControl
                  piece={onlyPiece}
                  tolerance={onlyPiece.cutout.tolerance}
                  scale={scale}
                  frame={frame}
                  onTolerance={tuneCutout}
                  onKeepBackground={keepBackground}
                  onDone={() => {
                    setCutoutSession(null);
                    editor?.focus();
                  }}
                />
              )}
            </div>
          </div>

          <StudioTools
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => editor?.undo()}
            onRedo={() => editor?.redo()}
            onBack={leave}
          />

          <StudioViews
            turnedOver={false}
            sourcesOn={false}
            canShowSources={false}
            onTurnOver={() =>
              setNotice({
                tone: "quiet",
                text: "the back of a collage shows in the regular editor; turn the tldraw editor off in settings to see it",
              })
            }
            onSources={() => {}}
          />

          <FormatControl
            format={format}
            paper={paper}
            zoom={scale}
            pieceCount={pieces.length}
            onFormat={setFormat}
            onPaper={setPaper}
          />
        </div>

        <div className="collage-bar">
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
            {selectedShapes.length > 1 ? ` · ${selectedShapes.length} selected` : ""}
            {cropping ? " · cropping · enter or click away to keep, esc to cancel" : ""}
          </span>
          <span className="collage-bar__spacer" />
          <KeysButton
            open={false}
            onToggle={() =>
              setNotice({
                tone: "quiet",
                text: "keys: C crop · B cut out background · [ ] one step back or forward, shift for all the way · shift+H / shift+V flip · cmd+D duplicate · cmd held while dragging snaps",
              })
            }
          />
          {lockedCount > 0 && (
            <button
              type="button"
              className="collage-action"
              title="Locked pieces cannot be picked up here until they are let go"
              onClick={unlockAll}
            >
              unlock {lockedCount} locked
            </button>
          )}
          {editorSwitch && (
            <EditorSwitch
              choice={editorSwitch}
              handOver={() => {
                flush();
                return collageToHandOver({
                  draft: draft(),
                  standing: autosave.standing,
                  opened: editing,
                  preview: autosave.preview,
                });
              }}
            />
          )}
          {standing.text && (
            <p
              className={`collage-standing${standing.problem ? " collage-standing--problem" : ""}`}
              role="status"
            >
              {standing.text}
            </p>
          )}
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
              {videoProgress === null ? "export mp4" : `mp4 · ${Math.round(videoProgress * 100)}%`}
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
