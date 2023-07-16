/// <reference lib="dom"/>
import { Position, TagType } from "./types";

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

interface AdvancedOptions {
  debounceMs?: number;
  resetShortcut?: ModifierKey;
}

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
export abstract class BaseElement<T> {
  element: HTMLElement;
  abstract initialData: T;
  _data: T;
  onChange: (data: T) => void;
  debouncedOnChange: (data: T) => void;
  resetShortcut?: ModifierKey;

  constructor(
    element: HTMLElement,
    data: T,
    onChange: (data: T) => void,
    { debounceMs = 100, resetShortcut }: AdvancedOptions
  ) {
    this.element = element;
    this.onChange = onChange;
    this.resetShortcut = resetShortcut;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this._data = data;
    this.__data = data;

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
    this.updateElement(data);
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
   * Updates the element to reflect the new data (e.g. updating the style and functionality)
   */
  abstract updateElement(data: T): void;
  /**
   * Resets the element to its default state.
   */
  reset() {
    this.data = this.initialData;
  }
}

export class SpinElement extends BaseElement<number> {
  isDown: boolean;
  startX: number;
  initialData: number = 0;

  constructor(
    element: HTMLElement,
    rotation: number = 0,
    onChange: (rotation: number) => void
  ) {
    super(element, rotation, onChange, { resetShortcut: "shiftKey" });
    this.isDown = false;
    this.startX = 0;

    this.element.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    // TODO: probably should accumulate these and then put them all in one big one to avoid so many listeners
    document.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    document.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
  }

  updateElement(rotation: number): void {
    this.element.style.transform = `rotate(${rotation}deg)`;
  }

  mouseDownHandler(e: MouseEvent) {
    this.isDown = true;
    this.startX = e.pageX;
  }

  mouseMoveHandler(e: MouseEvent) {
    if (!this.isDown) return;
    e.preventDefault();
    // Calculate distance mouse has moved from the last known position
    // TODO: scale this according to size
    let distance = Math.abs(e.pageX - this.startX) * 2;

    if (e.pageX > this.startX) {
      // Move right
      this.data += distance; // Change rotation proportional to the distance moved
    } else if (e.pageX < this.startX) {
      // Move left
      this.data -= distance; // Change rotation proportional to the distance moved
    }

    this.startX = e.pageX;
  }

  mouseUpHandler(_e: MouseEvent) {
    this.isDown = false;
  }
}

export class MoveElement extends BaseElement<Position> {
  initialData: Position = { x: 0, y: 0 };
  isDown: boolean;
  startMouseX: number;
  startMouseY: number;

  constructor(
    element: HTMLElement,
    position: Position = { x: 0, y: 0 },
    onChange: (position: Position) => void
  ) {
    super(element, position, onChange, { resetShortcut: "shiftKey" });
    this.isDown = false;
    this.startMouseX = 0;
    this.startMouseY = 0;
    // TODO: this needs to reset the display otherwise it won't always work (ex with inline elements)
    this.updateDisplay();

    this.element.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    // TODO: probably should accumulate these and then put them all in one big one to avoid so many listeners
    document.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    document.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
  }

  updateDisplay() {
    if (this.element.style.display === "inline") {
      this.element.style.display = "inline-block";
    }
  }

  updateElement({ x, y }: Position): void {
    this.element.style.transform = `translate(${x}px, ${y}px)`;
  }

  mouseDownHandler(e: MouseEvent) {
    this.isDown = true;
    this.startMouseX = e.clientX;
    this.startMouseY = e.clientY;
  }

  mouseMoveHandler(e: MouseEvent) {
    if (!this.isDown) return;

    e.preventDefault();
    // Calculate distance mouse has moved from the last known position
    this.data = {
      x: this.data.x + e.clientX - this.startMouseX,
      y: this.data.y + e.clientY - this.startMouseY,
    };

    this.startMouseX = e.clientX;
    this.startMouseY = e.clientY;
  }

  mouseUpHandler(_e: MouseEvent) {
    this.isDown = false;
  }
}

export class GrowElement extends BaseElement<number> {
  initialData: number = 1;
  maxScale: number;
  readonly originalCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='44' height='53' viewport='0 0 100 100' style='fill:black;font-size:26px;'><text y='40%'>🚿</text></svg>")
      16 0,
    auto`;
  readonly cutCursor: string = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'  width='40' height='48' viewport='0 0 100 100' style='fill:black;font-size:24px;'><text y='50%'>✂️</text></svg>") 16 0,auto`;
  isHovering: boolean = false;

