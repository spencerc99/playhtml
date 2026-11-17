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

    expect(
      document.body.querySelector(".playhtml-chat-container"),
    ).not.toBeNull();
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

  it("renders typed markup characters as literal text", () => {
    const chat = new CursorChat();

    dispatchKey("/");
    for (const key of "<b>a&amp;</b>") {
      dispatchKey(key);
    }

    const input = document.body.querySelector(".playhtml-chat-input");
    expect(input?.textContent).toBe("<b>a&amp;</b>");
    expect(input?.querySelector("b")).toBeNull();

    const closeButton = document.body.querySelector<HTMLElement>(
      ".playhtml-chat-button",
    );
    expect(closeButton?.textContent).toBe("×");
    closeButton?.click();
    expect(
      document.body.querySelector<HTMLElement>(".playhtml-chat-container")
        ?.style.display,
    ).toBe("none");

    chat.destroy();
  });

  it("does not stack listeners or styles across recreation cycles", () => {
    const firstMessageUpdate = vi.fn();
    const firstChat = new CursorChat({ onMessageUpdate: firstMessageUpdate });
    firstChat.destroy();

    const secondMessageUpdate = vi.fn();
    const secondChat = new CursorChat({ onMessageUpdate: secondMessageUpdate });

    expect(
      document.body.querySelectorAll(".playhtml-chat-container"),
    ).toHaveLength(1);
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    expect(dispatchKey("/")).toBe(false);
    expect(dispatchKey("h")).toBe(false);
    expect(firstMessageUpdate).not.toHaveBeenCalled();
    expect(secondMessageUpdate).toHaveBeenLastCalledWith("h");

    secondChat.destroy();
  });

  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    [
      "contenteditable child",
      () => {
        const editor = document.createElement("div");
        editor.setAttribute("contenteditable", "true");
        const child = document.createElement("span");
        editor.appendChild(child);
        return child;
      },
    ],
  ])("leaves keys typed into a host-page %s alone", (_label, makeTarget) => {
    vi.useFakeTimers();
    const onMessageUpdate = vi.fn();
    const chat = new CursorChat({ onMessageUpdate });
    const target = makeTarget();
    document.body.appendChild(target.closest("[contenteditable]") ?? target);

    for (const key of ["/", "h", "i"]) {
      const notCancelled = target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
      expect(notCancelled).toBe(true);
    }
    vi.advanceTimersByTime(10_000);

    expect(onMessageUpdate).not.toHaveBeenCalled();
    expect(
      document.body.querySelector<HTMLElement>(".playhtml-chat-container")
        ?.style.display,
    ).toBe("none");
    chat.destroy();
  });

  it("does not publish an idle clear for keys typed while chat is closed", () => {
    vi.useFakeTimers();
    const onMessageUpdate = vi.fn();
    const chat = new CursorChat({ onMessageUpdate });

    dispatchKey("a");
    dispatchKey("b");
    vi.advanceTimersByTime(10_000);

    expect(onMessageUpdate).not.toHaveBeenCalled();
    chat.destroy();
  });

  it("clears an open chat 10s after the last chat keystroke", () => {
    vi.useFakeTimers();
    const onMessageUpdate = vi.fn();
    const chat = new CursorChat({ onMessageUpdate });

    dispatchKey("/");
    dispatchKey("h");
    vi.advanceTimersByTime(9_000);
    dispatchKey("i");
    vi.advanceTimersByTime(9_000);
    expect(onMessageUpdate).toHaveBeenLastCalledWith("hi");
    vi.advanceTimersByTime(1_000);
    expect(onMessageUpdate).toHaveBeenLastCalledWith(null);
    chat.destroy();
  });
});
