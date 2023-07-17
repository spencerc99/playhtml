/// <reference lib="dom"/>
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

// TODO: these probably need to use localStorage for certain things that are big..
function retrieveElementData(element: HTMLElement, key: string): any {
  return JSON.parse(element.dataset[key] || "null");
}

function setElementData(element: HTMLElement, key: string, value: any): void {
  element.dataset[key] = JSON.stringify(value);
}

// TODO: should be able to have set of allowable elements
// TODO: should be able to accept arbitrary input? (like max/min)
// TODO: should be able to add permission conditions?
interface ElementInitializer<T = any> {
  defaultData: T;
  updateElement: (element: HTMLElement, data: T) => void;

  // Event handlers
  // TODO: what happens if you return undefined? should that register a change?
  onClick?: (e: MouseEvent, data: T, element: HTMLElement) => T;
  onDrag?: (e: MouseEvent, data: T, element: HTMLElement) => T;
  onDragStart?: (e: MouseEvent, data: T, element: HTMLElement) => T;
  onMouseEnter?: (e: MouseEvent, data: T, element: HTMLElement) => T;
  onKeyDown?: (e: KeyboardEvent, data: T, element: HTMLElement) => T;
  onKeyUp?: (e: KeyboardEvent, data: T, element: HTMLElement) => T;

  // Advanced settings
  resetShortcut?: ModifierKey;
  debounceMs?: number;
}

export interface ElementData<T = any> extends ElementInitializer<T> {
  // localData and sharedData interfaces?
  data?: T;
  element: HTMLElement;
  onChange: (data: T) => void;
}

interface ElementEventHandlerData<T = any, U = any> {
  data: T;
  localData: U;
  element: HTMLElement;
  setData: (data: T) => void;
  setLocalData: (data: U) => void;
}

interface SyncData<T> {
  selector: string;
  data: T;
}

const growCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='44' height='53' viewport='0 0 100 100' style='fill:black;font-size:26px;'><text y='40%'>🚿</text></svg>")
      16 0,
    auto`;
const cutCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='40' height='48' viewport='0 0 100 100' style='fill:black;font-size:24px;'><text y='50%'>✂️</text></svg>") 16 0,auto`;
function canGrowCursorHandler(
  e: MouseEvent | KeyboardEvent,
  data: GrowData,
  element: HTMLElement
) {
  data.isHovering = true;
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

  return { ...data };
}

export const TagTypeToElement: Record<
  Exclude<TagType, "can-play">,
  ElementInitializer
