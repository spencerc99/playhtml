/// <reference lib="dom"/>
import YPartyKitProvider from "y-partykit/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import "./style.scss";
import { TagType } from "./types";
import * as Y from "yjs";
import { TagTypeToElement, ElementData, ElementHandler } from "./elements";

const partykitHost =
  process.env.NODE_ENV === "development"
    ? "localhost:1999"
    : "playhtml.spencerc99.partykit.dev";

const doc = new Y.Doc();
// TODO: should the room include search?
// option 1: room = window.location.hostname + window.location.pathname
// option 2: room = window.location.href
// option 3: default to 1 and expose custom option to user.
const room = window.location.href;
const yprovider = new YPartyKitProvider(partykitHost, room, doc, {
  connect: false,
});
// @ts-ignore
const _indexedDBProvider = new IndexeddbPersistence(room, doc);
yprovider.connect();

export const globalData = doc.getMap<Y.Map<any>>("playhtml-global");

function getIdForElement(ele: HTMLElement): string {
  // TODO: need to find a good way to robustly generate a uniqueID for an element
  // if ID is not provided, and it should degrade gracefully
  // perhaps could allow people to do custom selectors instead of an ID and just select the first one?
  // return ele.id || btoa(ele.innerHTML);
  return ele.id;
}

function getElementFromId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// TODO: provide some loading state for these elements immediately?
// some sort of "hydration" state?
yprovider.on("sync", (connected: boolean) => {
  if (!connected) {
    console.error("Issue connecting to yjs...");
  }

  setupElements();
});

function isHTMLElement(ele: any): ele is HTMLElement {
  return ele instanceof HTMLElement;
}

function registerPlayElement(element: HTMLElement, tag: TagType) {
  const commonTagInfo = TagTypeToElement[tag];
  type tagType = (typeof commonTagInfo)["defaultData"];
  const tagData: Y.Map<tagType> = globalData.get(tag)!;

  const elementId = getIdForElement(element);
  const elementData: ElementData = {
    ...commonTagInfo,
    data: tagData.get(elementId) || commonTagInfo.defaultData,
    element,
    onChange: (newData) => {
      if (tagData.get(elementId) === newData) {
        return;
      }

      tagData.set(elementId, newData);
    },
  };

  return new ElementHandler(elementData);
}

/**
 * Sets up any playhtml elements that are currently on the page.
 * Can be repeatedly called to set up new elements without affecting existing ones.
 */
export function setupElements(): void {
  // TODO: need to expose some function to set up new elements that are added after the fact (like when elements are hydrated).

  const elementHandlers = new Map<string, ElementHandler>();
  console.log("EXISTING DATA", globalData.toJSON());

  for (const tag of Object.values(TagType)) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);
    if (!tagElements.length) {
      continue;
    }

    // TODO: need way to override this from the element itself?
    // how does the generic `CanPlay` work here? Does it just look at the existing event handlers?
    const commonTagInfo = TagTypeToElement[tag];
    console.log(commonTagInfo);
    if (!commonTagInfo) {
      continue;
    }
    console.log(`initializing ${tag}`);
    type tagType = (typeof commonTagInfo)["defaultData"];
    if (!globalData.get(tag)) {
      globalData.set(tag, new Y.Map<tagType>());
    }

    const tagData: Y.Map<tagType> = globalData.get(tag)!;
    for (const element of tagElements) {
      const elementHandler = registerPlayElement(element, tag);
      elementHandlers.set(getIdForElement(element), elementHandler);
      // Set up the common classes for affected elements.
      element.classList.add(`__playhtml-element`);
      element.classList.add(`__playhtml-${tag}`);
    }

    tagData.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add") {
          // TODO: use custom selector here
          const element = getElementFromId(key)!;
          if (!isHTMLElement(element)) {
            console.log(`Element ${key} not an HTML element. Ignoring.`);
            return;
          }
          const registeredElement = registerPlayElement(
            element,
            tag as TagType
          );
          elementHandlers.set(getIdForElement(element), registeredElement);
        } else if (change.action === "update") {
          const elementHandler = elementHandlers.get(key)!;
          elementHandler.__data = tagData.get(key)!;
        } else if (change.action === "delete") {
          elementHandlers.delete(key);
        } else {
          console.log(`Unhandled action: ${change.action}`);
        }
      });
    });
  }

  globalData.observe((event) => {
    event.changes.keys.forEach((change, key) => {
      if (change.action === "add") {
        globalData.set(key, globalData.get(key)!);
        // TODO: need to re-initialize the above handlers here too...?
      }
    });
  });
}

// TODO: eventually need a way to import this that keeps library small and only imports the requested tags.
