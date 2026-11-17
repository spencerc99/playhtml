// ABOUTME: Tests the Wikipedia chat echo de-duplication and follower link-click filter.
// ABOUTME: Echoes show each message once; only plain left clicks are delayed for followers.

import { describe, expect, it } from "vitest";
import {
  createChatEchoTracker,
  isPlainPrimaryClick,
} from "../custom-sites/wikipedia";

function chatPresence(id: string, text: string) {
  return { chat: { id, text } };
}

describe("createChatEchoTracker", () => {
  it("does not echo messages that peers already held when the page loaded", () => {
    const take = createChatEchoTracker();
    expect(take(new Map([["peer-a", chatPresence("m1", "hello")]]))).toEqual([]);
  });

  it("echoes a new message once even when later batches still carry it", () => {
    const take = createChatEchoTracker();
    take(new Map([["peer-a", chatPresence("m1", "hello")]]));

    const batch = new Map([
      ["peer-a", chatPresence("m1", "hello")],
      ["peer-b", chatPresence("m2", "hi there")],
    ]);
    expect(take(batch).map(({ pid, text }) => ({ pid, text }))).toEqual([
      { pid: "peer-b", text: "hi there" },
    ]);

    const nextBatch = new Map([
      ["peer-a", chatPresence("m3", "new from a")],
      ["peer-b", chatPresence("m2", "hi there")],
    ]);
    expect(take(nextBatch).map(({ pid, text }) => ({ pid, text }))).toEqual([
      { pid: "peer-a", text: "new from a" },
    ]);
  });

  it("ignores malformed chat presence", () => {
    const take = createChatEchoTracker();
    take(new Map());
    expect(
      take(new Map<string, unknown>([["peer-a", { chat: { text: "no id" } }]])),
    ).toEqual([]);
  });
});

describe("isPlainPrimaryClick", () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it("accepts a plain left click", () => {
    expect(isPlainPrimaryClick(plain)).toBe(true);
  });

  it("leaves modified and non-primary clicks to the browser", () => {
    expect(isPlainPrimaryClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...plain, button: 1 })).toBe(false);
  });
});
