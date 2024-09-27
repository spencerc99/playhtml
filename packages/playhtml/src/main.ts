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
  PlayEvent,
  EventMessage,
  RegisteredPlayEvent,
} from "@playhtml/common";
import * as Y from "yjs";
import { ElementHandler } from "./elements";
import { hashElement } from "./utils";

const DefaultPartykitHost = "playhtml.spencerc99.partykit.dev";

const VERBOSE = 0;

const doc = new Y.Doc();

function getDefaultRoom(includeSearch?: boolean): string {
  // TODO: Strip filename extension
  const transformedPathname = window.location.pathname.replace(/\.[^/.]+$/, "");

  return includeSearch
    ? transformedPathname + window.location.search
    : transformedPathname;
}
let yprovider: YPartyKitProvider;
let globalData: Y.Map<any> = doc.getMap<Y.Map<any>>("playhtml-global");
let elementHandlers: Map<string, Map<string, ElementHandler>> = new Map<
  string,
  Map<string, ElementHandler>
>();
let eventHandlers: Map<string, Array<RegisteredPlayEvent>> = new Map<
  string,
  Array<RegisteredPlayEvent>
>();
const selectorIdsToAvailableIdx = new Map<string, number>();
let eventCount = 0;
export interface InitOptions<T = any> {
  /**
   * The room to connect users to (this should be a string that matches the other users
   * that you want a given user to connect with).
   *
   * All rooms are automatically prefixed with their host (`window.location.hostname`) to prevent
   * conflicting with other people's sites.
   * Defaults to `window.location.pathname + window.location.search. You can customize this by
   * passing in your own room dynamically
   */
  room?: string;

  /**
   * Provide your own partykit host if you'd like to run your own server and customize the logic.
   */
  host?: string;

  /**
   * Optionally provide your own map of capabilities
   */
  extraCapabilities?: Record<string, ElementInitializer>;

  /**
   * A mapping of event types to PlayEvents. Allows specifying of imperative logic to trigger when a
   * client triggers some event. Automatically listens to native DOM events to trigger these.
   *
   */
  events?: Record<string, PlayEvent<T>>;
  /**
   * configuration for the default room which is based on the window's url
   */
  defaultRoomOptions?: {
    /**
     * defaults to false
     */
    includeSearch?: boolean;
  };
  /**
   * Runs if playhtml fails to connect. Useful to show error messages and debugging.
   */
  onError?: () => void;

  /**
   * If true, will render some helpful development UI.
   */
  developmentMode?: boolean;
}

let capabilitiesToInitializer: Record<TagType | string, ElementInitializer> =
  TagTypeToElement;

function getTagTypes(): (TagType | string)[] {
  return [TagType.CanPlay, ...Object.keys(capabilitiesToInitializer)];
}

function sendPlayEvent(eventMessage: EventMessage) {
  if (!yprovider.ws) {
    return;
  }
  yprovider.ws.send(JSON.stringify(eventMessage));
}

function onMessage(evt: MessageEvent) {
  // ignore non-relevant events
  if (evt.data instanceof Blob) {
    return;
  }
  let message: EventMessage;
  try {
    message = JSON.parse(evt.data) as EventMessage;
  } catch (err) {
    return;
  }
  const { type, eventPayload } = message;

  const maybeHandlers = eventHandlers.get(type);
  if (!maybeHandlers) {
    return;
  }

  for (const handler of maybeHandlers) {
    handler.onEvent(eventPayload);
  }
}

