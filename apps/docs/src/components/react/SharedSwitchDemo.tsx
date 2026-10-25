// Docs live demo for a can-play switch: shared { on } data drives the class
// and label. Same look as InteractiveToggleDemo, built without can-toggle.
import React from "react";
import { withSharedState } from "@playhtml/react";

export const SharedSwitchDemo = withSharedState(
  { id: "ph-docs-switch", defaultData: { on: false } },
  ({ data, setData }) => (
    <button
      id="ph-docs-switch"
      type="button"
      className={`ph-toggle ${data.on ? "is-on" : "is-off"}`}
      aria-pressed={data.on}
      onClick={() => {
        setData((draft) => {
          draft.on = !draft.on;
        });
      }}
    >
      <span className="ph-toggle__dot" aria-hidden="true" />
      <span className="ph-toggle__label">{data.on ? "on" : "off"}</span>
    </button>
  ),
  { standalone: true },
);
