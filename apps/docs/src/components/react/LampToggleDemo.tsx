// Thin docs wrapper around the canonical SharedLamp example.
// Uses `standalone` because the docs site inits playhtml globally via
// HeadOverride.astro rather than wrapping React islands in <PlayProvider>.
import React from "react";
import { SharedLamp } from "../../../../../packages/react/examples/SharedLamp";

export function LampToggleDemo({
  id = "ph-docs-lamp-demo",
}: {
  id?: string;
}) {
  return (
    <SharedLamp
      id={id}
      standalone
      src="/docs/noguchi-hanging-lamp.png"
      className="ph-lamp__img"
    />
  );
}
