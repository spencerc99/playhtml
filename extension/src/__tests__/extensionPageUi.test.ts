// ABOUTME: Verifies recognition of the extension's injected page UI and typing detection.
// ABOUTME: Covers shortcuts typed into shadow-root inputs.

import { afterEach, describe, expect, it } from "vitest";
import {
  isExtensionPageUi,
  isTypingEvent,
  registerExtensionShadowRoot,
} from "../features/extensionPageUi";

/** Dispatches a keydown from `target` and reads it at the window, mid-dispatch. */
function keydownAtWindow(target: HTMLElement): {
  target: EventTarget | null;
  typing: boolean;
} {
  let seen: { target: EventTarget | null; typing: boolean } | null = null;
  const listener = (event: Event) => {
    seen = { target: event.target, typing: isTypingEvent(event) };
  };
  window.addEventListener("keydown", listener);
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "f", bubbles: true, composed: true }),
  );
  window.removeEventListener("keydown", listener);
  if (!seen) throw new Error("keydown did not reach the window");
  return seen;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isExtensionPageUi", () => {
  it("recognizes extension hosts and peer cursors but not page content", () => {
    const host = document.createElement("div");
    host.id = "we-were-online-bottles";
    const cursor = document.createElement("div");
    cursor.className = "playhtml-cursor-other";
    const label = document.createElement("span");
    cursor.append(label);
    const article = document.createElement("article");
    document.body.append(host, cursor, article);

    expect(isExtensionPageUi(host)).toBe(true);
    expect(isExtensionPageUi(label)).toBe(true);
    expect(isExtensionPageUi(article)).toBe(false);
  });
});

describe("isTypingEvent", () => {
  it("sees a focused input inside an open shadow root", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.append(input);
    document.body.append(host);

    expect(keydownAtWindow(input).typing).toBe(true);
  });

  it("sees a focused input inside a registered closed extension shadow root", () => {
    const host = document.createElement("div");
    host.id = "wewere-chat-panel-host";
    const shadow = host.attachShadow({ mode: "closed" });
    const input = document.createElement("input");
    shadow.append(input);
    document.body.append(host);
    const unregister = registerExtensionShadowRoot(host, shadow);
    try {
      input.focus();
      const seen = keydownAtWindow(input);
      expect(seen.target).toBe(host);
      expect(seen.typing).toBe(true);
    } finally {
      unregister();
    }
  });

  it("is false for keys pressed on ordinary page content", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(keydownAtWindow(button).typing).toBe(false);
  });
});
