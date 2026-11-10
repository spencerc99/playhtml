// ABOUTME: Shows the homepage's shared total-visits counter as flip-style digits.
// ABOUTME: Keeps the original "viewCount" element id and {count} data so saved visits carry over.

import { useContext, useEffect } from "react";
import { PlayContext, withSharedState } from "@playhtml/react";

const MinimumDigits = 6;

export const VisitCounter = withSharedState(
  { defaultData: { count: 0 }, id: "viewCount" },
  ({ data, setData }) => {
    const { hasSynced } = useContext(PlayContext);

    // Counts this visit once the room has synced. It depends only on
    // hasSynced, never on the count, so it writes once per page load.
    useEffect(() => {
      if (!hasSynced) return;

      setData((draft) => {
        draft.count = (Number.isFinite(draft.count) ? draft.count : 0) + 1;
      });
    }, [hasSynced]);

    const count = Number.isFinite(data.count) ? data.count : 0;
    const digits = String(count).padStart(MinimumDigits, "0").split("");

    return (
      <span
        id="viewCount"
        className="ph-visits__digits"
        role="img"
        aria-label={`${count.toLocaleString()} total visits`}
      >
        {digits.map((digit, index) => (
          <span key={index}>{digit}</span>
        ))}
      </span>
    );
  },
);
