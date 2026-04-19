// Docs on/off toggle button. Uses the canonical CanToggleElement pattern
// (same shape as packages/react/examples/SharedLamp.tsx). `standalone` is
// required because the docs site initializes playhtml globally from
// HeadOverride.astro rather than wrapping islands in <PlayProvider>.
import React from "react";
import { CanToggleElement } from "@playhtml/react";

export function InteractiveToggleDemo({
  id = "ph-docs-toggle-demo",
}: {
  id?: string;
}) {
  return (
    <CanToggleElement standalone>
      {({ data }) => {
        const on = typeof data === "object" ? data.on : !!data;
        return (
          <button
            id={id}
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
