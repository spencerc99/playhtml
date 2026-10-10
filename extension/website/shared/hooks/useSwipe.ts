// ABOUTME: Pointer handlers that turn a finger flick on an element into up, down, left or right.
// ABOUTME: Mouse presses are left alone, and a click that ends a swipe is swallowed so it does not also tap.

import { useRef, type PointerEvent, type MouseEvent } from "react";
import { swipeDirection, type SwipeDirection } from "../utils/swipe";

export type SwipeHandlers = Partial<Record<SwipeDirection, () => void>>;

interface SwipeStart {
  pointerId: number;
  x: number;
  y: number;
  at: number;
}

export function useSwipe(handlers: SwipeHandlers) {
  const start = useRef<SwipeStart | null>(null);
  const swiped = useRef(false);
  const latest = useRef(handlers);
  latest.current = handlers;

  return {
    onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      swiped.current = false;
      start.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: event.timeStamp,
      };
    },
    onPointerUp(event: PointerEvent) {
      const from = start.current;
      start.current = null;
      if (!from || from.pointerId !== event.pointerId) return;
      const direction = swipeDirection(
        event.clientX - from.x,
        event.clientY - from.y,
        event.timeStamp - from.at,
      );
      const handler = direction ? latest.current[direction] : undefined;
      if (!handler) return;
      swiped.current = true;
      handler();
    },
    onPointerCancel() {
      start.current = null;
    },
    onClickCapture(event: MouseEvent) {
      if (!swiped.current) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
