/// <reference lib="dom"/>
/// <reference types="vite/client" />
import YPartyKitProvider from "y-partykit/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import "./style.scss";
import {
  ElementData,
  ElementInitializer,
  TagType,
  getIdForElement,
  TagTypeToElement,
} from "../../common/src/index";
import * as Y from "yjs";
import { ElementHandler } from "./elements";
import { hashElement } from "./utils";

const DefaultPartykitHost = "playhtml.spencerc99.partykit.dev";

const doc = new Y.Doc();
function getDefaultRoom(): string {
  return window.location.pathname + window.location.search;
}
let yprovider: YPartyKitProvider;
let globalData: Y.Map<any>;
let elementHandlers: Map<string, Map<string, ElementHandler>>;
const selectorIdsToAvailableIdx = new Map<string, number>();

export interface InitOptions {
  // The room to connect users to (this should be a string that matches the other users
  // that you want a given user to connect with).
  //
  // All rooms are automatically prefixed with their host (`window.location.hostname`) to prevent conflicting with other people's sites.
  // Defaults to `window.location.pathname + window.location.search. You can customize this by passing in your own room dynamically
  room?: string;

  // Provide your own partykit host if you'd like to run your own server and customize the logic.
  host?: string;

  // Optionally provide your own map of capabilities
  extraCapabilities?: Record<string, ElementInitializer>;
}

let capabilitiesToInitializer: Record<TagType | string, ElementInitializer> =
  TagTypeToElement;

function getTagTypes(): (TagType | string)[] {
  return [TagType.CanPlay, ...Object.keys(capabilitiesToInitializer)];
}

let hasSynced = false;
let firstSetup = true;
function initPlayHTML({
  // TODO: if it is a localhost url, need to make some deterministic way to connect to the same room.
  room: inputRoom = getDefaultRoom(),
  host = DefaultPartykitHost,
  extraCapabilities,
}: InitOptions = {}) {
  if (!firstSetup) {
    console.error("playhtml already set up!");
    return;
  }

  // TODO: change to md5 hash if room ID length becomes problem / if some other analytic for telling who is connecting
  const room = encodeURIComponent(window.location.hostname + "-" + inputRoom);

  // TODO: there's a typescript error here but it all seems to work...
  // @ts-ignore
  const partykitHost = import.meta.env.DEV ? "localhost:1999" : host;

  console.log(
    `࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂
࿂࿂࿂࿂  ࿂    ࿂    ࿂    ࿂    ࿂  ࿂࿂࿂࿂
࿂࿂࿂࿂ booting up playhtml... ࿂࿂࿂࿂
࿂࿂࿂࿂  https://playhtml.fun  ࿂࿂࿂࿂
࿂࿂࿂࿂   ࿂     ࿂     ࿂     ࿂   ࿂࿂࿂࿂
࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂`
  );
  yprovider = new YPartyKitProvider(partykitHost, room, doc);
  globalData = doc.getMap<Y.Map<any>>("playhtml-global");
  elementHandlers = new Map<string, Map<string, ElementHandler>>();
  // @ts-ignore
  const _indexedDBProvider = new IndexeddbPersistence(room, doc);
  playhtml.globalData = globalData;
  playhtml.elementHandlers = elementHandlers;

  if (extraCapabilities) {
    for (const [tag, tagInfo] of Object.entries(extraCapabilities)) {
      capabilitiesToInitializer[tag] = tagInfo;
    }
  }

  // Import default styles
  const playStyles = document.createElement("link");
  playStyles.rel = "stylesheet";
  playStyles.href = "https://unpkg.com/playhtml@latest/dist/style.css";
  document.head.appendChild(playStyles);

  // TODO: provide some loading state for these elements immediately?
  // some sort of "hydration" state?
  yprovider.on("sync", (connected: boolean) => {
    if (!connected) {
      console.error("Issue connecting to yjs...");
    }
    hasSynced = true;
    console.log("[PLAYHTML]: Setting up elements... Time to have some fun 🛝");
    setupElements();
  });

  return yprovider;
}

function getElementAwareness(tagType: TagType, elementId: string) {
  const awareness = yprovider.awareness.getLocalState();
  const elementAwareness = awareness?.[tagType] ?? {};
  return elementAwareness[elementId];
}

function isHTMLElement(ele: any): ele is HTMLElement {
  return ele instanceof HTMLElement;
}

