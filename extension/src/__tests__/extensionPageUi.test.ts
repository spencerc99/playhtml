// ABOUTME: Verifies recognition of the extension's injected page UI and typing detection.
// ABOUTME: Covers bottle layout mutation filtering and shortcuts typed into shadow-root inputs.

import { afterEach, describe, expect, it } from "vitest";
import {
  isExtensionPageUi,
  isTypingEvent,
  registerExtensionShadowRoot,
} from "../features/extensionPageUi";
import { movesPageLayout } from "../components/BottleOverlay";

async function collectMutations(change: () => void): Promise<MutationRecord[]> {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(document.body, { childList: true, subtree: true });
  change();
  await Promise.resolve();
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records;
}

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

describe("movesPageLayout", () => {
  it("ignores mutations inside peer cursors and extension hosts", async () => {
    const cursor = document.createElement("div");
    cursor.className = "playhtml-cursor-other";
    document.body.append(cursor);

    const records = await collectMutations(() => {
      cursor.append(document.createElement("span"));
      const host = document.createElement("div");
      host.id = "wewere-chat-panel-host";
      document.body.append(host);
    });

    expect(records.length).toBeGreaterThan(0);
    expect(records.some(movesPageLayout)).toBe(false);
  });

  it("counts mutations to the page's own content", async () => {
    const article = document.createElement("article");
    document.body.append(article);

    const records = await collectMutations(() => {
      article.append(document.createElement("p"));
    });

    expect(records.some(movesPageLayout)).toBe(true);
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
