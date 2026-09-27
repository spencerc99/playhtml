// ABOUTME: Renders saved collage history and the collage studio after Create is selected.
// ABOUTME: Loads create-only components and styles together as one scraps page boundary.

import React, { useState } from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { CollageHistory } from "./CollageHistory";
import { CollageStudio } from "./CollageStudio";
import { COLLAGE_STUDIO_STYLES } from "./collageStudioStyles";
import type { CollageRecord } from "./collageRecord";
import { useSettledFeatureState } from "../../features/useFeatureAccess";
import { setFeatureOverride } from "../../features/featureAccess";
import type { EditorSwitchChoice } from "./EditorSwitch";
import { BUILD_LICENSE_KEY, licenseStatus } from "./tldraw/tldrawLicense";

/**
 * The tldraw editor, in its own chunk so it is only fetched for people who
 * have turned it on in settings.
 */
const TldrawCollageStudio = React.lazy(() =>
  import("./tldraw/TldrawCollageStudio").catch((error: unknown) => {
    console.error("[collage studio] the tldraw editor failed to load:", error);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      default: () => (
        <p className="collage-notice" role="status">
          the tldraw editor could not load — {reason}
        </p>
      ),
    };
  }),
);

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
  const tldrawChoice = useSettledFeatureState("TLDRAW_COLLAGES");
  const license = licenseStatus(BUILD_LICENSE_KEY);
  /** The editor picked from the bar this visit, ahead of the stored choice catching up. */
  const [picked, setPicked] = useState<boolean | null>(null);
  const wantsTldraw = picked ?? tldrawChoice?.enabled === true;
  const useTldraw = wantsTldraw && license.usable;
  // Someone who chose the tldraw editor hears why they got the regular one;
  // a build without a key at all just never offers it.
  const fallbackNotice =
    wantsTldraw && !license.usable && license.reason !== "missing"
      ? license.message
      : null;

  // Only people with access to the experiment see the choice at all.
  const editorSwitch: EditorSwitchChoice | undefined = tldrawChoice?.available
    ? {
        current: useTldraw ? "tldraw" : "studio",
        blocked: license.usable ? null : license.message,
        onSwitch: (to, collage) => {
          const toTldraw = to === "tldraw";
          setPicked(toTldraw);
          setFeatureOverride("TLDRAW_COLLAGES", toTldraw).catch((error: unknown) =>
            console.error("[collage studio] could not remember the editor choice:", error),
          );
          // The same collage reopens, now in the other editor.
          if (collage) onEdit(collage);
          else onStartNew();
        },
      }
    : undefined;

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
        ) : tldrawChoice === null ? (
          // Which editor to open is not known until the setting is read, and
          // opening one only to swap it for the other would reset the work.
          <p className="collage-studio__label">opening the collage editor...</p>
        ) : useTldraw && license.usable ? (
          <React.Suspense
            fallback={<p className="collage-studio__label">opening the collage editor...</p>}
          >
            <TldrawCollageStudio
              key={studioSession}
              licenseKey={license.key}
              scraps={items}
              editing={editing}
              onSaved={onSaved}
              onLeave={onLeave}
              editorSwitch={editorSwitch}
            />
          </React.Suspense>
        ) : (
          <>
            <CollageStudio
              key={studioSession}
              scraps={items}
              editing={editing}
              onSaved={onSaved}
              onLeave={onLeave}
              editorSwitch={editorSwitch}
            />
            {fallbackNotice && (
              <p className="collage-notice collage-notice--quiet collage-engine-notice" role="status">
                {fallbackNotice}
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