function deepEquals(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (a instanceof Object && b instanceof Object) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }

    for (const key of aKeys) {
      if (!deepEquals(a[key], b[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function createPlayElementData<T extends TagType>(
  element: HTMLElement,
  tag: T,
  tagInfo: ElementInitializer<T>,
  elementId: string
): ElementData<T> {
  type tagType = (typeof tagInfo)["defaultData"];
  const tagData: Y.Map<tagType> = globalData.get(tag)!;

  // console.log(
  //   "registering element",
  //   elementId,
  //   tagData.get(elementId) ?? tagInfo.defaultData,
  //   tagData.get(elementId),
  //   tagInfo.defaultData
  // );

  const elementData: ElementData = {
    ...tagInfo,
    // TODO: when adding save-state if no save state, then just use defaultData
    data:
      tagData.get(elementId) ??
      (tagInfo.defaultData instanceof Function
        ? tagInfo.defaultData(element)
        : tagInfo.defaultData),
    awareness:
      getElementAwareness(tag, elementId) ??
      tagInfo.myDefaultAwareness !== undefined
        ? [tagInfo.myDefaultAwareness]
        : undefined,
    element,
    onChange: (newData) => {
      if (deepEquals(tagData.get(elementId), newData)) {
        // if (tagData.get(elementId) === newData) {
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

  return elementData;
}

function isCorrectElementInitializer(
  tagInfo: ElementInitializer
): tagInfo is ElementInitializer {
  return (
    tagInfo.defaultData !== undefined &&
    (typeof tagInfo.defaultData === "object" ||
      typeof tagInfo.defaultData === "function") &&
    tagInfo.updateElement !== undefined
  );
}

function getElementInitializerInfoForElement(
  tag: TagType | string,
  element: HTMLElement
) {
  if (tag === TagType.CanPlay) {
    // TODO: this needs to handle multiple can-play functionalities?
    const customElement = element as any;
    const elementInitializerInfo: Required<
      Omit<ElementInitializer, "additionalSetup">
    > = {
      defaultData: customElement.defaultData,
      defaultLocalData: customElement.defaultLocalData,
      myDefaultAwareness: customElement.myDefaultAwareness,
      updateElement: customElement.updateElement,
      updateElementAwareness: customElement.updateElementAwareness,
      onDrag: customElement.onDrag,
      onDragStart: customElement.onDragStart,
      onClick: customElement.onClick,
      onMount: customElement.onMount || customElement.additionalSetup,
      resetShortcut: customElement.resetShortcut,
      debounceMs: customElement.debounceMs,
      isValidElementForTag: customElement.isValidElementForTag,
    };
    return elementInitializerInfo;
  }

  return capabilitiesToInitializer[tag];
}

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
 *
 * Should be called only once. If you'd like to set up new elements, use `setupPlayElement`, which is exposed
 * on the `playhtml` object on `window`.
 */
function setupElements(): void {
  if (!hasSynced) {
    return;
  }

  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);
    if (!tagElements.length) {
      continue;
    }

    void Promise.all(
      tagElements.map((element) => setupPlayElementForTag(element, tag))
    );
  }

  if (!firstSetup) {
    return;
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
  firstSetup = false;
}

interface PlayHTMLComponents {
  init: typeof initPlayHTML;
  setupPlayElements: typeof setupElements;
  setupPlayElement: typeof setupPlayElement;
  removePlayElement: typeof removePlayElement;
  setupPlayElementForTag: typeof setupPlayElementForTag;
  globalData: Y.Map<any> | undefined;
  elementHandlers: Map<string, Map<string, ElementHandler>> | undefined;
}

// Expose big variables to the window object for debugging purposes.
export const playhtml: PlayHTMLComponents = {
  init: initPlayHTML,
  setupPlayElements: setupElements,
  setupPlayElement,
  removePlayElement,
  setupPlayElementForTag,
  globalData: undefined,
  elementHandlers: undefined,
};
// @ts-ignore
window.playhtml = playhtml;

/**
 * Performs any necessary setup for a playhtml TagType. Safe to call repeatedly.
 */
function maybeSetupTag(tag: TagType | string): void {
  if (elementHandlers.has(tag)) {
    return;
  }

  if (!hasSynced) {
    return;
  }

  if (!elementHandlers.has(tag)) {
    elementHandlers.set(tag, new Map<string, ElementHandler>());
  }
  let tagCommonElementInitializerInfo =
    tag !== TagType.CanPlay ? capabilitiesToInitializer[tag] : undefined;

  type tagType =
    typeof tagCommonElementInitializerInfo extends ElementInitializer
      ? (typeof tagCommonElementInitializerInfo)["defaultData"]
      : any;
  // check for safety, but this should always be true because of the first check.
  if (!globalData.get(tag)) {
    globalData.set(tag, new Y.Map<tagType>());
  }

  const tagData: Y.Map<tagType> = globalData.get(tag)!;

  tagData.observe((event) => {
    event.changes.keys.forEach((change, key) => {
      const tagElementHandlers = elementHandlers.get(tag)!;
      if (change.action === "add") {
        const element = document.getElementById(key)!;
        if (!isHTMLElement(element)) {
          console.log(`Element ${key} not an HTML element. Ignoring.`);
          return;
        }

        setupPlayElementForTag(element, tag);
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

/**
 * Returns true if the given element is set up properly for the given tag, false otherwise.
 */
function isElementValidForTag(
  element: HTMLElement,
  tag: TagType | string
): boolean {
  return (
    capabilitiesToInitializer[tag]?.isValidElementForTag?.(element) ?? true
  );
}

/**
 * Sets up a playhtml element to handle the given tag's capabilities.
 */
async function setupPlayElementForTag<T extends TagType | string>(
  element: HTMLElement,
  tag: T
): Promise<void> {
  if (!isElementValidForTag(element, tag)) {
    return;
  }

  if (!hasSynced) {
    return;
  }

  if (!element.id) {
    // TODO: better way for unique ID here? but actually having it reversible is a nice property
    const selectorId = element.getAttribute("selector-id");
    if (selectorId) {
      const selectorIdx = selectorIdsToAvailableIdx.get(selectorId) ?? 0;

      element.id = btoa(`${tag}-${selectorId}-${selectorIdx}`);
      selectorIdsToAvailableIdx.set(selectorId, selectorIdx + 1);
    } else {
      // TODO: use a hash function that compresses here
      element.id = await hashElement(tag, element);
    }
  }
  const elementId = getIdForElement(element);

  if (!elementId) {
    console.error(
      `Element ${element} does not have an acceptable ID. Please add an ID to the element to register it as a playhtml element.`
    );
    return;
  }

  maybeSetupTag(tag);
  const tagElementHandlers = elementHandlers.get(tag)!;

  const elementInitializerInfo = getElementInitializerInfoForElement(
    tag,
    element
  );
  if (!isCorrectElementInitializer(elementInitializerInfo)) {
    console.error(
      `Element ${elementId} does not have proper info to initial a playhtml element. Please refer to https://github.com/spencerc99/playhtml#can-play for troubleshooting help.`
    );
    return;
  }

  type tagType = (typeof elementInitializerInfo)["defaultData"];
  const tagData: Y.Map<tagType> = globalData.get(tag)!;

  const elementData = createPlayElementData(
    element,
    tag,
    elementInitializerInfo,
    elementId
  );
  if (tagElementHandlers.has(elementId)) {
    // Try to update the elements info
    tagElementHandlers.get(elementId)!.reinitializeElementData(elementData);
    return;
  } else {
    tagElementHandlers.set(elementId, new ElementHandler(elementData));
  }
  // if there is nothing stored in the synced data, set it to the default data if the element gets successfully created
  if (
    tagData.get(elementId) === undefined &&
    elementInitializerInfo.defaultData !== undefined
  ) {
    tagData.set(
      elementId,
      elementInitializerInfo.defaultData instanceof Function
        ? elementInitializerInfo.defaultData(element)
        : elementInitializerInfo.defaultData
    );
  }

  // redo this now that we have set it in the mapping.
  // TODO: this is inefficient, it tries to do this in the constructor but fails, should clean up the API
  elementData.triggerAwarenessUpdate?.();
  // Set up the common classes for affected elements.
  element.classList.add(`__playhtml-element`);
  element.classList.add(`__playhtml-${tag}`);
  element.style.setProperty("--jiggle-delay", `${Math.random() * 1}s;}`);
}

function setupPlayElement(
  element: Element,
  { ignoreIfAlreadySetup }: { ignoreIfAlreadySetup?: boolean } = {}
) {
  if (
    ignoreIfAlreadySetup &&
    Object.keys(elementHandlers || {}).some((tag) =>
      elementHandlers.get(tag)?.has(element.id)
    )
  ) {
    return;
  }

  if (!isHTMLElement(element)) {
    console.log(`Element ${element.id} not an HTML element. Ignoring.`);
    return;
  }

  void Promise.all(
    getTagTypes()
      .filter((tag) => element.hasAttribute(tag))
      .map((tag) => setupPlayElementForTag(element, tag))
  );
}

function removePlayElement(element: Element | null) {
  if (!element || !element.id) {
    return;
  }

  for (const tag of Object.keys(elementHandlers)) {
    const tagElementHandler = elementHandlers.get(tag)!;
    if (tagElementHandler.has(element.id)) {
      tagElementHandler.delete(element.id);
    }
  }
}
