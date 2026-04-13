// ABOUTME: Resolves the CursorContainer option to an HTMLElement or null.
// ABOUTME: Called fresh each time — never caches — so stale refs don't occur.
import type { CursorContainer } from "../index";

export function resolveCursorContainer(
  container: CursorContainer | undefined,
): HTMLElement | null {
  if (container === undefined) return document.body;
  if (typeof container === "string") {
    return document.querySelector(container) as HTMLElement | null;
  }
  if (typeof container === "function") {
    return container();
  }
  return container;
}
