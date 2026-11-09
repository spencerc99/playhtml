// ABOUTME: Mounts the homepage's React pieces into their slots in the static page.
// ABOUTME: One PlayProvider drives them all through portals.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { RainSprinkler } from "../../../packages/react/examples/RainSprinkler";
import ExperimentsArchive from "../ExperimentsArchive";
import { ClickBox } from "./ClickBox";
import { MadeWithGallery } from "./MadeWithGallery";
import { VisitCounter } from "./VisitCounter";

function Slot({ id, children }: { id: string; children: ReactNode }) {
  const mount = document.getElementById(id);
  return mount ? createPortal(children, mount) : null;
}

export function HomeIslands() {
  return (
    <>
      <Slot id="home-visits-mount">
        <VisitCounter />
      </Slot>
      <Slot id="home-hydrant-mount">
        <RainSprinkler />
      </Slot>
      <Slot id="home-boxes-mount">
        <ClickBox id="orb-1" colorOffset={0} />
        <ClickBox id="orb-2" colorOffset={120} />
        <ClickBox id="orb-3" colorOffset={240} />
      </Slot>
      <Slot id="home-gallery-mount">
        <MadeWithGallery />
      </Slot>
      <Slot id="home-experiments-mount">
        <ExperimentsArchive variant="home" />
      </Slot>
    </>
  );
}
