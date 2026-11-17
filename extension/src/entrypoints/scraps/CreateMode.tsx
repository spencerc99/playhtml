// ABOUTME: Renders saved collage history and the collage studio after Create is selected.
// ABOUTME: Loads create-only components and styles together as one scraps page boundary.

import React from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { CollageHistory } from "./CollageHistory";
import { CollageStudio } from "./CollageStudio";
import { COLLAGE_STUDIO_STYLES } from "./collageStudioStyles";
import type { CollageRecord } from "./collageRecord";
import { useSettledFeatureState } from "../../features/useFeatureAccess";
import { extensionSigner } from "./extensionSigner";

interface CreateModeProps {
  items: ScrapItem[];
  editing: CollageRecord | null;
  studioOpen: boolean;
  studioSession: number;
  savedRevision: number;
  onEdit: (record: CollageRecord) => void;
  onStartNew: () => void;
  /** Why a collage could not be reopened, shown over the list. */
  notice?: string | null;
  onClosed?: (stored: Promise<void>) => void;
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
  notice = null,
  onClosed,
}: CreateModeProps) {
  const shareLinks = useSettledFeatureState("COLLAGE_SHARE_LINKS");

  return (
    <>
      <style>{COLLAGE_STUDIO_STYLES}</style>
      <div
        className={`collage-create-area${studioOpen ? " collage-create-area--studio" : ""}`}
      >
        {!studioOpen ? (
          <CollageHistory
            revision={savedRevision}
            onEdit={onEdit}
            onStartNew={onStartNew}
            notice={notice}
          />
        ) : (
          <CollageStudio
            key={studioSession}
            scraps={items}
            editing={editing}
            onSaved={onSaved}
            onLeave={onLeave}
            onClosed={onClosed}
            canPublish={shareLinks?.enabled === true}
            signer={extensionSigner}
          />
        )}
      </div>
    </>
  );
}