function setupDevUI() {
  const devUi = document.createElement("div");
  devUi.id = "playhtml-dev-ui";
  devUi.style.position = "fixed";
  devUi.style.bottom = "10px";
  devUi.style.left = "10px";
  devUi.style.zIndex = "10000";

  const resetDataButton = document.createElement("button");
  resetDataButton.innerText = "Reset Data";
  resetDataButton.onclick = () => {
    globalData.clear();
  };
  devUi.appendChild(resetDataButton);

  let logObjectMode = false;
  const logObjectDataButton = document.createElement("button");
  logObjectDataButton.innerText = "Log Object Data";

  // Create overlay elements
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid #ff0000";
  overlay.style.backgroundColor = "rgba(255, 0, 0, 0.1)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "none";

  const idLabel = document.createElement("div");
  idLabel.style.position = "fixed";
  idLabel.style.backgroundColor = "#ff0000";
  idLabel.style.color = "#ffffff";
  idLabel.style.padding = "2px 5px";
  idLabel.style.fontSize = "12px";
  idLabel.style.zIndex = "10000";
  idLabel.style.display = "none";

  document.body.appendChild(overlay);
  document.body.appendChild(idLabel);

  logObjectDataButton.onclick = () => {
    logObjectMode = !logObjectMode;
    logObjectDataButton.innerText = logObjectMode
      ? "Exit Log Mode"
      : "Log Object Data";
    document.body.style.cursor = logObjectMode ? "pointer" : "default";
    if (!logObjectMode) {
      overlay.style.display = "none";
      idLabel.style.display = "none";
    }
  };
  devUi.appendChild(logObjectDataButton);

  document.body.appendChild(devUi);

  // Add mousemove event listener for highlighting
  document.addEventListener("mousemove", (event) => {
    if (!logObjectMode) return;

    const target = event.target as HTMLElement;
    const playElement = target.closest("[class^='__playhtml-']");

    if (playElement && playElement instanceof HTMLElement) {
      const rect = playElement.getBoundingClientRect();
      overlay.style.display = "block";
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      idLabel.style.display = "block";
      idLabel.style.left = `${rect.left}px`;
      idLabel.style.top = `${rect.top - 20}px`;
      idLabel.textContent = `#${playElement.id}`;
    } else {
      overlay.style.display = "none";
      idLabel.style.display = "none";
    }
  });

  // Add click event listener to log data
  document.addEventListener("click", (event) => {
    if (!logObjectMode) return;

    const target = event.target as HTMLElement;
    const playElement = target.closest("[class^='__playhtml-']");

    if (playElement && playElement instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();

      const elementId = playElement.id;
      const tagType = Array.from(playElement.classList)
        .find((cls) => cls.startsWith("__playhtml-"))
        ?.replace("__playhtml-", "");

      if (tagType && elementHandlers.has(tagType)) {
        const handler = elementHandlers.get(tagType)!.get(elementId);
        if (handler) {
          console.log(
            `Data for element #${elementId} (${tagType}):`,
            handler.__data
          );
        } else {
          console.log(`No data found for element #${elementId} (${tagType})`);
        }
      } else {
        console.log(`Unable to find data for element #${elementId}`);
      }
    }
  });
}

