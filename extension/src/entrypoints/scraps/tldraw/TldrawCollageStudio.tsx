// ABOUTME: Dev-only prototype of the collage studio built on the tldraw SDK, to compare its feel with ours.
// ABOUTME: Reads saved collages but writes only to its own IndexedDB store, never to the real collages.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Tldraw,
  useEditor,
  useValue,
  getSnapshot,
  type Editor,
  type TLAssetStore,
  type TLCameraOptions,
  type TLComponents,
  type TLShape,
  type TLShapePartial,
  type TLUiOverrides,
  type TldrawOptions,
} from "tldraw";
import "tldraw/tldraw.css";
import { getAssetUrlsByImport } from "@tldraw/assets/imports.vite";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";
import type { CollageRecord } from "../collageRecord";
import {
  DEFAULT_FORMAT,
  DEFAULT_PAPER,
  formatOf,
  type CollageFormat,
  type CollagePaper,
} from "../collageFormats";
import { fanOutPlacement, type Point } from "../collageGeometry";
import { DEFAULT_CUTOUT_TOLERANCE } from "../backgroundCutout";
import { paperBackground } from "../paperGrain";
import { ScrapTray } from "../ScrapTray";
import { StudioTools } from "../StudioTools";
import {
  defaultDrawerWidth,
  readDrawerPreference,
  writeDrawerPreference,
  type DrawerPreference,
} from "../drawerPreference";
import { CollageBakeError, bakeCollage } from "../bakeCollage";
import { ScrapPieceShapeUtil } from "./ScrapPieceShapeUtil";
import {
  SCRAP_PIECE_TYPE,
  imageAssetFor,
  pieceToShape,
  piecesToRecords,
  placedPiece,
  shapeToPiece,
  shapesToPieces,
  type PieceShape,
} from "./pieceShapes";
import {
  NEW_DRAFT_ID,
  loadPrototypeDocument,
  savePrototypeDocument,
  type PrototypeDocument,
} from "./prototypeStore";

const LICENSE_KEY: string | undefined = import.meta.env.WXT_TLDRAW_LICENSE_KEY;
if (!LICENSE_KEY) {
  throw new Error(
    "WXT_TLDRAW_LICENSE_KEY is not set. Put the tldraw license key in extension/.env " +
      "(WXT_TLDRAW_LICENSE_KEY=...) before building with WXT_COLLAGE_ENGINE=tldraw.",
  );
}

/** Stage padding around the frame, in screen pixels, as in the hand-built studio. */
const STAGE_PADDING = 12;
/** Room kept clear at the top of the stage for the tool row. */
const STAGE_TOP_BAND = 52;
/** How long edits settle before the prototype writes them down. */
const SAVE_DELAY_MS = 500;

/** Fonts, icons and translations bundled with the extension, so nothing loads from a CDN. */
const ASSET_URLS = getAssetUrlsByImport();

const SHAPE_UTILS = [ScrapPieceShapeUtil];

const OPTIONS: Partial<TldrawOptions> = {
  createTextOnCanvasDoubleClick: false,
  maxPages: 1,
};

/** Scrap images display from their kept local copies, like everywhere else on the page. */
const ASSET_STORE: TLAssetStore = {
  upload: async () => {
    throw new Error("The collage studio places scraps from the drawer and never uploads files");
  },
  resolve: (asset) => {
    const src = asset.props.src;
    return src ? resolveScrapImageSrc(src) : null;
  },
};

/** The only tool is select; drawing, text and shape tools are left out. */
const KEPT_ACTIONS = new Set([
  "undo",
  "redo",
  "copy",
  "cut",
  "paste",
  "delete",
  "duplicate",
  "select-all",
  "select-none",
  "bring-forward",
  "bring-to-front",
  "send-backward",
  "send-to-back",
  "flip-horizontal",
  "flip-vertical",
  "rotate-cw",
  "rotate-ccw",
]);

const OVERRIDES: TLUiOverrides = {
  tools(_editor, tools) {
    return { select: tools.select };
  },
  actions(_editor, actions) {
    return Object.fromEntries(
      Object.entries(actions).filter(([id]) => KEPT_ACTIONS.has(id)),
    );
  },
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
      // whole frame shows, never above 100% like the hand-built studio.
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
  return editor
    .getCurrentPageShapes()
    .filter(isPieceShape) as unknown as PieceShape[];
}

type Standing =
  | { kind: "untouched" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; reason: string };

interface TldrawCollageStudioProps {
  scraps: readonly ScrapItem[];
  /** The collage opened from the list, read but never written. */
  editing: CollageRecord | null;
  onLeave: () => void;
}

