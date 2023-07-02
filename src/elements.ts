/// <reference lib="dom"/>
import { Position } from "./types";

// TODO: make all the other ones extend this and make it such that you never update the local state for the element without updating it in the server and updating the downstream element effect.
// lol i really need a reactive db rn... like riffle.
interface BaseElement<T> {
  data: T;
  setData: (data: T) => void;
  updateElement: (data: T) => void;
}

export class SpinElement {
  element: HTMLElement;
  isDown: boolean;
  startX: number;
  _rotation: number = 0;
  onChange: (rotation: number) => void;

  constructor(
    element: HTMLElement,
    rotation: number,
    onChange: (rotation: number) => void
  ) {
    this.element = element;
    this.isDown = false;
    this.startX = 0;
    this.onChange = onChange;
    this.rotation = rotation;

    this.element.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    // TODO: probably should accumulate these and then put them all in one big one to avoid so many listeners
    document.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    document.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
  }

  get rotation(): number {
    return this._rotation;
  }

  set rotation(rotation: number) {
    this._rotation = rotation;
    this.element.style.transform = `rotate(${rotation}deg)`;
    this.onChange(rotation);
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
      this.rotation += distance; // Change rotation proportional to the distance moved
    } else if (e.pageX < this.startX) {
      // Move left
      this.rotation -= distance; // Change rotation proportional to the distance moved
    }

    this.startX = e.pageX;
  }

  mouseUpHandler(_e: MouseEvent) {
    this.isDown = false;
  }
}

function setTranslate({ x, y }: Position, el: HTMLElement) {
  el.style.transform = `translate(${x}px, ${y}px)`;
}

// TODO: need to figure out how to resolve between px movement and % movement
export class MoveElement {
  element: HTMLElement;
  isDown: boolean;
  startMouseX: number;
  startMouseY: number;
  _position: Position = { x: 0, y: 0 };
  onChange: (position: Position) => void;

  constructor(
    element: HTMLElement,
    position: Position,
    onChange: (position: Position) => void
  ) {
    this.element = element;
    this.isDown = false;
    this.startMouseX = 0;
    this.startMouseY = 0;
    this.onChange = onChange;
    this.position = position;

    this.element.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    // TODO: probably should accumulate these and then put them all in one big one to avoid so many listeners
    document.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    document.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
  }

  get position(): Position {
    return this._position;
  }

  set position(position: Position) {
    this._position = position;
    setTranslate(position, this.element);
    this.onChange(position);
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
    this.position = {
      x: this.position.x + e.clientX - this.startMouseX,
      y: this.position.y + e.clientY - this.startMouseY,
    };

    this.startMouseX = e.clientX;
    this.startMouseY = e.clientY;
  }

  mouseUpHandler(_e: MouseEvent) {
    this.isDown = false;
  }
}
