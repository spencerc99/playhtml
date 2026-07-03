// Docs click-counter demo: one shared count that everyone increments.
// `standalone` because the docs site initializes playhtml globally from
// HeadOverride.astro rather than wrapping islands in <PlayProvider>.
import React from "react";
import { withSharedState } from "@playhtml/react";

export const DocsCounter = withSharedState(
  { defaultData: { count: 0 }, id: "ph-docs-counter" },
  ({ data, setData }) => (
    <button
      type="button"
      className="ph-counter"
      onClick={() =>
        setData((d) => {
          d.count += 1;
        })
      }
      aria-label="Increment the shared counter"
    >
      <span className="ph-counter__emoji" aria-hidden="true">
        ❤️
      </span>
      <span className="ph-counter__count">{data.count}</span>
    </button>
  ),
);
