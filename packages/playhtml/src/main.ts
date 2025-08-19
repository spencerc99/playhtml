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
import { syncedStore, getYjsDoc, getYjsValue } from "@syncedstore/core";
import { ElementHandler } from "./elements";
import { hashElement } from "./utils";

const DefaultPartykitHost = "playhtml.spencerc99.partykit.dev";

const VERBOSE = 0;

// Root SyncedStore for nested CRDT semantics while keeping plain API
type StoreShape = {
  play: Record<string, Record<string, any>>; // tag -> elementId -> data proxy
};
const store = syncedStore<StoreShape>({ play: {} });
const doc = getYjsDoc(store);

// MIGRATION: Flags and infrastructure for transitioning to SyncedStore-only
const MIGRATION_FLAGS = {
  // TESTING: Re-enabled for production data volume testing
  enableMigration: true,
  // Log migration progress - ENABLED for testing
  logMigration: false,
};

function migrateTagFromYMapToSyncedStore(tag: string): void {
  if (!MIGRATION_FLAGS.enableMigration) return;

  const startTime = performance.now();
  console.debug(`[MIGRATION] Starting migration for tag: ${tag}`);

  const tagMap = globalData.get(tag);
  if (!tagMap) {
    console.debug(`[MIGRATION] No data found for tag: ${tag}`);
    return;
  }

  // Log the size of data we're about to migrate
  let mapSize = 0;
  try {
    tagMap.forEach(() => mapSize++);
    console.debug(`[MIGRATION] Found ${mapSize} entries for tag: ${tag}`);
  } catch (error) {
    console.error(
      `[MIGRATION ERROR] Failed to count entries for tag ${tag}:`,
      error
    );
    return;
  }

  // Ensure tag exists in SyncedStore
  store.play[tag] ??= {};

  let migratedCount = 0;
  let errorCount = 0;

  try {
    // Batch all migration operations in a single transaction to prevent excessive broadcasts
    doc.transact(() => {
      tagMap.forEach((elementData: any, elementId: string) => {
        try {
          // Log memory usage for large objects
          const dataSize = JSON.stringify(elementData).length;
          if (dataSize > 10000) {
            console.debug(
              `[MIGRATION] Large data entry: ${tag}:${elementId} (${dataSize} chars)`
            );
          }

          const clonedData = clonePlain(elementData);
          store.play[tag]![elementId] = clonedData;
          migratedCount++;

          // Log progress every 1000 items for large datasets
          if (migratedCount % 1000 === 0) {
            console.debug(
              `[MIGRATION] Progress: ${migratedCount}/${mapSize} migrated for ${tag}`
            );
          }
        } catch (error) {
          errorCount++;
          console.error(
            `[MIGRATION ERROR] Failed to migrate ${tag}:${elementId}:`,
            error
          );
        }
      });
    });
  } catch (error) {
    console.error(`[MIGRATION FATAL] forEach failed for tag ${tag}:`, error);
    return;
  }

  const endTime = performance.now();
  const duration = endTime - startTime;

  if (MIGRATION_FLAGS.logMigration) {
    console.debug(
      `[MIGRATION] Completed ${tag}: ${migratedCount} migrated, ${errorCount} errors, ${duration.toFixed(
        2
      )}ms`
    );
  }
}

function migrateAllDataFromYMapToSyncedStore(): void {
  if (!MIGRATION_FLAGS.enableMigration) return;

  // Check if migration has already been completed
  const migrationComplete = globalData.get("__migration_complete__");
  if (migrationComplete) {
    console.debug("[MIGRATION] Migration already completed, skipping");
    return;
  }

  console.debug("[MIGRATION] Starting migration from Y.Map to SyncedStore");

  // Migrate all tags (excluding our migration flag)
  globalData.forEach((_, tag) => {
    if (tag !== "__migration_complete__") {
      migrateTagFromYMapToSyncedStore(tag);
    }
  });

  // Mark migration as complete so other clients don't run it
  globalData.set("__migration_complete__", true);

  console.debug(
    "[MIGRATION] Migration completed. SyncedStore state:",
    clonePlain(store.play)
  );
}

function getDefaultRoom(includeSearch?: boolean): string {
  // TODO: Strip filename extension
  const transformedPathname = window.location.pathname.replace(/\.[^/.]+$/, "");

  return includeSearch
    ? transformedPathname + window.location.search
    : transformedPathname;
}
let yprovider: YPartyKitProvider;
// @ts-ignore, will be removed
let globalData: Y.Map<any> = doc.getMap<Y.Map<any>>("playhtml-global");
// Internal map for quick access to proxies
const proxyByTagAndId = new Map<string, Map<string, any>>();
const yObserverByKey = new Map<string, (events: any[]) => void>();