  constructor(
    element: HTMLElement,
    scale: number = 1,
    onChange: (scale: number) => void,
    maxScale: number = 2
  ) {
    super(element, scale, onChange, { resetShortcut: "shiftKey" });
    this.maxScale = maxScale;
    element.addEventListener("mouseenter", (e) => this.mouseOverHandler(e));
    element.addEventListener("mouseout", (e) => {
      this.isHovering = false;
    });
    element.addEventListener("click", (e) => this.clickHandler(e));
    document.addEventListener("keydown", (e) => {
      if (!this.isHovering) return;

      this.mouseOverHandler(e);
    });
    document.addEventListener("keyup", (e) => {
      if (!this.isHovering) return;

      this.mouseOverHandler(e);
    });
  }

  updateElement(data: number): void {
    this.element.style.transform = `scale(${data})`;
  }

  mouseOverHandler(e: MouseEvent | KeyboardEvent) {
    this.isHovering = true;
    if (e.altKey) {
      if (this.data <= 0.5) {
        this.element.style.cursor = "not-allowed";
        return;
      }
      this.element.style.cursor = this.cutCursor;
    } else {
      if (this.data >= this.maxScale) {
        this.element.style.cursor = "not-allowed";
        return;
      }
      this.element.style.cursor = this.originalCursor;
    }
  }

  clickHandler(e: MouseEvent) {
    if (e.altKey) {
      // shrink
      if (this.data <= 0.5) {
        return;
      }

      this.data -= 0.1;
    } else {
      // grow
      this.element.style.cursor = this.originalCursor;
      if (this.data >= this.maxScale) {
        return;
      }

      this.data += 0.1;
    }
  }
}

export class DrawElement extends BaseElement<string[]> {
  initialData: string[] = [];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  isDown: boolean = false;
  radius: number = 10;
  lastDrewActionIdx: number = -1;
  canvasX: number = 0;
  canvasY: number = 0;
  debouncedSaveCanvas: () => void;
  appliedActions: Set<string> = new Set();

  constructor(
    element: HTMLElement,
    data: string[] = [],
    onChange: (data: string[]) => void
  ) {
    const div = document.createElement("div");
    div.classList.add("__playhtml-draw-container");
    const canvas = document.createElement("canvas");
    // TODO: this needs to update if the underlying element ever changes
    canvas.height = element.getBoundingClientRect().height;
    canvas.width = element.getBoundingClientRect().width;
    div.appendChild(canvas);
    element.appendChild(div);

    super(element, data, onChange, { resetShortcut: "shiftKey" });

    this.debouncedSaveCanvas = debounce(() => {
      this.saveCanvas();
    }, 1000);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    canvas.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    canvas.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
  }

  async updateElement(data: string[]): Promise<void> {
    // TODO: take diff of data arrays. handle deletions
    const canvas: HTMLCanvasElement = this.element.querySelector(
      ".__playhtml-draw-container canvas"
    )!;

    const ctx = canvas.getContext("2d")!;
    for (const action of data) {
      if (this.appliedActions.has(action)) continue;

      var canvasPic = new Image();
      canvasPic.src = action;
      await canvasPic.decode();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(canvasPic, 0, 0);
      this.appliedActions.add(action);
    }
  }

  get canvasPosition() {
    return this.canvas.getBoundingClientRect();
  }

  mouseDownHandler(e: MouseEvent) {
    this.isDown = true;
    this.ctx.lineWidth = 1;

    this.ctx.beginPath();
    const { x, y } = this.canvasPosition;
    this.canvasX = e.pageX - x;
    this.canvasY = e.pageY - y;
    this.ctx.moveTo(this.canvasX, this.canvasY);
  }

  mouseMoveHandler(e: MouseEvent) {
    if (!this.isDown) return;
    const { x, y } = this.canvasPosition;

    this.canvasX = e.clientX - x;
    this.canvasY = e.clientY - y;
    this.ctx.lineTo(this.canvasX, this.canvasY);
    this.ctx.strokeStyle = "#000";
    this.ctx.stroke();
    this.debouncedSaveCanvas();
  }

