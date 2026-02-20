import { vi } from "vitest";

/**
 * Test utilities for simulating browser events and time advancement
 */

/**
 * Simulate a mouse move event
 */
export function simulateMouseMove(
  x: number,
  y: number,
  target?: HTMLElement
): MouseEvent {
  const event = new MouseEvent("mousemove", {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
  
  if (target) {
    Object.defineProperty(event, "target", {
      value: target,
      writable: false,
    });
  }
  
  document.dispatchEvent(event);
  return event;
}

/**
 * Simulate a mouse down event
 */
export function simulateMouseDown(
  x: number,
  y: number,
  button: number = 0,
  target?: HTMLElement
): MouseEvent {
  const event = new MouseEvent("mousedown", {
    clientX: x,
    clientY: y,
    button,
    bubbles: true,
    cancelable: true,
  });
  
  if (target) {
    Object.defineProperty(event, "target", {
      value: target,
      writable: false,
    });
  }
  
  document.dispatchEvent(event);
  return event;
}

/**
 * Simulate a mouse up event
 */
export function simulateMouseUp(
  x: number,
  y: number,
  button: number = 0,
  target?: HTMLElement
): MouseEvent {
  const event = new MouseEvent("mouseup", {
    clientX: x,
    clientY: y,
    button,
    bubbles: true,
    cancelable: true,
  });
  
  if (target) {
    Object.defineProperty(event, "target", {
      value: target,
      writable: false,
    });
  }
  
  document.dispatchEvent(event);
  return event;
}

/**
 * Simulate a click (mousedown + mouseup with optional delay)
 */
export async function simulateClick(
  x: number,
  y: number,
  holdMs: number = 0,
  button: number = 0,
  target?: HTMLElement
): Promise<void> {
  simulateMouseDown(x, y, button, target);
  
  if (holdMs > 0) {
    await advanceTime(holdMs);
  }
  
  simulateMouseUp(x, y, button, target);
}

/**
 * Simulate a drag (dragstart + dragend)
 */
export function simulateDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  target?: HTMLElement
): void {
  const dragStartEvent = new DragEvent("dragstart", {
    clientX: startX,
    clientY: startY,
    bubbles: true,
    cancelable: true,
  });
  
  const dragEndEvent = new DragEvent("dragend", {
    clientX: endX,
    clientY: endY,
    bubbles: true,
    cancelable: true,
  });
  
  if (target) {
    Object.defineProperty(dragStartEvent, "target", {
      value: target,
      writable: false,
    });
    Object.defineProperty(dragEndEvent, "target", {
      value: target,
      writable: false,
    });
  }
  
  document.dispatchEvent(dragStartEvent);
  document.dispatchEvent(dragEndEvent);
}

/**
 * Simulate a scroll event
 */
export function simulateScroll(x: number, y: number): void {
  window.scrollX = x;
  window.scrollY = y;
  document.documentElement.scrollLeft = x;
  document.documentElement.scrollTop = y;
  
  const event = new Event("scroll", {
    bubbles: true,
    cancelable: true,
  });
  
  window.dispatchEvent(event);
}

/**
 * Simulate a window resize
 */
export function simulateResize(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    writable: true,
    configurable: true,
  });
  
  Object.defineProperty(window, "innerHeight", {
    value: height,
    writable: true,
    configurable: true,
  });
  
  const event = new Event("resize", {
    bubbles: true,
    cancelable: true,
  });
  
  window.dispatchEvent(event);
}

/**
 * Advance time using fake timers
 */
export async function advanceTime(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  // Allow microtasks to run
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Create a test element with specific attributes
 */
export function createTestElement(
  tag: string = "div",
  options: {
    id?: string;
    className?: string;
    cursor?: string;
    textContent?: string;
  } = {}
): HTMLElement {
  const element = document.createElement(tag);
  
  if (options.id) {
    element.id = options.id;
  }
  
  if (options.className) {
    element.className = options.className;
  }
  
  if (options.cursor) {
    element.dataset.cursor = options.cursor;
  }
  
  if (options.textContent) {
    element.textContent = options.textContent;
  }
  
  document.body.appendChild(element);
  return element;
}

/**
 * Wait for next tick
 */
export function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
