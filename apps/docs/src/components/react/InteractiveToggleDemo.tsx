// Docs live demo for can-toggle: one on/off switch shared by every reader.
// `standalone` is needed because the docs site initializes playhtml from
// HeadOverride.astro instead of wrapping islands in <PlayProvider>.
import React from "react";
import { CanToggleElement } from "@playhtml/react";

export function InteractiveToggleDemo() {
  return (
    <CanToggleElement standalone>
      {({ data }) => {
        // Older rooms stored a bare boolean instead of { on }.
        const on = typeof data === "object" ? data.on : Boolean(data);
        return (
          <button
            id="ph-docs-toggle-demo"
            type="button"
            className={`ph-toggle ${on ? "is-on" : "is-off"}`}
            aria-pressed={on}
          >
            <span className="ph-toggle__dot" aria-hidden="true" />
            <span className="ph-toggle__label">{on ? "on" : "off"}</span>
          </button>
        );
      }}
    </CanToggleElement>
  );
}
