// ABOUTME: A shared click counter box for the homepage toy box.
// ABOUTME: Reuses the old orb ids and {clicks} data so earlier clicks carry over.

import { withSharedState } from "@playhtml/react";
import { formatLargeNumber } from "../../../packages/react/examples/utils";

interface ClickBoxProps {
  id: string;
  colorOffset?: number;
}

export const ClickBox = withSharedState(
  { defaultData: { clicks: 0 } },
  ({ data, setData }, { id, colorOffset = 0 }: ClickBoxProps) => {
    const clicks = Number.isFinite(data.clicks) ? data.clicks : 0;
    const hue = (clicks * 20 + colorOffset) % 360;
    const lightness = 50 + (clicks % 20);
    const formatted = formatLargeNumber(clicks);

    return (
      <button
        type="button"
        id={id}
        className="ph-box"
        title={`Total clicks: ${clicks.toLocaleString()}`}
        aria-label={`${clicks.toLocaleString()} clicks. Click to add one.`}
        style={{
          background: `hsl(${hue}, 70%, ${lightness}%)`,
          color: lightness > 60 ? "#1c1c1c" : "#fff",
        }}
        onClick={() => {
          setData((draft) => {
            draft.clicks =
              (Number.isFinite(draft.clicks) ? draft.clicks : 0) + 1;
          });
        }}
      >
        {typeof formatted === "object" ? (
          <>
            <span className="ph-box__main">{formatted.main}</span>
            <span className="ph-box__suffix">{formatted.suffix}</span>
          </>
        ) : (
          <span className="ph-box__main">{formatted}</span>
        )}
      </button>
    );
  },
);
