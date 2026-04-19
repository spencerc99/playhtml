// ABOUTME: Shared types, interfaces, and capability initializers for the playhtml library.
// ABOUTME: Exports element capabilities, event handler types, and built-in tag definitions.
import { canMirrorInitializer, type ElementState } from "./canMirror";
export type { ElementState } from "./canMirror";

export type ModifierKey = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";

// TODO: should be able to have set of allowable elements
// TODO: should be able to accept arbitrary input? (like max/min)
// TODO: should be able to add permission conditions?
// TODO: add new method for preventing updates while someone else is moving it?
export interface ElementInitializer<T = any, U = any, V = any> {
  defaultData: T | ((element: HTMLElement) => T);
  defaultLocalData?: U | ((element: HTMLElement) => U);
  myDefaultAwareness?: V | ((element: HTMLElement) => V);
  updateElement: (data: ElementEventHandlerData<T, U, V>) => void;
  updateElementAwareness?: (
    data: ElementAwarenessEventHandlerData<T, U, V>,
  ) => void;

  // Event handlers
  // Abstracts to handle clicking and dragging the element to handle both mouse and touch events.
  // Takes inspiration from https://github.com/react-grid-layout/react-draggable
  onDrag?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>,
  ) => void;
  onClick?: (
    e: MouseEvent,
    eventData: ElementEventHandlerData<T, U, V>,
  ) => void;
  onDragStart?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>,
  ) => void;
  // @deprecated use onMount instead
  additionalSetup?: (eventData: ElementSetupData<T, U, V>) => void;
  // Used to set up any additional event handlers
  onMount?: (eventData: ElementSetupData<T, U, V>) => void;

  // Advanced settings
  resetShortcut?: ModifierKey;
  debounceMs?: number;
  isValidElementForTag?: (element: HTMLElement) => boolean;
}

export interface ElementData<T = any, U = any, V = any>
  extends ElementInitializer<T> {
  data?: T;
  localData?: U;
  awareness?: V;
  element: HTMLElement;
  onChange: (data: T) => void;
  onAwarenessChange: (data: V) => void;
  // Gets the current set of awareness data for the element.
  triggerAwarenessUpdate: () => void;
}

export interface ElementEventHandlerData<T = any, U = any, V = any> {
  data: T;
  localData: U;
  awareness: V[];
  awarenessByStableId: Map<string, V>;
  element: HTMLElement;
  /**
   * Updates the element's shared data.
   *
   * Two forms:
   * - Mutator form: setData((draft) => { ... })
   *   When the runtime uses SyncedStore/Yjs, draft is a live CRDT proxy.
   *   Mutate nested arrays/objects for merge-friendly collaborative edits.
   *   Concurrent updates will be merged across clients. Example:
   *     setData(d => { d.list.push(item); })
   *
   * - Value form: setData(value)
   *   Replaces the entire data snapshot. Use for canonical replacement
   *   scenarios (e.g., mirroring DOM state) or in legacy plain mode.
   *   Example: setData({ on: true })
   */
  setData: (data: T | ((draft: T) => void)) => void;
  // TODO: should probably rename to "setTemporaryData" and use setLocalData to set indexeddb data
  setLocalData: (data: U) => void;
  setMyAwareness: (data: V) => void;
}

export interface ElementAwarenessEventHandlerData<T = any, U = any, V = any>
  extends ElementEventHandlerData<T, U, V> {
  myAwareness?: V;
}

export interface ElementSetupData<T = any, U = any, V = any> {
  getData: () => T;
  getLocalData: () => U;
  getAwareness: () => V[];
  getElement: () => HTMLElement;
  setData: (data: T | ((draft: T) => void)) => void;
  setLocalData: (data: U) => void;
  setMyAwareness: (data: V) => void;
}

interface EventData<T = any> {
  eventPayload: T;
}

export type EventMessage<T = any> = Pick<PlayEvent<T>, "type"> &
  Partial<EventData<T>>;

