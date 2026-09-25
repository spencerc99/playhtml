// ABOUTME: Renders saved collage history and the collage studio after Create is selected.
// ABOUTME: Loads create-only components and styles together as one scraps page boundary.

import React from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { CollageHistory } from "./CollageHistory";
import { CollageStudio } from "./CollageStudio";
import { COLLAGE_STUDIO_STYLES } from "./collageStudioStyles";
import type { CollageRecord } from "./collageRecord";

/**
 * A dev build made with WXT_COLLAGE_ENGINE=tldraw swaps in the tldraw studio
 * prototype. Every other build leaves the import out entirely, so tldraw is
 * never bundled into it.
 */
const TldrawCollageStudio =
  import.meta.env.WXT_COLLAGE_ENGINE === "tldraw"
    ? React.lazy(() =>
        import("./tldraw/TldrawCollageStudio").catch((error: unknown) => {
          console.error("[collage studio] the tldraw studio failed to load:", error);
          const reason = error instanceof Error ? error.message : String(error);
          return {
            default: () => (
              <p className="collage-notice" role="status">
                the tldraw studio could not load — {reason}
              </p>
            ),
          };
        }),
      )
    : null;

interface CreateModeProps {
  items: ScrapItem[];
  editing: CollageRecord | null;
  studioOpen: boolean;
  studioSession: number;
  savedRevision: number;
  onEdit: (record: CollageRecord) => void;
  onStartNew: () => void;
  onSaved: (record: CollageRecord) => void;
  onLeave: () => void;
}

export function CreateMode({
  items,
  editing,
  studioOpen,
  studioSession,
  savedRevision,
  onEdit,
  onStartNew,
  onSaved,
  onLeave,
}: CreateModeProps) {
  return (
    <>
      <style>{COLLAGE_STUDIO_STYLES}</style>
      <div style={{ position: "absolute", inset: "96px 0 0", zIndex: 2 }}>
        {!studioOpen ? (
          <CollageHistory
            revision={savedRevision}
            onEdit={onEdit}
            onStartNew={onStartNew}
          />
        ) : TldrawCollageStudio ? (
          <React.Suspense
            fallback={<p className="collage-studio__label">opening the tldraw studio...</p>}
          >
            <TldrawCollageStudio
              key={studioSession}
              scraps={items}
              editing={editing}
              onLeave={onLeave}
            />
          </React.Suspense>
        ) : (
          <CollageStudio
            key={studioSession}
            scraps={items}
            editing={editing}
            onSaved={onSaved}
            onLeave={onLeave}
          />
        )}
      </div>
    </>
  );
}
