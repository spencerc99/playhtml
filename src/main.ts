/// <reference lib="dom"/>
/// <reference types="vite/client" />
import YPartyKitProvider from "y-partykit/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import "./style.scss";
import { TagType } from "./types";
import * as Y from "yjs";
import {
  TagTypeToElement,
  ElementData,
  ElementHandler,
  ElementInitializer,
} from "./elements";

// TODO: there's a typescript error here but it all seems to work...
// @ts-ignore
const partykitHost = import.meta.env.DEV
  ? "localhost:1999"
  : "playhtml.spencerc99.partykit.dev";

const doc = new Y.Doc();
// TODO: should the room include search?
// option 1: room = window.location.hostname + window.location.pathname
// option 2: room = window.location.href
// option 3: default to 1 and expose custom option to user.
const room = window.location.href;
const yprovider = new YPartyKitProvider(partykitHost, room, doc);
// @ts-ignore
const _indexedDBProvider = new IndexeddbPersistence(room, doc);

export const globalData = doc.getMap<Y.Map<any>>("playhtml-global");

function getIdForElement(ele: HTMLElement): string | undefined {
  // TODO: need to find a good way to robustly generate a uniqueID for an element
  // if ID is not provided, and it should degrade gracefully
  // perhaps could allow people to do custom selectors instead of an ID and just select the first one?
  // return ele.id || btoa(ele.innerHTML);
  return ele.id;
}

