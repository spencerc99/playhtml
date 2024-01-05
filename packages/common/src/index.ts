export type ModifierKey = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";
export const ModifierKeyToName: Record<ModifierKey, string> = {
  ctrlKey: "Control",
  altKey: "Alt",
  shiftKey: "Shift",
  metaKey: "Meta",
};

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
    data: ElementAwarenessEventHandlerData<T, U, V>
  ) => void;

  // Event handlers
  // Abstracts to handle clicking and dragging the element to handle both mouse and touch events.
  // Takes inspiration from https://github.com/react-grid-layout/react-draggable
  onDrag?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  onClick?: (
    e: MouseEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  onDragStart?: (
    e: MouseEvent | TouchEvent,
    eventData: ElementEventHandlerData<T, U, V>
  ) => void;
  additionalSetup?: (eventData: ElementSetupData<T, U, V>) => void;

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
  element: HTMLElement;
  setData: (data: T) => void;
  // TODO: should probably rename to "setTemporaryData" and use setLocalData to set indexeddb data
  setLocalData: (data: U) => void;
  setLocalAwareness: (data: V) => void;
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
  setData: (data: T) => void;
  setLocalData: (data: U) => void;
  setLocalAwareness: (data: V) => void;
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

// Supported Tags
export enum TagType {
  "CanPlay" = "can-play",
  "CanMove" = "can-move",
  "CanSpin" = "can-spin",
  "CanGrow" = "can-grow",
  "CanToggle" = "can-toggle",
  "CanDuplicate" = "can-duplicate",
  // "CanRearrange" = "can-rearrange",
  // "CanDraw" = "can-draw",
  // "CanBounce" = "can-bounce",
  // "CanHover" = "can-hover",
  // "CanDrive" = "can-drive",
  // "CanHighlight" = "can-highlight",
  // "CanStamp" = "can-stamp",
  // "CanResize" = "can-resize",
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
  return ele.id;
}

const growCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='44' height='53' viewport='0 0 100 100' style='fill:black;font-size:26px;'><text y='40%'>🚿</text></svg>")
      16 0,
    auto`;
const cutCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='40' height='48' viewport='0 0 100 100' style='fill:black;font-size:24px;'><text y='50%'>✂️</text></svg>") 16 0,auto`;
function canGrowCursorHandler(
  e: MouseEvent | KeyboardEvent,
  { getData, getElement, getLocalData, setLocalData }: ElementSetupData
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

export const TagTypeToElement: Record<
  Exclude<TagType, "can-play">,
  ElementInitializer
> = {
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
      { data, localData, setData, setLocalData, element }
    ) => {
      const { clientX, clientY } = getClientCoordinates(e);
      const { top, left, bottom, right } = element.getBoundingClientRect();
      if (
        (right > window.outerWidth && clientX > localData.startMouseX) ||
        (bottom > window.innerHeight && clientY > localData.startMouseY) ||
        (left < 0 && clientX < localData.startMouseX) ||
        (top < 0 && clientY < localData.startMouseY)
      )
        return;
      setData({
        x: data.x + clientX - localData.startMouseX,
        y: data.y + clientY - localData.startMouseY,
      });
      setLocalData({ startMouseX: clientX, startMouseY: clientY });
    },
    resetShortcut: "shiftKey",
  } as ElementInitializer<MoveData>,
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
      { data, localData, setData, setLocalData }
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
  } as ElementInitializer<SpinData>,
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
      console.log("clicked!", data, on);
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
    additionalSetup: (eventData) => {
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
  } as ElementInitializer<GrowData>,
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
          `Element with id ${duplicateElementId} not found. Cannot duplicate.`
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
          (lastElement || elementToDuplicate!).nextSibling
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

      setData([...data, newElementId]);
    },
    isValidElementForTag: (element) => {
      const tagAttribute = element.getAttribute(TagType.CanDuplicate);
      if (!tagAttribute) {
        return false;
      }

      if (!document.getElementById(tagAttribute)) {
        console.warn(
          `${TagType.CanDuplicate} element (${element.id}) duplicate element ("${tagAttribute}") not found.`
        );
      }

      return true;
    },
  } as ElementInitializer<string[]>,
};
