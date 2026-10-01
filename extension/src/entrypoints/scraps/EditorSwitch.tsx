// ABOUTME: The quiet "editor: studio · tldraw" chip in a collage editor's bar, for people with experiment access.
// ABOUTME: Switching writes pending work and hands the same collage to the other editor.

import React from "react";
import type { SaveStanding } from "./autosaveSchedule";
import type { CollageRecord } from "./collageRecord";
import type { CollageDraft } from "./useCollageAutosave";

export type CollageEditorName = "studio" | "tldraw";

/** What the editor that is open needs to offer the switch. */
export interface EditorSwitchChoice {
  current: CollageEditorName;
  /** Why tldraw cannot be picked in this build, or null when it can. */
  blocked: string | null;
  /** Opens this collage (or a fresh one, for null) in the other editor. */
  onSwitch: (to: CollageEditorName, collage: CollageRecord | null) => void;
}

/**
 * The collage as it stands, to open in the other editor. A collage opened
 * and left untouched goes across exactly as it was stored; otherwise it is
 * what the autosave is writing, with the last picture that drew.
 */
export function collageToHandOver(options: {
  draft: CollageDraft;
  standing: SaveStanding;
  opened: CollageRecord | null;
  preview: Blob | null;
}): CollageRecord | null {
  const { draft, standing, opened, preview } = options;
  if (opened && standing.kind === "untouched") return opened;
  if (!draft.hasContent && !opened) return null;
  return {
    ...draft.record,
    preview: preview
      ? { drawn: true, image: preview }
      : (opened?.preview ?? { drawn: false, reason: "not drawn yet" }),
  } as CollageRecord;
}

const EDITORS: { name: CollageEditorName; label: string }[] = [
  { name: "studio", label: "studio" },
  { name: "tldraw", label: "tldraw" },
];

export function EditorSwitch({
  choice,
  handOver,
}: {
  choice: EditorSwitchChoice;
  /** Writes pending work now and returns the collage to hand across. */
  handOver: () => CollageRecord | null;
}) {
  return (
    <div
      className="collage-editor-switch"
      role="group"
      aria-label="Editor"
      title={choice.blocked ?? undefined}
    >
      <span className="collage-studio__label">editor</span>
      {EDITORS.map(({ name, label }) => {
        const on = name === choice.current;
        const blocked = name === "tldraw" && choice.blocked !== null;
        return (
          <button
            key={name}
            type="button"
            className={`collage-chip${on ? " collage-chip--active" : ""}`}
            aria-pressed={on}
            disabled={blocked && !on}
            title={blocked ? (choice.blocked ?? undefined) : undefined}
            onClick={() => {
              if (on) return;
              choice.onSwitch(name, handOver());
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