export function getElementFromId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function getElementAwareness(tagType: TagType, elementId: string) {
  const awareness = yprovider.awareness.getLocalState();
  const elementAwareness = awareness?.[tagType] || {};
  return elementAwareness[elementId];
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

function registerPlayElement<T extends TagType>(
  element: HTMLElement,
  tag: T,
  tagInfo: ElementInitializer<T>,
  elementId: string
): ElementHandler<T> {
  type tagType = (typeof tagInfo)["defaultData"];
  const tagData: Y.Map<tagType> = globalData.get(tag)!;

  const elementData: ElementData = {
    ...tagInfo,
    data: tagData.get(elementId) || tagInfo.defaultData,
    awareness:
      getElementAwareness(tag, elementId) ||
      tagInfo.myDefaultAwareness !== undefined
        ? [tagInfo.myDefaultAwareness]
        : undefined,
    element,
    onChange: (newData) => {
      if (tagData.get(elementId) === newData) {
        return;
      }

      tagData.set(elementId, newData);
    },
    onAwarenessChange: (elementAwarenessData) => {
      const localAwareness = yprovider.awareness.getLocalState()?.[tag] || {};

      if (localAwareness[elementId] === elementAwarenessData) {
        return;
      }

      localAwareness[elementId] = elementAwarenessData;
      yprovider.awareness.setLocalStateField(tag, localAwareness);
    },
    triggerAwarenessUpdate: () => {
      onChangeAwareness();
    },
  };

  return new ElementHandler(elementData);
}

function isCorrectElementInitializer(
  tagInfo: ElementInitializer
): tagInfo is ElementInitializer {
  return (
    tagInfo.defaultData !== undefined && tagInfo.updateElement !== undefined
  );
}

function getElementInitializerInfoForElement(
  tag: TagType,
  element: HTMLElement
) {
  if (tag === TagType.CanPlay) {
    const customElement = element as any;
    const elementInitializerInfo: Required<ElementInitializer> = {
      defaultData: customElement.defaultData,
      defaultLocalData: customElement.defaultLocalData,
      myDefaultAwareness: customElement.myDefaultAwareness,
      updateElement: customElement.updateElement,
      updateElementAwareness: customElement.updateElementAwareness,
      onDrag: customElement.onDrag,
      onDragStart: customElement.onDragStart,
      onClick: customElement.onClick,
      additionalSetup: customElement.additionalSetup,
      resetShortcut: customElement.resetShortcut,
      debounceMs: customElement.debounceMs,
    };
    return elementInitializerInfo;
  }

  return TagTypeToElement[tag];
}

export const elementHandlers = new Map<string, Map<string, ElementHandler>>();

function onChangeAwareness() {
  // map of tagType -> elementId -> clientId -> awarenessData
  const awarenessStates = new Map<string, Map<string, any>>();

  function setClientElementAwareness(
    tag: string,
    elementId: string,
    clientId: number,
    awarenessData: any
  ) {
    if (!awarenessStates.has(tag)) {
      awarenessStates.set(tag, new Map<string, any>());
    }
    const tagAwarenessStates = awarenessStates.get(tag)!;
    if (!tagAwarenessStates.has(elementId)) {
      tagAwarenessStates.set(elementId, new Map<string, any>());
    }
    const elementAwarenessStates = tagAwarenessStates.get(elementId);
    elementAwarenessStates.set(clientId, awarenessData);
  }

  yprovider.awareness.getStates().forEach((state, clientId) => {
    // TODO: for each tag, update the awareness data?
    // probably need another function to just update render based on awareness data change
    // elementHandlers

    for (const [tag, tagData] of Object.entries(state)) {
      const tagElementHandlers = elementHandlers.get(tag as TagType);
      if (!tagElementHandlers) {
        continue;
      }
      for (const [elementId, _elementHandler] of tagElementHandlers) {
        if (!(elementId in tagData)) {
          continue;
        }
        const elementAwarenessData = tagData[elementId];
        setClientElementAwareness(
          tag,
          elementId,
          clientId,
          elementAwarenessData
        );
      }
    }

    for (const [tag, tagAwarenessStates] of awarenessStates) {
      const tagElementHandlers = elementHandlers.get(tag as TagType);
      if (!tagElementHandlers) {
        continue;
      }
      for (const [elementId, elementHandler] of tagElementHandlers) {
        const elementAwarenessStates = tagAwarenessStates
          .get(elementId)
          ?.values();
        if (!elementAwarenessStates) {
          continue;
        }
        let presentAwarenessStates = Array.from(elementAwarenessStates);
        elementHandler.__awareness = presentAwarenessStates;
      }
    }
  });
}

/**
 * Sets up any playhtml elements that are currently on the page.
 * Can be repeatedly called to set up new elements without affecting existing ones.
 */
export function setupElements(): void {
  // TODO: need to expose some function to set up new elements that are added after the fact (like when elements are hydrated).

  console.log(
    `࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂
࿂࿂࿂࿂ INITIALIZING playhtml ࿂࿂࿂࿂
࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂`,
    globalData.toJSON()
  );

  for (const tag of Object.values(TagType)) {
    const tagElementHandlers = new Map<string, ElementHandler>();
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);
    if (!tagElements.length) {
      continue;
    }

    let tagCommonElementInitializerInfo =
      tag !== TagType.CanPlay ? TagTypeToElement[tag] : undefined;

    elementHandlers.set(tag, tagElementHandlers);
    // console.log(`initializing ${tag}`);
    type tagType =
      typeof tagCommonElementInitializerInfo extends ElementInitializer
        ? (typeof tagCommonElementInitializerInfo)["defaultData"]
        : any;
    if (!globalData.get(tag)) {
      globalData.set(tag, new Y.Map<tagType>());
    }

    const tagData: Y.Map<tagType> = globalData.get(tag)!;
    for (const element of tagElements) {
      const elementId = getIdForElement(element);

      if (!elementId) {
        console.error(
          `Element ${element} does not have an acceptable ID. Please add an ID to the element to register it as a playhtml element.`
        );
        continue;
      }

      if (tagElementHandlers.has(elementId)) {
        continue;
      }

      const elementInitializerInfo = getElementInitializerInfoForElement(
        tag,
        element
      );
      if (!isCorrectElementInitializer(elementInitializerInfo)) {
        console.error(
          `Element ${elementId} does not have proper info to initial a playhtml element. Please refer to https://github.com/spencerc99/playhtml#can-play for troubleshooting help.`
        );
        continue;
      }

      const elementHandler = registerPlayElement(
        element,
        tag,
        elementInitializerInfo,
        elementId
      );
      tagElementHandlers.set(elementId, elementHandler);
      // redo this now that we have set it in the mapping.
      // TODO: this is inefficient, it tries to do this in the constructor but fails, should clean up the API
      elementHandler.triggerAwarenessUpdate?.();
      // Set up the common classes for affected elements.
      element.classList.add(`__playhtml-element`);
      element.classList.add(`__playhtml-${tag}`);
      // @ts-ignore
      element.style = `--jiggle-delay: ${Math.random() * 1}s;}`;
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
          if (tagElementHandlers.has(key)) {
            console.log(`Element ${key} already registered. Ignoring.`);
            return;
          }
          const elementInitializerInfo = getElementInitializerInfoForElement(
            tag,
            element
          );
          const registeredElement = registerPlayElement(
            element,
            tag as TagType,
            elementInitializerInfo,
            key
          );
          tagElementHandlers.set(key, registeredElement);
        } else if (change.action === "update") {
          const elementHandler = tagElementHandlers.get(key)!;
          elementHandler.__data = tagData.get(key)!;
        } else if (change.action === "delete") {
          tagElementHandlers.delete(key);
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

  yprovider.awareness.on("change", () => onChangeAwareness());
}

// TODO: eventually need a way to import this that keeps library small and only imports the requested tags.

// Expose big variables to the window object for debugging purposes.
// @ts-ignore
window.globalData = globalData;
