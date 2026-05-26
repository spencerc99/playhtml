// ABOUTME: Tests for chat-echo-renderer — bubble lifecycle, dedupe per pid, 3s expiry.
// ABOUTME: Bubbles are inside a closed shadow root; we query the shadow root directly.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChatEchoRenderer } from "../features/chat-echo-renderer";

function makeFakeCursorClient(positions: Record<string, { x: number; y: number }>) {
  return {
    getCursorPresences: () => {
      const m = new Map();
      for (const [pid, pos] of Object.entries(positions)) {
        m.set(pid, {
          cursor: { x: pos.x, y: pos.y, pointer: "mouse" },
          playerIdentity: { publicKey: pid },
        });
      }
      return m;
    },
  };
}

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

function queryBubbles(): NodeListOf<Element> {
  const host = document.getElementById("wewere-chat-echo-host");
  if (!host) return document.querySelectorAll("__never__");
  const shadow = (host as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot;
  if (!shadow) {
    return host.querySelectorAll("[data-chat-echo]");
  }
  return shadow.querySelectorAll("[data-chat-echo]");
}

describe("ChatEchoRenderer", () => {
  let renderer: ChatEchoRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    clearBody();
  });

  afterEach(() => {
    renderer?.destroy();
    vi.useRealTimers();
  });

  it("creates a bubble for an echo and removes it after 3s", () => {
    const cursorClient = makeFakeCursorClient({ "peer-1": { x: 100, y: 100 } });
    renderer = new ChatEchoRenderer(cursorClient);
    renderer.setEcho("peer-1", "hello", "#4a9a8a");
    expect(queryBubbles().length).toBe(1);
    vi.advanceTimersByTime(3100);
    vi.runOnlyPendingTimers();
    expect(queryBubbles().length).toBe(0);
  });

  it("replaces a prior echo for the same pid (resets timer)", () => {
    const cursorClient = makeFakeCursorClient({ "peer-1": { x: 100, y: 100 } });
    renderer = new ChatEchoRenderer(cursorClient);
    renderer.setEcho("peer-1", "first", "#4a9a8a");
    vi.advanceTimersByTime(2000);
    renderer.setEcho("peer-1", "second", "#4a9a8a");
    const bubbles = queryBubbles();
    expect(bubbles.length).toBe(1);
    expect(bubbles[0].textContent).toBe("second");
    vi.advanceTimersByTime(2000);
    vi.runOnlyPendingTimers();
    expect(queryBubbles().length).toBe(1);
    vi.advanceTimersByTime(1100);
    vi.runOnlyPendingTimers();
    expect(queryBubbles().length).toBe(0);
  });

  it("no-ops silently when the pid has no cursor presence", () => {
    const cursorClient = makeFakeCursorClient({});
    renderer = new ChatEchoRenderer(cursorClient);
    renderer.setEcho("missing-peer", "hello", "#c4724e");
    expect(queryBubbles().length).toBe(0);
  });

  it("destroy removes the shadow host from the document", () => {
    const cursorClient = makeFakeCursorClient({ "peer-1": { x: 100, y: 100 } });
    renderer = new ChatEchoRenderer(cursorClient);
    renderer.setEcho("peer-1", "hi", "#000");
    expect(document.getElementById("wewere-chat-echo-host")).not.toBeNull();
    renderer.destroy();
    expect(document.getElementById("wewere-chat-echo-host")).toBeNull();
  });
});
