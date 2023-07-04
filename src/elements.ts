/// <reference lib="dom"/>
import { Position } from "./types";

const debounce = (fn: Function, ms = 300) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: any[]) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
};

// TODO: make all the other ones extend this and make it such that you never update the local state for the element without updating it in the server and updating the downstream element effect.
// lol i really need a reactive db rn... like riffle.
export abstract class BaseElement<T> {
  element: HTMLElement;
  _data: T;
  onChange: (data: T) => void;
  debouncedOnChange: (data: T) => void;

  // TODO: fix this optional thing
  constructor(element: HTMLElement, data: T, onChange: (data: T) => void) {
    this.element = element;
    this.onChange = onChange;
    this.debouncedOnChange = debounce(this.onChange, 25);
    this._data = data;
    this.data = data;
  }

  get data(): T {
    return this._data;
  }

  set data(data: T) {
    this._data = data;
    this.updateElement(data);
    this.debouncedOnChange(data);
    // this.onChange(data);
  }

  abstract updateElement(data: T): void;
}

export class SpinElement extends BaseElement<number> {
  isDown: boolean;
  startX: number;

  constructor(
    element: HTMLElement,
    rotation: number = 0,
    onChange: (rotation: number) => void
  ) {
    super(element, rotation, onChange);
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

// TODO: need to figure out how to resolve between px movement and % movement
export class MoveElement extends BaseElement<Position> {
  isDown: boolean;
  startMouseX: number;
  startMouseY: number;

  constructor(
    element: HTMLElement,
    position: Position = { x: 0, y: 0 },
    onChange: (position: Position) => void
  ) {
    super(element, position, onChange);
    this.isDown = false;
    this.startMouseX = 0;
    this.startMouseY = 0;

    this.element.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    // TODO: probably should accumulate these and then put them all in one big one to avoid so many listeners
    document.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    document.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
  }

  updateElement({ x, y }: Position): void {
    this.element.style.transform = `translate(${x}px, ${y}px)`;
  }

  mouseDownHandler(e: MouseEvent) {
    this.isDown = true;
    // TODO: some bug when swapping between diff size screens, prob need to account for the last basis?
    this.startMouseX = e.clientX;
    this.startMouseY = e.clientY;
  }

  mouseMoveHandler(e: MouseEvent) {
    if (!this.isDown) return;
    // console.log("mouseX", e.clientX, "mouseY", e.clientY);
    // console.log("startX", this.startMouseX, "startY", this.startMouseY);
    // console.log("x", this.data.x, "y", this.data.y);

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
    super(element, scale, onChange);
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