function ensureElementProxy<T = any>(
  tag: string,
  elementId: string,
  defaultData: T
) {
  if (!proxyByTagAndId.has(tag)) proxyByTagAndId.set(tag, new Map());
  const tagMap = proxyByTagAndId.get(tag)!;
  if (!tagMap.has(elementId)) {
    store.play[tag] ??= {};
    if (store.play[tag][elementId] === undefined) {
      // Always clone to avoid reusing the same object reference across multiple elements,
      // which SyncedStore forbids ("reassigning object that already occurs in the tree").
      const initial = clonePlain(defaultData) as any;
      store.play[tag][elementId] = initial;
    }
    tagMap.set(elementId, store.play[tag][elementId]);
  }
  return tagMap.get(elementId)!;
}
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
    Object.keys(store.play).forEach((tag) => {
      const tagData = store.play[tag];
      if (tagData) {
        Object.keys(tagData).forEach((elementId) => {
          delete tagData[elementId];
        });
      }
    });
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
// NOTE: Potential optimization: allowlist/blocklist collaborative paths
// In complex nested data scenarios, SyncedStore CRDT proxies on every nested object can add overhead.
// Idea: expose an opt-in config to restrict which properties are collaborative (proxied) vs. local-only.
// Example API (future):
// <CanPlayElement
//   defaultData={...}
//   crdtPaths={{ allow: ["lists.todos", "nested.a.b.c.values"], block: ["profile", "counters"] }}
// >
// This would proxy only specified paths in synced mode, keeping others as plain local React state.
// This aligns with the common case where nested arrays need collaboration more than nested objects.

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

  // NOTE: there's a typescript error here but it all seems to work...
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

  // Mark all discovered playhtml elements as loading before sync
  markAllElementsAsLoading();

  // await until yprovider is synced
  await new Promise((resolve) => {
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

      migrateAllDataFromYMapToSyncedStore();

      setupElements();

      // Mark all elements as ready after sync completes and elements are set up
      markAllElementsAsReady();

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

// Loading state management functions
function getDefaultLoadingBehavior(element: HTMLElement): string {
  if (element.hasAttribute("can-play")) return "none"; // No auto-loading for can-play
  return "animate"; // can-move, can-toggle, can-spin, can-grow, etc.
}

function markElementAsLoading(element: HTMLElement): void {
  const behavior =
    element.getAttribute("loading-behavior") ||
    getDefaultLoadingBehavior(element);

  if (behavior === "none") return;

  element.classList.add("playhtml-loading");

  // Add custom loading class if specified
  const customLoadingClass = element.getAttribute("loading-class");
  if (customLoadingClass) {
    element.classList.add(customLoadingClass);
  }

  // Add accessibility attributes
  element.setAttribute("aria-busy", "true");
  element.setAttribute("aria-live", "polite");
}

function markElementAsReady(element: HTMLElement): void {
  const behavior =
    element.getAttribute("loading-behavior") ||
    getDefaultLoadingBehavior(element);

  if (behavior === "none") return;

  element.classList.remove("playhtml-loading");

  // Remove custom loading class if it was added
  const customLoadingClass = element.getAttribute("loading-class");
  if (customLoadingClass) {
    element.classList.remove(customLoadingClass);
  }

  // Remove accessibility attributes
  element.removeAttribute("aria-busy");
  element.removeAttribute("aria-live");
}

function markAllElementsAsLoading(): void {
  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);

    tagElements.forEach((element) => {
      markElementAsLoading(element);
    });
  }
}

function markAllElementsAsReady(): void {
  for (const tag of getTagTypes()) {
    const tagElements: HTMLElement[] = Array.from(
      document.querySelectorAll(`[${tag}]`)
    ).filter(isHTMLElement);

    tagElements.forEach((element) => {
      markElementAsReady(element);
    });
  }
}

