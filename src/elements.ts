/// <reference lib="dom"/>
import { Position } from "./types";

// TODO: make all the other ones extend this and make it such that you never update the local state for the element without updating it in the server and updating the downstream element effect.
// lol i really need a reactive db rn... like riffle.
export abstract class BaseElement<T> {
  element: HTMLElement;
  abstract _data: T;
  onChange: (data: T) => void;

  constructor(element: HTMLElement, data: T, onChange: (data: T) => void) {
    this.element = element;
    this.onChange = onChange;
    this.data = data;
  }

  get data(): T {
    return this._data;
  }

  set data(data: T) {
    this._data = data;
    this.updateElement(data);
    this.onChange(data);
  }

  abstract updateElement(data: T): void;
}

export class SpinElement extends BaseElement<number> {
  _data = 0;
  isDown: boolean;
  startX: number;

  constructor(
    element: HTMLElement,
    rotation: number,
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
  _data: Position = { x: 0, y: 0 };
  isDown: boolean;
  startMouseX: number;
  startMouseY: number;

  constructor(
    element: HTMLElement,
    position: Position,
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