> = {
  [TagType.CanMove]: {
    defaultData: { x: 0, y: 0, startMouseX: 0, startMouseY: 0 } as MoveData,
    updateElement: (element: HTMLElement, data: MoveData) => {
      element.style.transform = `translate(${data.x}px, ${data.y}px)`;
    },
    onDragStart: (e: MouseEvent, data: MoveData) => {
      return {
        ...data,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
      };
    },
    onDrag: (e: MouseEvent, data: MoveData) => {
      return {
        x: data.x + e.clientX - data.startMouseX,
        y: data.y + e.clientY - data.startMouseY,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
      };
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanSpin]: {
    defaultData: { rotation: 0, startMouseX: 0 } as SpinData,
    updateElement: (element: HTMLElement, data: SpinData) => {
      element.style.transform = `rotate(${data.rotation}deg)`;
    },
    onDragStart: (e: MouseEvent, data: SpinData) => {
      return {
        ...data,
        startMouseX: e.clientX,
      };
    },
    onDrag: (e: MouseEvent, data: SpinData) => {
      // Calculate distance mouse has moved from the last known position
      // TODO: scale this according to size
      let distance = Math.abs(e.pageX - data.startMouseX) * 2;
      let rotation = data.rotation;

      if (e.pageX > data.startMouseX) {
        // Move right
        rotation += distance; // Change rotation proportional to the distance moved
      } else if (e.pageX < data.startMouseX) {
        // Move left
        rotation -= distance; // Change rotation proportional to the distance moved
      }

      return {
        rotation,
        startMouseX: e.pageX,
      };
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanToggle]: {
    defaultData: false,
    updateElement: (element: HTMLElement, data: boolean) => {
      element.classList.toggle("clicked", data);
    },
    onClick: (e: MouseEvent, data: boolean) => {
      return !data;
    },
    resetShortcut: "shiftKey",
  },
  [TagType.CanGrow]: {
    // TODO: turn this into a function so you can accept arbitrary user input?
    defaultData: { scale: 1, maxScale: 2, isHovering: false } as GrowData,
    updateElement: (element: HTMLElement, data: GrowData) => {
      element.style.transform = `scale(${data.scale})`;
    },
    onClick: (e: MouseEvent, data: GrowData, element: HTMLElement) => {
      if (e.altKey) {
        // shrink
        if (data.scale <= 0.5) {
          return;
        }

        data.scale -= 0.1;
      } else {
        // grow
        element.style.cursor = growCursor;
        if (data.scale >= data.maxScale) {
          return;
        }

        data.scale += 0.1;
      }
      return {
        ...data,
        scale: data.scale >= data.maxScale ? 1 : data.scale + 0.1,
      };
    },
    onMouseEnter: canGrowCursorHandler,
    onKeyDown: canGrowCursorHandler,
    onKeyUp: canGrowCursorHandler,
  },
};

export class ElementHandler<T = any> {
  defaultData: T;
  element: HTMLElement;
  _data: T;
  onChange: (data: T) => void;
  debouncedOnChange: (data: T) => void;
  resetShortcut?: ModifierKey;
  updateElement: (element: HTMLElement, data: T) => void;

  constructor({
    element,
    onChange,
    defaultData,
    data,
    updateElement,
    onClick,
    onDrag,
    onDragStart,
    onMouseEnter,
    onKeyDown,
    onKeyUp,
    resetShortcut,
    debounceMs,
  }: ElementData<T>) {
    this.element = element;
    this.defaultData = defaultData;
    this.onChange = onChange;
    this.resetShortcut = resetShortcut;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this.updateElement = updateElement;
    const initialData = data === undefined ? defaultData : data;
    // Needed to get around the typescript error even though it is assigned in __data.
    this._data = initialData;
    this.__data = initialData;

    // Handle all the event handlers
    if (onClick) {
      element.addEventListener("click", (e) => {
        const newData = onClick(e, this.data, this.element);
        if (newData !== undefined) {
          this.data = newData;
        }
      });
    }

    if (onDrag) {
      element.addEventListener("mousedown", (e) => {
        if (onDragStart) {
          // Need to be able to not persist everything in the data, causing some lag.
          const newData = onDragStart(e, this.data, this.element);
          if (newData !== undefined) {
            this.data = newData;
          }
        }

        const onMouseMove = (e: MouseEvent) => {
          e.preventDefault();
          const newData = onDrag(e, this.data, this.element);
          if (newData !== undefined) {
            this.data = newData;
          }
        };
        const onMouseUp = (e: MouseEvent) => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }

    if (onMouseEnter) {
      element.addEventListener("mouseenter", (e) => {
        const newData = onMouseEnter(e, this.data, this.element);
        if (newData !== undefined) {
          this.data = newData;
        }
      });
    }

    if (onKeyDown) {
      element.addEventListener("keydown", (e) => {
        const newData = onKeyDown(e, this.data, this.element);
        if (newData !== undefined) {
          this.data = newData;
        }
      });
    }

    if (onKeyUp) {
      element.addEventListener("keyup", (e) => {
        const newData = onKeyUp(e, this.data, this.element);
        if (newData !== undefined) {
          this.data = newData;
        }
      });
    }

    // Handle advanced settings
    if (resetShortcut) {
      if (!element.title) {
        element.title = `Hold down the ${ModifierKeyToName[resetShortcut]} key while clicking to reset.`;
      }
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

  /**
   * // PRIVATE USE ONLY \\
   *
   * Updates the internal state with the given data and handles all the downstream effects. Should only be used by the sync code to ensure one-way
   * reactivity.
   * (e.g. calling `updateElement` and `onChange`)
   */
  set __data(data: T) {
    this._data = data;
    this.updateElement(this.element, data);
  }

  // TODO: turn from setter into a method to allow for debouncing
  /**
   * Public-use setter for data that makes the change to all clients.
   */
  set data(data: T) {
    this.onChange(data);
  }

  setDataDebounced(data: T) {
    this.debouncedOnChange(data);
  }

  /**
   * Resets the element to its default state.
   */
  reset() {
    this.data = this.defaultData;
  }
}
