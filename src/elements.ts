/// <reference lib="dom"/>

export class SpinElement {
  element: HTMLElement;
  isDown: boolean;
  startX: number;
  rotation: number;

  constructor(element: HTMLElement) {
    this.element = element;
    this.isDown = false;
    this.startX = 0;
    this.rotation = 0;

    this.element.addEventListener("mousedown", (e) => this.mouseDownHandler(e));
    // TODO: probably should accumulate these and then put them all in one big one to avoid so many listeners
    document.addEventListener("mousemove", (e) => this.mouseMoveHandler(e));
    document.addEventListener("mouseup", (e) => this.mouseUpHandler(e));
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
    this.element.style.transform = `rotate(${this.rotation}deg)`;
    this.startX = e.pageX;
  }

  mouseUpHandler(_e: MouseEvent) {
    this.isDown = false;
  }
}
