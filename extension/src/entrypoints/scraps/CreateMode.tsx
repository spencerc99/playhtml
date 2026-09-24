// ABOUTME: Renders saved collage history and the collage studio after Create is selected.
// ABOUTME: Loads create-only components and styles together as one scraps page boundary.

import React from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { CollageHistory } from "./CollageHistory";
import { CollageStudio } from "./CollageStudio";
import { COLLAGE_STUDIO_STYLES } from "./collageStudioStyles";
import type { CollageRecord } from "./collageRecord";

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
