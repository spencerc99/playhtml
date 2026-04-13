// ABOUTME: Tests for cursor container resolution — element, selector, getter.
// ABOUTME: Null handling and getter-on-every-call semantics.
import { describe, it, expect, beforeEach } from "vitest";
import { resolveCursorContainer } from "../container";

describe("resolveCursorContainer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns document.body when undefined", () => {
    expect(resolveCursorContainer(undefined)).toBe(document.body);
  });

  it("returns the element when passed HTMLElement", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(resolveCursorContainer(el)).toBe(el);
  });

  it("resolves string selector", () => {
    const el = document.createElement("div");
    el.id = "cursor-layer";
    document.body.appendChild(el);
    expect(resolveCursorContainer("#cursor-layer")).toBe(el);
  });

  it("returns null when selector matches nothing", () => {
    expect(resolveCursorContainer("#missing")).toBeNull();
  });

  it("calls getter function each time", () => {
    let count = 0;
    const getter = () => {
      count++;
      return document.body;
    };
    resolveCursorContainer(getter);
    resolveCursorContainer(getter);
    expect(count).toBe(2);
  });

  it("returns null from getter when element not present", () => {
    expect(resolveCursorContainer(() => null)).toBeNull();
  });
});
