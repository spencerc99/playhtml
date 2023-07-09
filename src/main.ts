/// <reference lib="dom"/>
import YProvider from "y-partykit/provider";
import "./style.scss";
import { Position, TagType } from "./types";
import * as Y from "yjs";
import { GrowElement, MoveElement, SpinElement } from "./elements";

declare const PARTYKIT_HOST: string | undefined;

const partykitHost =
  typeof PARTYKIT_HOST === "undefined" ? "localhost:1999" : PARTYKIT_HOST;

const doc = new Y.Doc();
// TODO: should the room include search?
// option 1: room = window.location.hostname + window.location.pathname
// option 2: room = window.location.href
// option 3: default to 1 and expose custom option to user.
const provider = new YProvider(partykitHost, window.location.href, doc, {
  connect: false,
});
provider.connect();

function getIdForElement(ele: HTMLElement): string {
  // TODO: need to find a good way to robustly generate a uniqueID for an element
  // if ID is not provided, and it should degrade gracefully
  // perhaps could allow people to do custom selectors instead of an ID and just select the first one?
  // return ele.id || btoa(ele.innerHTML);
  return ele.id;
}

export const TagData: Record<TagType, (eles: HTMLElement[]) => void> = {
  [TagType.CanMove]: (canMoveEles) => {
    const moveInfo: Y.Map<Position> = doc.getMap(TagType.CanMove);
    const moveElementHandlers = new Map<string, MoveElement>();

    function updateMoveInfo(elementId: string, newPosition: Position) {
      const existingPosition = moveInfo.get(elementId) || { x: 0, y: 0 };
      if (
        existingPosition.x === newPosition.x &&
        existingPosition.y === newPosition.y
      ) {
        return;
      }

      moveInfo.set(elementId, newPosition);
    }

    for (const canMoveEle of canMoveEles) {
      const elementId = getIdForElement(canMoveEle);
      const savedPosition = moveInfo.get(elementId);
      // TODO: add new method for preventing updates while someone else is moving it?
      moveElementHandlers.set(
        elementId,
        new MoveElement(canMoveEle, savedPosition, (newPosition) =>
          updateMoveInfo(elementId, newPosition)
        )
      );
    }

    moveInfo.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add") {
          moveElementHandlers.set(
            key,
            new MoveElement(canMoveEles[0], moveInfo.get(key)!, (newPosition) =>
              updateMoveInfo(key, newPosition)
            )
          );
        } else if (change.action === "update") {
          const moveElementHandler = moveElementHandlers.get(key)!;
          moveElementHandler.data = moveInfo.get(key)!;
        }
        // NOTE: not handling delete because it shouldn't ever happen here.
      });
    });
  },
  [TagType.CanSpin]: (spinEles) => {
    const spinInfo: Y.Map<number> = doc.getMap(TagType.CanSpin);
    const spinElementHandlers = new Map<string, SpinElement>();
    function updateSpinInfo(elementId: string, newRotation: number) {
      if (spinInfo.get(elementId) === newRotation) {
        return;
      }

      spinInfo.set(elementId, newRotation);
    }

    for (const spinEle of spinEles) {
      const elementId = getIdForElement(spinEle);
      const savedRotation = spinInfo.get(elementId) || 0;
      // TODO: add new method for preventing updates while someone else is spinning it?
      spinElementHandlers.set(
        elementId,
        new SpinElement(spinEle, savedRotation, (newRotation) =>
          updateSpinInfo(elementId, newRotation)
        )
      );
    }

    spinInfo.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add") {
          spinElementHandlers.set(
            key,
            new SpinElement(spinEles[0], spinInfo.get(key)!, (newPosition) =>
              updateSpinInfo(key, newPosition)
            )
          );
        } else if (change.action === "update") {
          const spinElementHandler = spinElementHandlers.get(key)!;
          spinElementHandler.data = spinInfo.get(key)!;
        }
        // NOTE: not handling delete because it shouldn't ever happen here.
      });
    });
  },
  [TagType.CanGrow]: (growEles) => {
    const growInfo: Y.Map<number> = doc.getMap(TagType.CanGrow);
    const growElementHandlers = new Map<string, GrowElement>();
    function updateGrowInfo(elementId: string, newScale: number) {
      if (growInfo.get(elementId) === newScale) {
        return;
      }

      growInfo.set(elementId, newScale);
    }

    for (const growEle of growEles) {
      const elementId = getIdForElement(growEle);
      const savedScale = growInfo.get(elementId);
      // TODO: add new method for preventing updates while someone else is spinning it?
      growElementHandlers.set(
        elementId,
        new GrowElement(growEle, savedScale, (newRotation) =>
          updateGrowInfo(elementId, newRotation)
        )
      );
    }

    growInfo.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add") {
          growElementHandlers.set(
            key,
            new GrowElement(growEles[0], growInfo.get(key)!, (newPosition) =>
              updateGrowInfo(key, newPosition)
            )
          );
        } else if (change.action === "update") {
          const growElementHandler = growElementHandlers.get(key)!;
          growElementHandler.data = growInfo.get(key)!;
        }
        // NOTE: not handling delete because it shouldn't ever happen here.
      });
    });
  },
};

// TODO: provide some loading state for these elements immediately?
// some sort of "hydration" state?
provider.on("sync", (connected: boolean) => {
  if (!connected) {
    console.error("Issue connecting to yjs...");
  }

  setupElements();
});

function isHTMLElement(ele: any): ele is HTMLElement {
  return ele instanceof HTMLElement;
}

/**
 * Sets up any playhtml elements that are currently on the page.
 * Can be repeatedly called to set up new elements without affecting existing ones.
 */
export function setupElements(): void {
  // TODO: need to expose some function to set up new elements that are added after the fact (like when elements are hydrated).
  for (const [tag, setup] of Object.entries(TagData)) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);
    setup(tagElements);

    // Set up the common classes for affected elements.
    tagElements.forEach((ele) => {
      ele.classList.add(`__playhtml-element`);
      ele.classList.add(`__playhtml-${tag}`);
    });
  }
}
