// ABOUTME: Cycling milestone-toast preview for the setup page.
// ABOUTME: Rotates through all four milestone types to show what users can expect.

import React, { useEffect, useState } from "react";
import {
  MilestoneToast,
  type MilestoneToastData,
} from "./MilestoneToast";
import { MILESTONE_TOAST_CSS } from "../entrypoints/content/milestone-toast-styles";
import { MILESTONE_COPY } from "../milestones/copy";

const SAMPLES: MilestoneToastData[] = [
  {
    type: "cursorDistance",
    displayValue: "2.4 mi",
    copy: MILESTONE_COPY.cursorDistance[0],
    ctaLabel: "see your trail",
    ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
    period: "today",
  },
  {
    type: "screenTime",
    displayValue: "2h 14m",
    copy: MILESTONE_COPY.screenTime[0],
    ctaLabel: "see your day",
    ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
    period: "today",
    sparkline: [0.2, 0.4, 0.55, 0.75, 0.5, 0.9, 1.0],
  },
  {
    type: "sitesExplored",
    displayValue: "25",
    copy: MILESTONE_COPY.sitesExplored[0],
    ctaLabel: "see your portrait",
    ctaAction: "OPEN_PORTRAIT",
    period: "alltime",
  },
  {
    type: "domainVisits",
    displayValue: "10×",
    copy: MILESTONE_COPY.domainVisits[0],
    ctaLabel: "see your history there",
    ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
    period: "alltime",
    domain: "en.wikipedia.org",
    faviconUrl: "https://www.google.com/s2/favicons?domain=en.wikipedia.org&sz=64",
  },
];

const STYLE_ID = "wwo-milestone-toast-preview-styles";

// Inject styles synchronously at module load — before React renders — so the
// toast markup never flashes at its natural (unstyled) size on first paint.
if (
  typeof document !== "undefined" &&
  !document.getElementById(STYLE_ID)
) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = MILESTONE_TOAST_CSS;
  document.head.appendChild(style);
}

const CYCLE_MS = 3500;

export function MilestoneToastPreview() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % SAMPLES.length);
    }, CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="setup-step__milestone-preview">
      <MilestoneToast
        key={index}
        milestone={SAMPLES[index]}
        static={false}
      />
    </div>
  );
}
