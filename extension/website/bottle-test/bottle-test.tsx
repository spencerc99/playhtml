// ABOUTME: Test page entry — renders 5 visual variants of MessageBottle side by side.
// ABOUTME: Each grid cell is an independent BottleField with its own pageKey.

import React from "react";
import { createRoot } from "react-dom/client";
import { BottleField } from "@extension/components/MessageBottle";

const SAMPLES = [
  "i was here in the early hours, the page was very quiet.",
  "if you're reading this, the wifi is back up.",
  "i don't remember why i opened this tab but i hope you're well.",
];

const PAGE_BG = "#ffffff";

const VARIANTS = [
  { id: "bottle-bottle", variant: "bottle" as const },
  { id: "bottle-tablet", variant: "tablet" as const },
  { id: "bottle-scroll", variant: "scroll" as const },
  { id: "bottle-floppy", variant: "floppy" as const },
  { id: "bottle-keytag", variant: "keytag" as const },
  { id: "bottle-vial", variant: "vial" as const },
  { id: "bottle-mirrored", variant: "mirrored" as const },
  { id: "bottle-tinytext", variant: "tinytext" as const },
  { id: "bottle-tinytextv", variant: "tinytextV" as const },
  { id: "bottle-ghosttext", variant: "ghosttext" as const },
  { id: "bottle-cipher", variant: "cipher" as const },
  { id: "bottle-rock", variant: "rock" as const },
];

for (const v of VARIANTS) {
  const el = document.getElementById(v.id);
  if (!el) continue;
  createRoot(el).render(
    <BottleField
      pageKey={`bottle-test/${v.variant}`}
      seed={SAMPLES}
      count={3}
      variant={v.variant}
      pageBg={PAGE_BG}
    />,
  );
}
