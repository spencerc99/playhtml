// ABOUTME: Renders the capabilities page demo for the built-in can-hover attribute.
// ABOUTME: Shows the shared hover attribute that readers use in their own CSS.
import React from "react";
import { CanHoverElement } from "@playhtml/react";

export function CanHoverDemo(): React.ReactElement {
  return (
    <CanHoverElement standalone>
      <div id="ph-cap-hover-pad" className="ph-can-hover-pad">
        <span className="ph-can-hover-pad__label">hover here</span>
        <span className="ph-can-hover-pad__state" aria-hidden="true">
          shared hover
        </span>
      </div>
    </CanHoverElement>
  );
}
