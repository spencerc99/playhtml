// ABOUTME: Tests host-page target selection for the scissors and hammer tools.
// ABOUTME: Ensures explicit playground targets win over eligible nested text and controls.

import { afterEach, describe, expect, it } from "vitest";
import { findHammerTarget } from "../features/hammer/HammerController";
import { findCutTarget } from "../features/scissors/ScissorsController";

function usableRect(width = 180, height = 100): DOMRect {
  return {
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("physical tool targets", () => {
  it("cuts the explicit collage card instead of its eligible child", () => {
    const card = document.createElement("article");
    card.setAttribute("data-wwo-cut-target", "");
    const child = document.createElement("span");
    card.appendChild(child);
    document.body.appendChild(card);
    card.getBoundingClientRect = () => usableRect();
    child.getBoundingClientRect = () => usableRect(120, 40);

    expect(findCutTarget(child)).toBe(card);
  });

  it("hammers the explicit panel instead of its nested button", () => {
    const panel = document.createElement("section");
    panel.setAttribute("data-wwo-hammer-target", "");
    const button = document.createElement("button");
    panel.appendChild(button);
    document.body.appendChild(panel);
    panel.getBoundingClientRect = () => usableRect();
    button.getBoundingClientRect = () => usableRect(80, 32);

    expect(findHammerTarget(button)).toBe(panel);
  });

  it("never selects extension-owned UI", () => {
    const host = document.createElement("div");
    host.id = "we-were-online-inventory";
    const child = document.createElement("button");
    host.appendChild(child);
    document.body.appendChild(host);
    host.getBoundingClientRect = () => usableRect();
    child.getBoundingClientRect = () => usableRect(80, 32);

    expect(findCutTarget(child)).toBeNull();
    expect(findHammerTarget(child)).toBeNull();
  });
});
