// ABOUTME: The shared table where a small group collages their walk scraps together.
// ABOUTME: It is the scraps studio itself, editing the room's synced pieces instead of a saved collage.
import React, { useCallback, useMemo, useRef } from "react";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import { playhtml, usePlayerIdentity } from "@playhtml/react";
import { CollageStudio } from "@extension/entrypoints/scraps/CollageStudio";
import { COLLAGE_STYLES } from "@movement/components/ScrapCollage";
import { COLLAGE_STUDIO_STYLES } from "@extension/entrypoints/scraps/collageStudioStyles";
import type { CollagePiece } from "@extension/entrypoints/scraps/collageRecord";
import type {
  PiecesChange,
  SharedCollage,
} from "@extension/entrypoints/scraps/sharedCollage";
import { isAdmin } from "../admin";
import {
  orderAroundCentroid,
  piecesOf,
  safePieces,
  remoteDrafts,
  templatePointsFromCursors,
  type CollageData,
  type CollageLive,
  type DraftPatch,
  type Piece,
  type Placer,
} from "./pieces";
import { useSessionScraps } from "./sessionScraps";
import {
  TABLE_FRAME,
  piecePatch,
  studioPieces,
  tableChange,
  tablePiece,
  type PiecePatch,
} from "./studioBridge";
import "./collage.scss";

interface Props {
  data: CollageData;
  setData: (data: CollageData | ((draft: CollageData) => void)) => void;
  /** Everyone's in-progress edits, from the drag presence channel. */
  peers: Array<{ user: { isMe: boolean }; live: Partial<CollageLive> | undefined }>;
  setLive: (live: CollageLive) => void;
  /** Offer every scrap saved in this many recent ms, instead of only the
   * latest browsing session. */
  scrapsWindowMs?: number;
  /** What the empty table says, without and with the extension. */
  emptyHints?: { noExtension: string; withScraps: string };
}

/** Writes a piece field by field, so two people editing different parts of
 * one piece both keep their change, and a field the piece no longer has is
 * deleted rather than set to undefined. */
function writePiece(target: Piece, next: Piece) {
  const record = target as unknown as Record<string, unknown>;
  const values = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in values)) delete record[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (JSON.stringify(record[key]) !== JSON.stringify(value)) record[key] = value;
  }
}

/** Writes just the fields an edit set, and deletes the ones it took away. */
function applyPatch(target: Piece, patch: PiecePatch) {
  const record = target as unknown as Record<string, unknown>;
  for (const key of patch.unset) delete record[key];
  for (const [key, value] of Object.entries(patch.set)) record[key] = value;
}