export interface PlayEvent<T = any> {
  type: string;
  onEvent: (eventPayload: EventData<T>) => void;
}

export interface RegisteredPlayEvent<T = any> extends PlayEvent<T> {
  id: string;
}

/**
 * Rounds a number to one decimal place. Used for can-move x/y so synced
 * state stays compact over the wire (avoids long floats like 267.332275390625).
 */
function roundToFirstDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

function getMoveBoundsRoot(element: HTMLElement): HTMLElement | null {
  const raw = element.getAttribute(CanMoveBounds)?.trim();
  if (!raw) return null;
  const forId = raw.startsWith("#") ? raw.slice(1) : raw;
  return document.getElementById(forId) ?? document.querySelector(raw);
}

/**
 * Custom Capabilities data types
 */
export type MoveData = {
  x: number;
  y: number;
};
export type SpinData = {
  rotation: number;
};
export type GrowData = {
  scale: number;
  maxScale: number;
  isHovering: boolean;
};
export const CanDuplicateTo = "can-duplicate-to";
/** Optional id or selector (`#id` or `selector`) of a container; `can-move` clamps translate to stay inside it. */
export const CanMoveBounds = "can-move-bounds";

// Supported Tags
export enum TagType {
  "CanPlay" = "can-play",
  "CanMove" = "can-move",
  "CanSpin" = "can-spin",
  "CanGrow" = "can-grow",
  "CanToggle" = "can-toggle",
  "CanDuplicate" = "can-duplicate",
  "CanHover" = "can-hover",
  "CanMirror" = "can-mirror",
  // "CanResize" = "can-resize",
  // "CanRearrange" = "can-rearrange",
  // "CanDrag" = "can-drag",
  // "CanDraw" = "can-draw",
  // "CanBounce" = "can-bounce",
  // "CanDrive" = "can-drive",
  // "CanHighlight" = "can-highlight",
  // "CanStamp" = "can-stamp",
  // canZoom
  // canScroll

  // "CanFall" = "can-fall", See https://mrdoob.com/projects/chromeexperiments/google-space/
  // "CanAge" = "can-age",
  // "CanFingerprint" = "can-fingerprint",
  // "CanTake" = "can-take",
  // "CanPlace" = "can-place",
  // "CanBreak" = "can-break",
  // "CanUse" = "can-use",
  // A BUNCH FROM Copilot completions
  // "CanOpen" = "can-open",
  // "CanClose" = "can-close",
  // "CanChat" = "can-chat",
  // "CanRead" = "can-read",
  // "CanWrite" = "can-write",
  // "CanEat" = "can-eat",
  // "CanDrink" = "can-drink",
  // "CanWear" = "can-wear",
  // "CanWield" = "can-wield",
  // "CanTalk" = "can-talk",
  // "CanListen" = "can-listen",
  // "CanLook" = "can-look",
  // "CanSmell" = "can-smell",
  // "CanTaste" = "can-taste",
  // "CanFeel" = "can-feel",
  // "CanThink" = "can-think",
  // "CanSleep" = "can-sleep",
  // "CanWake" = "can-wake",
  // "CanBreathe" = "can-breathe",
}

export function getIdForElement(ele: HTMLElement): string | undefined {
  const dataSource = ele.getAttribute("data-source");
  if (dataSource) {
    return getSharedElementId(ele);
  }

  return ele.id;
}

export function getSharedElementId(el: HTMLElement): string | undefined {
  const dataSource = el.getAttribute("data-source");
  if (!dataSource) {
    throw new Error("Element has no data-source attribute");
  }

  const [domainAndPath, elementId] = dataSource.split("#");
  if (!domainAndPath || !elementId) {
    throw new Error("Invalid data-source attribute");
  }

  return elementId;
}

// Re-export helpers from split files
export * from "./objectUtils";
export * from "./sharedElements";

