// ABOUTME: A quiet popover listing the studio's keyboard shortcuts.
// ABOUTME: Sits above the toolbar in the page's own paper-and-mono language.

import React from "react";
import { STUDIO_SHORTCUTS } from "./studioKeymap";

export function KeysPopover({ onClose }: { onClose: () => void }) {
  return (
    <div className="collage-keys" role="dialog" aria-label="Keyboard shortcuts">
      <div className="collage-keys__head">
        <span className="collage-studio__label">keys</span>
        <button
          type="button"
          className="collage-keys__close"
          aria-label="Close the shortcut list"
          onClick={onClose}
        >
          &#215;
        </button>
      </div>
      {STUDIO_SHORTCUTS.map((group) => (
        <div key={group.group} className="collage-keys__group">
          <p className="collage-keys__group-name">{group.group}</p>
          {group.entries.map((entry) => (
            <p key={entry.keys} className="collage-keys__row">
              <span className="collage-keys__combo">{entry.keys}</span>
              <span className="collage-keys__what">{entry.what}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
