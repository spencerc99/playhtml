// ABOUTME: Tests CursorChat's document event and DOM cleanup lifecycle.
// ABOUTME: Covers teardown and recreation without stale chat resources.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorChat } from "../chat";

function dispatchKey(key: string): boolean {
  return document.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.querySelectorAll("style").forEach((style) => style.remove());
});

describe("CursorChat", () => {
  it("releases its document listener, timer, UI, and styles when destroyed", () => {
    vi.useFakeTimers();
    const onMessageUpdate = vi.fn();
    const chat = new CursorChat({ onMessageUpdate });

    expect(document.body.querySelector(".playhtml-chat-container")).not.toBeNull();
    expect(document.head.querySelectorAll("style")).toHaveLength(1);

    expect(dispatchKey("/")).toBe(false);
    expect(dispatchKey("h")).toBe(false);
    expect(onMessageUpdate).toHaveBeenLastCalledWith("h");
    const callbackCountBeforeDestroy = onMessageUpdate.mock.calls.length;

    chat.destroy();
    chat.destroy();

    expect(document.body.querySelector(".playhtml-chat-container")).toBeNull();
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
    expect(dispatchKey("/")).toBe(true);
    expect(dispatchKey("h")).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(onMessageUpdate).toHaveBeenCalledTimes(callbackCountBeforeDestroy);
  });

  it("does not stack listeners or styles across recreation cycles", () => {
    const firstMessageUpdate = vi.fn();
    const firstChat = new CursorChat({ onMessageUpdate: firstMessageUpdate });
    firstChat.destroy();

    const secondMessageUpdate = vi.fn();
    const secondChat = new CursorChat({ onMessageUpdate: secondMessageUpdate });

    expect(document.body.querySelectorAll(".playhtml-chat-container")).toHaveLength(1);
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    expect(dispatchKey("/")).toBe(false);
    expect(dispatchKey("h")).toBe(false);
    expect(firstMessageUpdate).not.toHaveBeenCalled();
    expect(secondMessageUpdate).toHaveBeenLastCalledWith("h");

    secondChat.destroy();
  });
});