function createPlayElementData<T extends TagType>(
  element: HTMLElement,
  tag: T,
  tagInfo: ElementInitializer<T>,
  elementId: string
): ElementData<T> {
  if (VERBOSE) {
    console.log("registering element", elementId, "using SyncedStore data");
  }

  const initialData =
    tagInfo.defaultData instanceof Function
      ? tagInfo.defaultData(element)
      : tagInfo.defaultData;

  // Always use SyncedStore proxy
  const dataProxy = ensureElementProxy(tag as string, elementId, initialData);

  const elementData: ElementData = {
    ...tagInfo,
    // Always provide a plain snapshot to render paths
    data: clonePlain(dataProxy),
    awareness:
      getElementAwareness(tag, elementId) ??
      tagInfo.myDefaultAwareness !== undefined
        ? [tagInfo.myDefaultAwareness]
        : undefined,
    element,
    onChange: (newData) => {
      if (typeof (newData as any) === "function") {
        // Mutator form support: onChange can accept function(draft)
        // Batch all nested mutations into a single Yjs transaction to coalesce events
        doc.transact(() => {
          (newData as any)(dataProxy);
        });
      } else {
        // Value form: replace snapshot semantics
        doc.transact(() => {
          deepReplaceIntoProxy(dataProxy, newData);
        });
      }
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

function isPlainObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

// Replacement variant used for tags that keep a canonical snapshot (e.g., can-mirror)
function deepReplaceIntoProxy(target: any, src: any) {
  if (src === null || src === undefined) return;
  if (Array.isArray(src)) {
    target.splice(0, target.length, ...src);
    return;
  }
  if (isPlainObject(src)) {
    // Remove keys not present in src
    for (const key of Object.keys(target)) {
      if (!(key in src)) {
        delete target[key];
      }
    }
    // Set all keys from src
    for (const [k, v] of Object.entries(src)) {
      if (Array.isArray(v)) {
        if (!Array.isArray(target[k])) target[k] = [];
        deepReplaceIntoProxy(target[k], v);
      } else if (isPlainObject(v)) {
        if (!isPlainObject(target[k])) target[k] = {};
        deepReplaceIntoProxy(target[k], v);
      } else {
        target[k] = v;
      }
    }
    return;
  }
  // primitives
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  target = src;
}

function clonePlain<T>(value: T): T {
  // Prefer structuredClone when available; fallback to JSON clone for plain data
  try {
    // @ts-ignore
    if (typeof structuredClone === "function") {
      // @ts-ignore
      return structuredClone(value);
    }
  } catch {}
  if (value === null || value === undefined) return value;
  if (typeof value === "object") {
    return JSON.parse(JSON.stringify(value));
  }
  return value;
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

  yprovider.awareness.on("change", () => onChangeAwareness());
  firstSetup = false;
}

interface PlayHTMLComponents {
  init: typeof initPlayHTML;
  setupPlayElements: typeof setupElements;
  setupPlayElement: typeof setupPlayElement;
  removePlayElement: typeof removePlayElement;
  setupPlayElementForTag: typeof setupPlayElementForTag;
  syncedStore: (typeof store)["play"];
  // TODO: REMOVE AFTER MIGRATION VALIDATED
  globalData: typeof globalData;
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
  syncedStore: store.play,
  // TODO: REMOVE AFTER MIGRATION VALIDATED
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

  store.play[tag] ??= {};
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

  const elementData = createPlayElementData(
    element,
    tag,
    elementInitializerInfo,
    elementId
  );
  if (tagElementHandlers.has(elementId)) {
    // Try to update the elements info
    tagElementHandlers.get(elementId)!.reinitializeElementData(elementData);
    // ensure observer is attached
    attachSyncedStoreObserver(tag as string, elementId);
    return;
  } else {
    tagElementHandlers.set(elementId, new ElementHandler(elementData));
  }

  // redo this now that we have set it in the mapping.
  // TODO: this is inefficient, it tries to do this in the constructor but fails, should clean up the API
  elementData.triggerAwarenessUpdate?.();
  // Set up the common classes for affected elements.
  element.classList.add(`__playhtml-element`);
  element.style.setProperty("--jiggle-delay", `${Math.random() * 1}s;}`);

  attachSyncedStoreObserver(tag as string, elementId);
}

function attachSyncedStoreObserver(tag: string, elementId: string) {
  const key = `${tag}:${elementId}`;
  const tagHandlers = elementHandlers.get(tag);
  if (!tagHandlers) return;
  const handler = tagHandlers.get(elementId);
  if (!handler) return;

  // Detach previous observer if present
  const yVal = getYjsValue(store.play[tag]?.[elementId]);
  if (!yVal || typeof (yVal as any).observeDeep !== "function") return;
  const existing = yObserverByKey.get(key);
  if (existing) {
    // @ts-ignore
    (yVal as any).unobserveDeep(existing);
  }
  let scheduled = false;
  const observer = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      // Push plain snapshot into handler for stable rendering
      const proxy = store.play[tag]?.[elementId];
      if (!proxy) return;
      const plain = clonePlain(proxy);
      // @ts-ignore private usage intended
      handler.__data = plain;
    });
  };
  // @ts-ignore
  (yVal as any).observeDeep(observer);
  yObserverByKey.set(key, observer);
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

  // Handle loading state for dynamically added elements
  const hasPlayhtmlAttributes = getTagTypes().some((tag) =>
    element.hasAttribute(tag)
  );

  if (hasPlayhtmlAttributes) {
    if (hasSynced) {
      // If already synced, element will be ready immediately
      markElementAsReady(element);
    } else {
      // If not synced yet, element should start loading
      markElementAsLoading(element);
    }
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