let hasSynced = false;
let firstSetup = true;
async function initPlayHTML({
  // TODO: if it is a localhost url, need to make some deterministic way to connect to the same room.
  host = DefaultPartykitHost,
  extraCapabilities,
  events,
  defaultRoomOptions = {},
  room: inputRoom = getDefaultRoom(defaultRoomOptions.includeSearch),
  onError,
  developmentMode = false,
}: InitOptions = {}) {
  if (!firstSetup || "playhtml" in window) {
    console.error("playhtml already set up! ignoring");
    return;
  }
  // @ts-ignore
  window.playhtml = playhtml;

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
  yprovider.on("error", () => {
    onError?.();
  });
  // @ts-ignore
  // TODO: we should backup in indexeddb too but not using this bc it introduces a bunch of weird conflicts
  const _indexedDBProvider = new IndexeddbPersistence(room, doc);

  if (extraCapabilities) {
    for (const [tag, tagInfo] of Object.entries(extraCapabilities)) {
      capabilitiesToInitializer[tag] = tagInfo;
    }
  }

  if (events) {
    for (const [eventType, event] of Object.entries(events)) {
      registerPlayEventListener(eventType, event);
    }
  }
  // Import default styles
  const playStyles = document.createElement("link");
  playStyles.rel = "stylesheet";
  playStyles.href = "https://unpkg.com/playhtml@latest/dist/style.css";
  document.head.appendChild(playStyles);

  if (developmentMode) {
    setupDevUI();
  }

  // await until yprovider is synced
  await new Promise((resolve) => {
    // TODO: provide some loading state for these elements immediately?
    // some sort of "hydration" state?
    if (hasSynced) {
      resolve(true);
    }
    yprovider.on("sync", (connected: boolean) => {
      if (!connected) {
        console.error("Issue connecting to yjs...");
      } else if (connected) {
        yprovider.ws!.addEventListener("message", onMessage);
      }
      if (hasSynced) {
        return;
      }
      hasSynced = true;
      console.log("[PLAYHTML]: Setting up elements... Time to have some fun 🛝");
      setupElements();
      resolve(true);
    });
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

  if (VERBOSE) {
    console.log(
      "registering element",
      elementId,
      tagData.get(elementId) ?? tagInfo.defaultData,
      tagData.get(elementId),
      tagInfo.defaultData
    );
  }

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

    if (VERBOSE) {
      console.log(`SET UP ${tag}`);
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
  eventHandlers: Map<string, Array<RegisteredPlayEvent>> | undefined;
  dispatchPlayEvent: typeof dispatchPlayEvent;
  registerPlayEventListener: typeof registerPlayEventListener;
  removePlayEventListener: typeof removePlayEventListener;
}

// Expose big variables to the window object for debugging purposes.
export const playhtml: PlayHTMLComponents = {
  init: initPlayHTML,
  setupPlayElements: setupElements,
  setupPlayElement,
  removePlayElement,
  setupPlayElementForTag,
  globalData,
  elementHandlers,
  eventHandlers,
  dispatchPlayEvent,
  registerPlayEventListener,
  removePlayEventListener,
};

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
    event.changes.keys.forEach(async (change, key) => {
      const tagElementHandlers = elementHandlers.get(tag)!;
      if (change.action === "add") {
        const element = document.getElementById(key)!;
        if (!isHTMLElement(element)) {
          console.log(`Element ${key} not an HTML element. Ignoring.`);
          return;
        }

        if (VERBOSE) {
          console.log(
            `[OBSERVE] Setting up playhtml element for tag ${tag} with element ${element}`
          );
        }
        setupPlayElementForTag(element, tag);
      } else if (change.action === "update") {
        let elementHandler = tagElementHandlers.get(key);
        if (!elementHandler) {
          const element = document.getElementById(key)!;
          if (!isHTMLElement(element)) {
            console.log(`Element ${key} not an HTML element. Ignoring.`);
            return;
          }

          if (VERBOSE) {
            console.log(
              `[OBSERVE] Setting up playhtml element for tag ${tag} with element ${element}`
            );
          }
          await setupPlayElementForTag(element, tag);
          elementHandler = tagElementHandlers.get(key);
        }
        elementHandler!.__data = tagData.get(key)!;
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
  if (VERBOSE) {
    console.log(`Setting up playhtml element for tag ${tag}`);
  }

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

// TODO: make async and run it after synced
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

function dispatchPlayEvent(message: EventMessage) {
  const { type } = message;
  if (!eventHandlers.has(type)) {
    console.error(`[playhtml] event "${type}" not registered.`);
    return;
  }

  sendPlayEvent(message);
}

/**
 * Registers the given event listener.
 * Returns a unique ID corresponding to the listener.
 */
// TODO: allow duplicates or not..
// duplicates are good for registering a lot of logic.. but why wouldn't you just put it all in one call?
// duplicates bad when you want to handle deduping the same logic, so this would be useful to expose one helper function in the react context
// to register a listener for a type and provide a callback and it returns you a function that triggers that event.
function registerPlayEventListener(
  type: string,
  event: Omit<PlayEvent, "type">
): string {
  const id = String(eventCount++);

  eventHandlers.set(type, [
    ...(eventHandlers.get(type) ?? []),
    { type, ...event, id },
  ]);

  // NOTE: bring this back if desired to automatically listen to native DOM events of the same type
  // document.addEventListener(type, (evt) => {
  //   const payload: EventMessage = {
  //     type,
  //     // @ts-ignore
  //     eventPayload: evt.detail,
  //     // @ts-ignore
  //     // element: evt.target,
  //   };
  //   sendPlayEvent(payload);
  // });
  return id;
}

/**
 * Removes the event listener with the given type and id.
 */
function removePlayEventListener(type: string, id: string) {
  const handlers = eventHandlers.get(type);
  if (!handlers) {
    return;
  }

  const index = handlers.findIndex((handler) => handler.id === id);
  if (index === -1) {
    return;
  }

  handlers.splice(index, 1);
  if (handlers.length === 0) {
    eventHandlers.delete(type);
  }
}