// Export cursor types
export * from "./cursor-types";
import type { Cursor, PlayerIdentity } from "./cursor-types";

export interface PageDataChannel<T> {
  getData(): T;
  setData(data: T | ((draft: T) => void)): void;
  onUpdate(callback: (data: T) => void): () => void;
  destroy(): void;
}

export type PresenceView<T extends Record<string, unknown> = Record<string, unknown>> = {
  playerIdentity?: PlayerIdentity;
  cursor: Cursor | null;
  isMe: boolean;
} & T;

export interface PresenceAPI {
  setMyPresence(channel: string, data: unknown): void;
  getPresences(): Map<string, PresenceView>;
  onPresenceChange(
    channel: string,
    callback: (presences: Map<string, PresenceView>) => void,
  ): () => void;
  getMyIdentity(): PlayerIdentity;
}

export interface PresenceRoom {
  presence: PresenceAPI;
  destroy: () => void;
}

const growCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='44' height='53' viewport='0 0 100 100' style='fill:black;font-size:26px;'><text y='40%'>🚿</text></svg>")
      16 0,
    auto`;
const cutCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='40' height='48' viewport='0 0 100 100' style='fill:black;font-size:24px;'><text y='50%'>✂️</text></svg>") 16 0,auto`;
function canGrowCursorHandler(
  e: MouseEvent | KeyboardEvent,
  { getData, getElement, getLocalData, setLocalData }: ElementSetupData,
) {
  const data = getData();
  const localData = getLocalData();
  const element = getElement();

  localData.isHovering = true;
  if (e.altKey) {
    if (data.scale <= 0.5) {
      element.style.cursor = "not-allowed";
      return;
    }
    element.style.cursor = cutCursor;
  } else {
    if (data.scale >= data.maxScale) {
      element.style.cursor = "not-allowed";
      return;
    }
    element.style.cursor = growCursor;
  }

  setLocalData(localData);
}

