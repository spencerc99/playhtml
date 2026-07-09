// ABOUTME: Renders the capabilities page demo for the built-in can-hover attribute.
// ABOUTME: Shows the shared hover attribute that readers use in their own CSS.
import React from "react";
import { CanHoverElement } from "@playhtml/react";

export function CanHoverDemo(): React.ReactElement {
  return (
    <CanHoverElement standalone>
      <div id="ph-cap-hover-pad" className="ph-can-hover-pad">
        <p className="ph-can-hover-pad__label">
          Hover here with a friend - the pad lights up for everyone.
        </p>
      </div>
    </CanHoverElement>
  );
}
