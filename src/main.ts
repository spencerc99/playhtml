/// <reference lib="dom"/>
import YProvider from "y-partykit/provider";
import "./style.scss";
import { Position, TagType } from "./types";
import * as Y from "yjs";
import { MoveElement, SpinElement } from "./elements";

declare const PARTYKIT_HOST: string | undefined;

const partykitHost =
  typeof PARTYKIT_HOST === "undefined" ? "localhost:1999" : PARTYKIT_HOST;

const doc = new Y.Doc();
const provider = new YProvider(partykitHost, "yjs-demo", doc, {
  connect: false,
});
provider.connect();

function getIdForElement(ele: HTMLElement): string {
  // TODO: need to find a good way to robustly generate a uniqueID for an element
  // if ID is not provided, and it should degrade gracefully
  // return ele.id || btoa(ele.innerHTML);
  return ele.id;
}

export const TagData: Record<TagType, (eles: HTMLElement[]) => void> = {
  [TagType.CanMove]: (canMoveEles) => {
    const moveInfo: Y.Map<Position> = doc.getMap(TagType.CanMove);

    for (const canMoveEle of canMoveEles) {
      const elementId = getIdForElement(canMoveEle);
      const savedPosition = moveInfo.get(elementId) || { x: 0, y: 0 };
      // TODO: add new method for preventing updates while someone else is moving it?
      new MoveElement(canMoveEle, savedPosition, (newPosition) => {
        const existingPosition = moveInfo.get(elementId) || { x: 0, y: 0 };
        if (
          existingPosition.x === newPosition.x &&
          existingPosition.y === newPosition.y
        ) {
          return;
        }

        moveInfo.set(elementId, newPosition);
      });
    }
  },
  [TagType.CanSpin]: (spinEles) => {
    const spinInfo: Y.Map<number> = doc.getMap(TagType.CanSpin);
    console.log("spinInfo", JSON.stringify(spinInfo));

    for (const spinEle of spinEles) {
      const id = getIdForElement(spinEle);
      const savedRotation = spinInfo.get(id) || 0;
      // TODO: add new method for preventing updates while someone else is spinning it?
      new SpinElement(spinEle, savedRotation, (newRotation) => {
        if (spinInfo.get(id) === newRotation) {
          return;
        }

        spinInfo.set(id, newRotation);
      });
    }
  },
};

// TODO: provide some loading state for these elements immediately?
// some sort of "hydration" state?
provider.on("sync", (connected: boolean) => {
  if (!connected) {
    console.error("Issue connecting to yjs...");
  }

  for (const [tag, setup] of Object.entries(TagData)) {
    const tagElements = document.querySelectorAll(`[${tag}]`);
    tagElements.forEach((ele) => {
      ele.classList.add(`__open-websites-${tag}`);
    });
    setup(tagElements as any);
  }
});