function getClientCoordinates(e: MouseEvent | TouchEvent): {
  clientX: number;
  clientY: number;
} {
  if ("touches" in e) {
    const { clientX, clientY } = e.touches[0];
    return { clientX, clientY };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

// @ts-ignore
type MoveLocalData = { startMouseX: number; startMouseY: number };
type SpinLocalData = { startMouseX: number };
type GrowLocalData = { maxScale: number; isHovering: boolean };

// Strongly-typed mapping of built-in tags to their initializer signatures
export type DefaultTagInitializers = {
  [TagType.CanMove]: ElementInitializer<MoveData, MoveLocalData>;
  [TagType.CanSpin]: ElementInitializer<SpinData, SpinLocalData>;
  [TagType.CanToggle]: ElementInitializer<{ on: boolean } | boolean>;
  [TagType.CanGrow]: ElementInitializer<{ scale: number }, GrowLocalData>;
  [TagType.CanDuplicate]: ElementInitializer<string[], string[]>;
  [TagType.CanHover]: ElementInitializer<
    Record<string, never>,
    undefined,
    { hover: boolean }
  >;
  [TagType.CanMirror]: ElementInitializer<ElementState>;
};

export const TagTypeToElement: DefaultTagInitializers = {
  [TagType.CanMove]: {
    defaultData: { x: 0, y: 0 },
    defaultLocalData: { startMouseX: 0, startMouseY: 0 },
    updateElement: ({ element, data }) => {
      element.style.transform = `translate(${data.x}px, ${data.y}px)`;
    },
    onDragStart: (e: MouseEvent | TouchEvent, { setLocalData }) => {
      const { clientX, clientY } = getClientCoordinates(e);
      setLocalData({
        startMouseX: clientX,
        startMouseY: clientY,
      });
    },
    onDrag: (
      e: MouseEvent | TouchEvent,
      { data, localData, setData, setLocalData, element },
    ) => {
      const { clientX, clientY } = getClientCoordinates(e);
      const newX = data.x + clientX - localData.startMouseX;
      const newY = data.y + clientY - localData.startMouseY;

      const boundsRoot = getMoveBoundsRoot(element);
      if (boundsRoot) {
        const maxX = Math.max(
          0,
          boundsRoot.clientWidth - element.offsetWidth,
        );
        const maxY = Math.max(
          0,
          boundsRoot.clientHeight - element.offsetHeight,
        );
        setData({
          x: roundToFirstDecimal(Math.min(maxX, Math.max(0, newX))),
          y: roundToFirstDecimal(Math.min(maxY, Math.max(0, newY))),
        });
        setLocalData({ startMouseX: clientX, startMouseY: clientY });
        return;
      }

      const { top, left, bottom, right } = element.getBoundingClientRect();
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight =
        window.visualViewport?.height ?? window.innerHeight;
      if (
        (right > viewportWidth && clientX > localData.startMouseX) ||
        (bottom > viewportHeight && clientY > localData.startMouseY) ||
        (left < 0 && clientX < localData.startMouseX) ||
        (top < 0 && clientY < localData.startMouseY)
      )
        return;
      setData({
        x: roundToFirstDecimal(newX),
        y: roundToFirstDecimal(newY),
      });
      setLocalData({ startMouseX: clientX, startMouseY: clientY });
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanSpin]: {
    defaultData: { rotation: 0 },
    defaultLocalData: { startMouseX: 0 },
    updateElement: ({ element, data }) => {
      element.style.transform = `rotate(${data.rotation}deg)`;
    },
    onDragStart: (e: MouseEvent | TouchEvent, { setLocalData }) => {
      const { clientX } = getClientCoordinates(e);
      setLocalData({
        startMouseX: clientX,
      });
    },
    onDrag: (
      e: MouseEvent | TouchEvent,
      { data, localData, setData, setLocalData },
    ) => {
      const { clientX } = getClientCoordinates(e);
      // Calculate distance mouse has moved from the last known position
      // TODO: scale this according to size
      let distance = Math.abs(clientX - localData.startMouseX) * 2;
      let rotation = data.rotation;

      if (clientX > localData.startMouseX) {
        // Move right
        rotation += distance; // Change rotation proportional to the distance moved
      } else if (clientX < localData.startMouseX) {
        // Move left
        rotation -= distance; // Change rotation proportional to the distance moved
      }

      setData({ rotation });
      setLocalData({ startMouseX: clientX });
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanToggle]: {
    defaultData: { on: false },
    updateElement: ({ element, data }) => {
      // handling migration from "boolean" to "{on: boolean}" type
      const on = typeof data === "object" ? data.on : data;
      element.classList.toggle("clicked", on);
    },
    onClick: (e: MouseEvent, { data, setData }) => {
      // handling migration from "boolean" to "{on: boolean}" type
      const on = typeof data === "object" ? data.on : data;
      setData({ on: !on });
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanGrow]: {
    defaultData: { scale: 1 },
    defaultLocalData: { maxScale: 2, isHovering: false },
    updateElement: ({ element, data }) => {
      element.style.transform = `scale(${data.scale})`;
    },
    onClick: (e: MouseEvent, { data, element, setData, localData }) => {
      let { scale } = data;
      if (e.altKey) {
        // shrink
        if (data.scale <= 0.5) {
          return;
        }

        scale -= 0.1;
      } else {
        // grow
        element.style.cursor = growCursor;
        if (data.scale >= localData.maxScale) {
          return;
        }

        scale += 0.1;
      }
      setData({ ...data, scale });
    },
    onMount: (eventData) => {
      eventData.getElement().addEventListener("mouseenter", (e) => {
        canGrowCursorHandler(e, eventData);
        const onKeyDownUp = (e: KeyboardEvent) =>
          canGrowCursorHandler(e, eventData);
        document.addEventListener("keydown", onKeyDownUp);
        document.addEventListener("keyup", onKeyDownUp);

        eventData.getElement().addEventListener("mouseleave", (e) => {
          document.removeEventListener("keydown", onKeyDownUp);
          document.removeEventListener("keyup", onKeyDownUp);
        });
      });
    },
    resetShortcut: "shiftKey",
  },
  // TODO: add ability to add max # of duplicates
  // TODO: add lifespan to automatically prune
  // TODO: add limit per person / per timeframe.
  [TagType.CanDuplicate]: {
    defaultData: [],
    defaultLocalData: [],
    updateElement: ({ data, localData, setLocalData, element }) => {
      const duplicateElementId = element.getAttribute(TagType.CanDuplicate)!;
      const elementToDuplicate = document.getElementById(duplicateElementId);
      let lastElement: HTMLElement | null =
        document.getElementById(localData.slice(-1)?.[0]) ?? null;
      if (!elementToDuplicate) {
        console.error(
          `Element with id ${duplicateElementId} not found. Cannot duplicate.`,
        );
        return;
      }

      const canDuplicateTo = element.getAttribute(CanDuplicateTo);
      function insertDuplicatedElement(newElement: Node) {
        if (canDuplicateTo) {
          const duplicateToElement =
            document.getElementById(canDuplicateTo) ||
            document.querySelector(canDuplicateTo);
          if (duplicateToElement) {
            duplicateToElement.appendChild(newElement);
            return;
          }
        }

        // By default insert after the latest element inserted (or the element to duplicate if none yet)
        elementToDuplicate!.parentNode!.insertBefore(
          newElement,
          (lastElement || elementToDuplicate!).nextSibling,
        );
      }

      const addedElements = new Set(localData);
      for (const elementId of data) {
        if (addedElements.has(elementId)) continue;

        const newElement = elementToDuplicate.cloneNode(true) as HTMLElement;
        Object.assign(newElement, { ...elementToDuplicate });
        newElement.id = elementId;

        insertDuplicatedElement(newElement);
        localData.push(elementId);
        // TODO: import this to make it work not in browser
        // @ts-ignore
        window.playhtml.setupPlayElement(newElement);
        lastElement = newElement;
      }
      setLocalData(localData);
    },
    onClick: (_e: MouseEvent, { data, element, setData }) => {
      const duplicateElementId = element.getAttribute(TagType.CanDuplicate)!;
      const newElementId =
        duplicateElementId + "-" + Math.random().toString(36).substr(2, 9);

      setData((draft) => {
        draft.push(newElementId);
      });
    },
    isValidElementForTag: (element) => {
      const tagAttribute = element.getAttribute(TagType.CanDuplicate);
      if (!tagAttribute) {
        return false;
      }

      if (!document.getElementById(tagAttribute)) {
        console.warn(
          `${TagType.CanDuplicate} element (${element.id}) duplicate element ("${tagAttribute}") not found.`,
        );
      }

      return true;
    },
  },
  // TODO: auto-duplicate :hover CSS rules to [data-playhtml-hover] via CSSOM
  // so users don't need to manually rewrite their hover styles.
  [TagType.CanHover]: {
    defaultData: {},
    myDefaultAwareness: { hover: false },
    onMount: ({ getElement, setMyAwareness }) => {
      const element = getElement();
      element.addEventListener("mouseenter", () => {
        setMyAwareness({ hover: true });
        element.setAttribute("data-playhtml-hover", "");
      });
      element.addEventListener("mouseleave", () => {
        setMyAwareness({ hover: false });
        element.removeAttribute("data-playhtml-hover");
      });
    },
    updateElement: () => {},
    updateElementAwareness: ({ element, awareness }) => {
      const anyHover = awareness.some((a) => a?.hover);
      if (anyHover) {
        element.setAttribute("data-playhtml-hover", "");
      } else {
        element.removeAttribute("data-playhtml-hover");
      }
    },
  },
  [TagType.CanMirror]: canMirrorInitializer,
};