  mouseUpHandler(_e: MouseEvent) {
    this.isDown = false;
    this.ctx.closePath();
    this.saveCanvas();
  }

  saveCanvas() {
    // if want to support redo, need to save index and then reset and pop redos when
    // new action.
    this.data = [...this.data, this.canvas.toDataURL()];
    this.appliedActions.add(this.canvas.toDataURL());
    this.lastDrewActionIdx++;
  }
}

export class ClickElement extends BaseElement<string> {
  initialData: string = "";
  key: string;

  constructor(
    element: HTMLElement,
    data: string,
    onChange: (data: string) => void,
    key: string
  ) {
    super(element, data, onChange, {
      resetShortcut: "shiftKey",
    });
    this.key = key;
    element.addEventListener("click", (e) => this.clickHandler(e));
    // TODO: fix this inheritance thing ugh
    this.__data = data;
  }

  updateElement(data: string): void {
    this.element.style.setProperty(this.key, data);
  }

  clickHandler(e: MouseEvent) {
    this.element.style.removeProperty(this.key);
    this.element.classList.toggle("clicked");
    this.data = getComputedStyle(this.element).getPropertyValue(this.key);
  }
}

/**
 * ToggleElement is a special case of ClickElement where the data is a boolean
 * and the element is toggled on and off. Relies on the element having a
 * "clicked" class, which is toggled by the user.
 */
export class ToggleElement extends BaseElement<boolean> {
  initialData: boolean = false;

  constructor(
    element: HTMLElement,
    data: boolean,
    onChange: (data: boolean) => void
  ) {
    super(element, data, onChange, {
      resetShortcut: "shiftKey",
    });
    element.addEventListener("click", (e) => this.clickHandler(e));
  }

  updateElement(data: boolean): void {
    this.element.classList.toggle("clicked", data);
  }

  clickHandler(e: MouseEvent) {
    this.data = !this.data;
  }
}

interface ElementInitializer<T = any> {
  initialData: T;
  updateElement: (element: Element, data: T) => void;

  // Event handlers
  // TODO: what happens if you return undefined? should that register a change?
  onClick?: (e: MouseEvent, data: T) => T;
  onDrag?: (e: MouseEvent, data: T) => T;

  // Advanced settings
  resetShortcut?: ModifierKey;
  debounceMs?: number;
}

export interface ElementData<T = any> extends ElementInitializer<T> {
  element: HTMLElement;
  onChange: (data: T) => void;
}

interface SyncData<T> {
  selector: string;
  data: T;
}

export const TagTypeToElement: Record<TagType, ElementInitializer> = {
  [TagType.CanToggle]: {
    initialData: false,
    updateElement: (element: Element, data: boolean) => {
      element.classList.toggle("clicked", data);
    },
    onClick: (e: MouseEvent, data: boolean) => {
      return !data;
    },
    resetShortcut: "shiftKey",
  },
};

// const ClickElementData = {
//   onClick: (e: MouseEvent, data: boolean) => {
//     this.element.classList.toggle("clicked");
//   },
// };

export class ElementHandler<T = any> {
  initialData: T;
  element: HTMLElement;
  _data: T;
  onChange: (data: T) => void;
  debouncedOnChange: (data: T) => void;
  resetShortcut?: ModifierKey;
  updateElement: (element: Element, data: T) => void;

  constructor({
    element,
    onChange,
    initialData,
    updateElement,
    onClick,
    resetShortcut,
    debounceMs,
  }: ElementData<T>) {
    this.element = element;
    this.initialData = initialData;
    this.onChange = onChange;
    this.resetShortcut = resetShortcut;
    this.debouncedOnChange = debounce(this.onChange, debounceMs);
    this.updateElement = updateElement;
    // Needed to get around the typescript error even though it is assigned in __data.
    this._data = initialData;
    this.__data = initialData;

    // Handle all the event handlers
    if (onClick) {
      element.addEventListener("click", (e) => {
        const newData = onClick(e, this.data);
        if (newData !== undefined) {
          this.data = newData;
        }
      });
    }

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
    this.data = this.initialData;
  }
}