export default function TldrawCollageStudio(props: TldrawCollageStudioProps) {
  const docId = props.editing?.id ?? NEW_DRAFT_ID;
  const [opened, setOpened] = useState<
    { doc: PrototypeDocument | null } | { error: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    loadPrototypeDocument(docId)
      .then((doc) => {
        if (!cancelled) setOpened({ doc });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOpened({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (!opened) {
    return <p className="collage-studio__label">opening the tldraw studio...</p>;
  }
  if ("error" in opened) {
    return (
      <p className="collage-notice" role="status">
        the tldraw studio could not open its saved work — {opened.error}
      </p>
    );
  }
  return <StudioSurface {...props} docId={docId} doc={opened.doc} />;
}

function StudioSurface({
  scraps,
  editing,
  onLeave,
  docId,
  doc,
}: TldrawCollageStudioProps & { docId: string; doc: PrototypeDocument | null }) {
  const format = doc?.format ?? editing?.format ?? DEFAULT_FORMAT;
  const paper = doc?.paper ?? editing?.paper ?? DEFAULT_PAPER;
  const frame = formatOf(format);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [drawer, setDrawer] = useState(() => readDrawerPreference());
  const [standing, setStanding] = useState<Standing>({ kind: "untouched" });
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const draggingScrapRef = useRef<ScrapItem | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveRef = useRef<() => void>(() => {});

  const updateDrawer = useCallback((change: Partial<DrawerPreference>) => {
    setDrawer((current) => {
      const next = { ...current, ...change };
      writeDrawerPreference(next);
      return next;
    });
  }, []);

  const cameraOptions = useMemo(() => cameraOptionsFor(frame), [frame]);
  const components = useMemo<TLComponents>(
    () => ({ Background: paperComponent(frame, paper) }),
    [frame, paper],
  );

  const save = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!editor) return;
    setStanding({ kind: "saving" });
    savePrototypeDocument({
      id: docId,
      format,
      paper,
      document: getSnapshot(editor.store).document,
      updatedAt: Date.now(),
    })
      .then(() => setStanding({ kind: "saved" }))
      .catch((error: unknown) =>
        setStanding({
          kind: "failed",
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
  }, [docId, editor, format, paper]);
  saveRef.current = save;

  // Every edit to the document schedules one write; a burst of edits during a
  // drag settles into a single write once it pauses.
  useEffect(() => {
    if (!editor) return;
    const stop = editor.store.listen(
      () => {
        if (saveTimerRef.current !== null) return;
        saveTimerRef.current = window.setTimeout(() => saveRef.current(), SAVE_DELAY_MS);
      },
      { source: "user", scope: "document" },
    );
    const flush = () => {
      if (saveTimerRef.current !== null) saveRef.current();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      stop();
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [editor]);

  const onMount = useCallback(
    (mounted: Editor) => {
      mounted.user.updateUserPreferences({ isSnapMode: true });
      // Only scraps from the drawer become pieces; pasted text, links and
      // files are ignored rather than turned into tldraw's own shapes.
      for (const type of ["text", "url", "files", "svg-text", "embed", "excalidraw"] as const) {
        mounted.registerExternalContentHandler(type, () => {});
      }
      if (!doc && editing && editing.pieces.length > 0) {
        const { shapes, assets } = piecesToRecords(editing.pieces);
        mounted.run(
          () => {
            mounted.createAssets(assets);
            mounted.createShapes(shapes as unknown as TLShapePartial[]);
          },
          { history: "ignore" },
        );
        mounted.clearHistory();
      }
      // Reachable from devtools, for poking at the prototype while comparing it.
      (window as unknown as { collageEditor?: Editor }).collageEditor = mounted;
      setEditor(mounted);
    },
    [doc, editing],
  );

  const addPiece = useCallback(
    (item: ScrapItem, at: Point) => {
      if (!editor) return;
      const piece = placedPiece(item, at);
      const index = editor.getHighestIndexForParent(editor.getCurrentPageId());
      const shape = pieceToShape(piece, index);
      editor.markHistoryStoppingPoint("place scrap");
      editor.run(() => {
        if (item.kind === "image") {
          const asset = imageAssetFor(item);
          if (!editor.getAsset(asset.id)) editor.createAssets([asset]);
        }
        editor.createShape(shape as unknown as TLShapePartial);
        editor.select(shape.id as TLShape["id"]);
      });
    },
    [editor],
  );

  const pieceCount = useValue(
    "piece count",
    () => (editor ? pieceShapesOf(editor).length : 0),
    [editor],
  );
  const canUndo = useValue("can undo", () => editor?.getCanUndo() ?? false, [editor]);
  const canRedo = useValue("can redo", () => editor?.getCanRedo() ?? false, [editor]);
  const selected = useValue(
    "selected pieces",
    () => (editor ? editor.getSelectedShapes().filter(isPieceShape) : []),
    [editor],
  );
  const only = selected.length === 1 ? (selected[0] as unknown as PieceShape) : null;

  /** Turns the one selected picture's cutout on or off, as one undoable step. */
  const toggleCutout = () => {
    if (!editor || !only) return;
    const piece = shapeToPiece(only, 0);
    if (piece.scrap.kind !== "image") return;
    const next = piece.cutout
      ? { ...piece, cutout: undefined }
      : { ...piece, cutout: { method: "edge-color" as const, tolerance: DEFAULT_CUTOUT_TOLERANCE } };
    const replacement = pieceToShape(next, only.index);
    editor.markHistoryStoppingPoint("cutout");
    editor.run(() => {
      editor.deleteShapes([only.id as TLShape["id"]]);
      if (replacement.type === "image" && piece.scrap.kind === "image") {
        const asset = imageAssetFor(piece.scrap);
        if (!editor.getAsset(asset.id)) editor.createAssets([asset]);
      }
      editor.createShape(replacement as unknown as TLShapePartial);
      editor.select(replacement.id as TLShape["id"]);
    });
  };

  const startCrop = () => {
    if (!editor || !only) return;
    editor.setCroppingShape(only.id as TLShape["id"]);
    editor.setCurrentTool("select.crop.idle");
  };

  const exportPng = async () => {
    if (!editor) return;
    const pieces = shapesToPieces(pieceShapesOf(editor));
    if (pieces.length === 0) return;
    setExporting(true);
    setNotice(null);
    try {
      const picture = await bakeCollage({
        frame,
        pieces,
        paper: paper.color,
        grain: paper.grain,
      });
      const url = URL.createObjectURL(picture);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${editing?.title.trim() || "collage"} (tldraw).png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(
        error instanceof CollageBakeError
          ? `could not export — these could not be drawn: ${error.failures
              .map((failure) => failure.label)
              .join(", ")}`
          : `could not export — ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setExporting(false);
    }
  };

  const clearAll = () => {
    if (!editor) return;
    editor.markHistoryStoppingPoint("clear");
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
  };

  const leave = () => {
    if (saveTimerRef.current !== null) saveRef.current();
    onLeave();
  };

  const standingText =
    standing.kind === "saving"
      ? "saving..."
      : standing.kind === "saved"
        ? "saved to the prototype store"
        : standing.kind === "failed"
          ? `not saved — ${standing.reason}`
          : "";

  return (
    <div className="collage-studio collage-tldraw">
      <style>{`
        .collage-tldraw .tl-container {
          --tl-color-background: transparent;
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
        /* Pieces are cut off at the frame's edge; selection handles live in a
           separate layer and still hang past it. */
        .collage-tldraw .tl-shapes {
          clip-path: polygon(0px 0px, ${frame.width}px 0px, ${frame.width}px ${frame.height}px, 0px ${frame.height}px);
        }
      `}</style>
      <ScrapTray
        items={scraps}
        width={drawer.width}
        collapsed={drawer.collapsed}
        slotSize={drawer.slotSize}
        onWidth={(width) => updateDrawer({ width })}
        onCollapsed={(collapsed) => updateDrawer({ collapsed })}
        onSlotSize={(slotSize) =>
          updateDrawer({ slotSize, width: defaultDrawerWidth(slotSize) })
        }
        onPlace={(item) => addPiece(item, fanOutPlacement(pieceCount, frame))}
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
              licenseKey={LICENSE_KEY}
              assetUrls={ASSET_URLS}
              assets={ASSET_STORE}
              shapeUtils={SHAPE_UTILS}
              components={components}
              overrides={OVERRIDES}
              options={OPTIONS}
              cameraOptions={cameraOptions}
              snapshot={doc?.document}
              hideUi
              autoFocus={false}
              onMount={onMount}
            />
          </div>
          <StudioTools
            canUndo={canUndo}
            canRedo={canRedo}
            keysOpen={false}
            turnedOver={false}
            onUndo={() => editor?.undo()}
            onRedo={() => editor?.redo()}
            onKeys={() =>
              setNotice(
                "tldraw keys: double-click a picture to crop · shift+H / shift+V flip · [ ] send to back / bring to front, alt+[ ] one step · cmd+D duplicate · shift while rotating snaps",
              )
            }
            onTurnOver={() =>
              setNotice("turning the collage over is not part of the tldraw prototype")
            }
            onBack={leave}
          />
        </div>

        <div className="collage-bar">
          <span className="collage-studio__label">tldraw prototype · saved apart from your collages</span>
          <span className="collage-bar__spacer" />
          <span className="collage-studio__label">
            {pieceCount} piece{pieceCount === 1 ? "" : "s"}
            {selected.length > 1 ? ` · ${selected.length} selected` : ""}
          </span>
          <span className="collage-bar__spacer" />
          {only && (
            <>
              <button type="button" className="collage-action" onClick={startCrop}>
                crop
              </button>
              {only.meta.scrap.kind === "image" && (
                <button type="button" className="collage-action" onClick={toggleCutout}>
                  {only.type === SCRAP_PIECE_TYPE ? "keep background" : "cut out background"}
                </button>
              )}
            </>
          )}
          {standingText && (
            <p
              className={`collage-standing${standing.kind === "failed" ? " collage-standing--problem" : ""}`}
              role="status"
            >
              {standingText}
            </p>
          )}
          <button
            type="button"
            className="collage-action"
            disabled={pieceCount === 0}
            onClick={clearAll}
          >
            clear
          </button>
          <button
            type="button"
            className="collage-action"
            disabled={exporting || pieceCount === 0}
            onClick={() => void exportPng()}
          >
            export png
          </button>
        </div>

        {notice && (
          <p className="collage-notice collage-notice--quiet" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
