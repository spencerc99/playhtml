/// <reference lib="dom"/>
import { getElementFromId } from "./main";
import { GrowData, MoveData, SpinData, TagType } from "./types";

// @ts-ignore
const debounce = (fn: Function, ms = 300) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
};

type ModifierKey = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";
const ModifierKeyToName: Record<ModifierKey, string> = {
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

interface ElementEventHandlerData<T = any, U = any, V = any> {
  data: T;
  localData: U;
  awareness: V[];
  element: HTMLElement;
  setData: (data: T) => void;
  setLocalData: (data: U) => void;
  setLocalAwareness: (data: V) => void;
}

interface ElementAwarenessEventHandlerData<T = any, U = any, V = any>
  extends ElementEventHandlerData<T, U, V> {
  myAwareness?: V;
}

interface ElementSetupData<T = any, U = any, V = any> {
  getData: () => T;
  getLocalData: () => U;
  getAwareness: () => V[];
  getElement: () => HTMLElement;
  setData: (data: T) => void;
  setLocalData: (data: U) => void;
  setLocalAwareness: (data: V) => void;
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
    defaultData: false,
    updateElement: ({ element, data }) => {
      element.classList.toggle("clicked", data);
    },
    onClick: (e: MouseEvent, { data, setData }) => {
      setData(!data);
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
  [TagType.CanPost]: {
    defaultData: [],
    defaultLocalData: { addedEntries: new Set() },
    updateElement: ({
      data: entries,
      localData: { addedEntries },
      setLocalData,
    }) => {
      const entriesToAdd = entries.filter(
        (entry) => !addedEntries.has(entry.id)
      );

      const guestbookDiv = getElementFromId("guestbookMessages")!;
      entriesToAdd.forEach((entry) => {
        const newEntry = document.createElement("div");
        newEntry.classList.add("guestbook-entry");
        const entryDate = new Date(entry.timestamp);
        const time = entryDate.toTimeString().split(" ")[0];
        const isToday = entryDate.toDateString() === new Date().toDateString();

        const dateString = (() => {
          if (isToday) {
            return "Today ";
          } else if (new Date().getDate() - entryDate.getDate() === 1) {
            return "Yesterday ";
          } else if (new Date().getDate() - entryDate.getDate() < 7) {
            return "This week ";
          } else {
            return "Sometime before ";
          }
        })();

        newEntry.innerHTML = `
        <span class="guestbook-entry-timestamp">${dateString}${time}</span><span class="guestbook-entry-name">${entry.name}</span> <span class="guestbook-entry-message">${entry.message}</span>`;
        guestbookDiv.prepend(newEntry);
        addedEntries.add(entry.id);
      });

      setLocalData({ addedEntries });
    },
    additionalSetup: ({ getElement, getData, setData }) => {
      const element = getElement();
      element.addEventListener("submit", (e: SubmitEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const entries = getData();

        const formData = new FormData(e.target as HTMLFormElement);
        // massage formData into new object
        // @ts-ignore
        const inputData = Object.fromEntries(formData.entries());
        const timestamp = Date.now();
        const newEntry: FormData = {
          name: "someone",
          message: "something",
          ...inputData,
          timestamp,
          id: `${timestamp}-${inputData.name}`,
        };
        setData([...entries, newEntry]);
        return false;
      });
    },
  } as ElementInitializer<FormData[]>,
};

interface FormData {
  id: string;
  name: string;
  message: string;
  timestamp: number;
}

// TODO: turn this into just an extension of HTMLElement and initialize all the methods / do all the state tracking
// on the element itself??
export class ElementHandler<T = any, U = any, V = any> {
  defaultData: T;
  localData: U;
  awareness: V[] = [];
  selfAwareness?: V;
  element: HTMLElement;
  _data: T;
  onChange: (data: T) => void;
  onAwarenessChange: (data: V) => void;
  debouncedOnChange: (data: T) => void;
  resetShortcut?: ModifierKey;
  // TODO: change this to receive the delta instead of the whole data object so you don't have to maintain
  // internal state for expressing the delta.
  updateElement: (data: ElementEventHandlerData<T, U, V>) => void;
  updateElementAwareness?: (
    data: ElementAwarenessEventHandlerData<T, U, V>
  ) => void;
  triggerAwarenessUpdate?: () => void;

  constructor({
    element,
    onChange,
    onAwarenessChange,
    defaultData,
    defaultLocalData,
    myDefaultAwareness,
    data,
    awareness: awarenessData,
    updateElement,
    updateElementAwareness,
    onClick,
    onDrag,
    onDragStart,
    additionalSetup,
    resetShortcut,
    debounceMs,
    triggerAwarenessUpdate,
  }: ElementData<T>) {
    // console.log("🔨 constructing ", element.id);
    this.element = element;
    this.defaultData =
      defaultData instanceof Function ? defaultData(element) : defaultData;
    this.localData =
      defaultLocalData instanceof Function
        ? defaultLocalData(element)
        : defaultLocalData;
    this.triggerAwarenessUpdate = triggerAwarenessUpdate;
    this.onChange = onChange;
    this.resetShortcut = resetShortcut;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this.onAwarenessChange = onAwarenessChange;
    this.updateElement = updateElement;
    this.updateElementAwareness = updateElementAwareness;
    const initialData = data === undefined ? this.defaultData : data;

    if (awarenessData !== undefined) {
      this.__awareness = awarenessData;
    }
    const myInitialAwareness =
      myDefaultAwareness instanceof Function
        ? myDefaultAwareness(element)
        : myDefaultAwareness;
    if (myInitialAwareness !== undefined) {
      this.setLocalAwareness(myInitialAwareness);
    }
    // Needed to get around the typescript error even though it is assigned in __data.
    this._data = initialData;
    this.__data = initialData;

    // Handle all the event handlers
    if (onClick) {
      element.addEventListener("click", (e) => {
        onClick(e, this.getEventHandlerData());
      });
    }

    if (onDrag) {
      element.addEventListener("touchstart", (e) => {
        // To prevent scrolling the page while dragging
        e.preventDefault();

        if (onDragStart) {
          // Need to be able to not persist everything in the data, causing some lag.
          onDragStart(e, this.getEventHandlerData());
        }

        const onMove = (e: TouchEvent) => {
          e.preventDefault();
          onDrag(e, this.getEventHandlerData());
        };
        const onDragStop = (e: TouchEvent) => {
          document.removeEventListener("touchmove", onMove);
          document.removeEventListener("touchend", onDragStop);
        };
        document.addEventListener("touchmove", onMove);
        document.addEventListener("touchend", onDragStop);
      });
      element.addEventListener("mousedown", (e) => {
        if (onDragStart) {
          // Need to be able to not persist everything in the data, causing some lag.
          onDragStart(e, this.getEventHandlerData());
        }

        const onMouseMove = (e: MouseEvent) => {
          e.preventDefault();
          onDrag(e, this.getEventHandlerData());
        };
        const onMouseUp = (e: MouseEvent) => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }

    if (additionalSetup) {
      additionalSetup(this.getSetupData());
    }

    // Handle advanced settings
    if (resetShortcut) {
      if (!element.title) {
        element.title = `Hold down the ${ModifierKeyToName[resetShortcut]} key while clicking to reset.`;
      }
      // @ts-ignore
      element.reset = this.reset;

      element.addEventListener("click", (e) => {
        switch (resetShortcut) {
          case "ctrlKey":
            if (!e.ctrlKey) {
              return;
            }
            break;
          case "altKey":
            if (!e.altKey) {
              return;
            }
            break;
          case "shiftKey":
            if (!e.shiftKey) {
              return;
            }
            break;
          case "metaKey":
            if (!e.metaKey) {
              return;
            }
            break;
          default:
            return;
        }
        this.reset();
        e.preventDefault();
        e.stopPropagation();
      });
    }
  }

  get data(): T {
    return this._data;
  }

  setLocalData(localData: U): void {
    this.localData = localData;
  }

  /**
   * // PRIVATE USE ONLY \\
   *
   * Updates the internal state with the given data and handles all the downstream effects. Should only be used by the sync code to ensure one-way
   * reactivity.
   * (e.g. calling `updateElement` and `onChange`)
   */
  set __data(data: T) {
    this._data = data;
    this.updateElement(this.getEventHandlerData());
  }

  set __awareness(data: V[]) {
    if (!this.updateElementAwareness) {
      return;
    }
    this.awareness = data;
    this.updateElementAwareness(this.getAwarenessEventHandlerData());
  }

  getEventHandlerData(): ElementEventHandlerData<T, U, V> {
    return {
      element: this.element,
      data: this.data,
      localData: this.localData,
      awareness: this.awareness,
      setData: (newData) => this.setData(newData),
      setLocalData: (newData) => this.setLocalData(newData),
      setLocalAwareness: (newData) => this.setLocalAwareness(newData),
    };
  }

  getAwarenessEventHandlerData(): ElementAwarenessEventHandlerData<T, U, V> {
    return {
      ...this.getEventHandlerData(),
      myAwareness: this.selfAwareness,
    };
  }

  getSetupData(): ElementSetupData<T, U> {
    return {
      getElement: () => this.element,
      getData: () => this.data,
      getLocalData: () => this.localData,
      getAwareness: () => this.awareness,
      setData: (newData) => this.setData(newData),
      setLocalData: (newData) => this.setLocalData(newData),
      setLocalAwareness: (newData) => this.setLocalAwareness(newData),
    };
  }

  /**
   * Public-use setter for data that makes the change to all clients.
   */
  setData(data: T): void {
    this.onChange(data);
  }

  setLocalAwareness(data: V): void {
    if (data === this.selfAwareness) {
      // avoid duplicate broadcasts
      return;
    }

    this.selfAwareness = data;
    this.onAwarenessChange(data);
    // For some reason unless it's the first time, the localState changing is not called in the `change` observer callback for awareness. So we have to manually update
    // the element's awareness rendering here.
    this.triggerAwarenessUpdate?.();
  }

  setDataDebounced(data: T) {
    this.debouncedOnChange(data);
  }

  /**
   * Resets the element to its default state.
   */
  reset() {
    this.setData(this.defaultData);
  }
}