export function CollageTable({
  data,
  setData,
  peers,
  setLive,
  scrapsWindowMs,
  emptyHints,
}: Props) {
  const { pid, name, color } = usePlayerIdentity();
  const admin = isAdmin(name, color);
  const stored = safePieces(piecesOf(data));
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const templatePoints = Object.values(data?.templatePoints ?? {});
  const scraps = useSessionScraps(scrapsWindowMs);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Other people's drags show as they happen, laid over what is stored.
  const drafts = remoteDrafts(peers, stored);
  const draftKey = JSON.stringify(drafts);
  const pieces = useMemo(
    () => studioPieces(safePieces({ ...stored, ...drafts })),
    // The stored map and the drafts are new objects every render; their
    // contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(stored), draftKey],
  );

  const placer = useCallback(
    (): Placer => ({ pid: pid || "someone", name: name || "someone", color: color || "#888888" }),
    [pid, name, color],
  );

  const onChange = useCallback(
    (change: PiecesChange) => {
      const now = Date.now();
      const { write, remove } = tableChange(change, storedRef.current, placer(), now);
      if (write.length === 0 && remove.length === 0) return;
      const edits = change.upserts.filter((studio) => studio.scrap.kind === "image");
      setData((draft) => {
        if (!draft.pieces) draft.pieces = {};
        write.forEach((piece, i) => {
          const target = draft.pieces[piece.id];
          if (!target) {
            draft.pieces[piece.id] = piece;
            return;
          }
          const before = change.before?.get(piece.id);
          if (!before) {
            writePiece(target, piece);
            return;
          }
          // Only what this edit changed, so someone else's edit to another
          // part of the same scrap survives.
          const existing = storedRef.current[piece.id] ?? piece;
          applyPatch(target, piecePatch(before, edits[i], existing, placer(), now));
        });
        for (const id of remove) delete draft.pieces[id];
      });
    },
    [placer, setData],
  );

  const lastDraftAt = useRef(0);
  const onDraft = useCallback(
    (draft: PiecesChange | null) => {
      if (draft === null) {
        setLive({ draft: null });
        return;
      }
      // Live previews ride presence; a few a second is enough to follow.
      const at = performance.now();
      if (at - lastDraftAt.current < 50) return;
      lastDraftAt.current = at;
      const now = Date.now();
      const stored = storedRef.current;
      const patches: DraftPatch[] = draft.upserts
        .filter((studio) => studio.scrap.kind === "image")
        .map((studio) => {
          const existing = stored[studio.id];
          const before = draft.before?.get(studio.id);
          if (!existing || !before) {
            return { id: studio.id, set: tablePiece(studio, existing, placer(), now) };
          }
          return { id: studio.id, ...piecePatch(before, studio, existing, placer(), now) };
        });
      setLive({ draft: patches });
    },
    [placer, setLive],
  );

  const removalRefusal = useCallback(
    (piece: CollagePiece) => {
      const owner = storedRef.current[piece.id];
      if (!owner || owner.placedByPid === pid) return null;
      return `only ${owner.placedByName || "whoever added it"} can remove this scrap`;
    },
    [pid],
  );

  const pieceOwner = useCallback((piece: CollagePiece) => {
    const owner = storedRef.current[piece.id];
    if (!owner?.placedByName) return null;
    return { name: owner.placedByName, color: owner.placedByColor || "#888888" };
  }, []);

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? null : current)), 3000);
  };

  // ---- Admin ------------------------------------------------------------

  const captureShape = () => {
    const frame = document.querySelector(".collage-table .collage-frame");
    const client = playhtml.cursorClient;
    if (!frame || !client) {
      flash("cursors are not connected yet");
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
                color: presence.playerIdentity?.playerStyle.colorPalette[0] ?? "#888888",
              },
            ]
          : [],
    );
    // The admin's own cursor is on this button, not in the shape.
    const points = templatePointsFromCursors(cursors, frame.getBoundingClientRect(), pid);
    if (Object.keys(points).length === 0) {
      flash("no cursors on the table to capture");
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

  // ---- Render -----------------------------------------------------------

  const outline = orderAroundCentroid(
    templatePoints,
    TABLE_FRAME.width / TABLE_FRAME.height,
  ).map((p) => ({ x: p.x * TABLE_FRAME.width, y: p.y * TABLE_FRAME.height }));

  const overlay = (
    <>
      {outline.length >= 2 && (
        <svg
          className="collage-template"
          width={TABLE_FRAME.width}
          height={TABLE_FRAME.height}
          aria-hidden="true"
        >
          {outline.length >= 3 ? (
            <polygon points={outline.map((p) => `${p.x},${p.y}`).join(" ")} />
          ) : (
            <line x1={outline[0].x} y1={outline[0].y} x2={outline[1].x} y2={outline[1].y} />
          )}
        </svg>
      )}
      {pieces.length === 0 && (
        <p className="collage-empty">
          {scraps === null
            ? (emptyHints?.noExtension ?? "scraps from the walk land here")
            : (emptyHints?.withScraps ??
              "pick scraps from your walk on the left to place them here")}
        </p>
      )}
    </>
  );

  const toolbar = (
    <>
      {notice && <span className="collage-studio__label">{notice}</span>}
      {admin && (
        <span className="collage-table-admin" data-admin-control>
          <button
            type="button"
            className="collage-action"
            onClick={captureShape}
            title="Snapshot everyone's cursors as a shape guide"
          >
            capture shape
          </button>
          {templatePoints.length > 0 && (
            <button type="button" className="collage-action" onClick={clearShape}>
              clear shape
            </button>
          )}
          <button type="button" className="collage-action" onClick={clearTable}>
            clear table
          </button>
        </span>
      )}
    </>
  );

  const shared: SharedCollage = {
    frame: TABLE_FRAME,
    pieces,
    onChange,
    onDraft,
    removalRefusal,
    pieceOwner,
    overlay,
    toolbar,
    caption: (
      <span className="collage-studio__label">
        {pieces.length} scrap{pieces.length === 1 ? "" : "s"} on the table · point at one or hold i to see who added
        each
      </span>
    ),
  };

  return (
    <div className="collage-table">
      <style>{COLLAGE_STYLES}</style>
      <style>{COLLAGE_STUDIO_STYLES}</style>
      <CollageStudio
        scraps={scraps ?? []}
        editing={null}
        onSaved={() => {}}
        onLeave={() => {}}
        shared={shared}
      />
    </div>
  );
}
