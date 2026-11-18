// ABOUTME: Verifies development mode warns once per element that falls back to a hashed id.
// ABOUTME: Production mode stays silent and the element still gets its hashed id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

function addIdlessToggle(text: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("can-toggle", "");
  element.textContent = text;
  document.body.append(element);
  return element;
}

function hashFallbackWarnings(warnSpy: ReturnType<typeof vi.spyOn>) {
  return warnSpy.mock.calls.filter((args) =>
    String(args[0]).includes("has no id"),
  );
}

describe("hashed id fallback warning", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("warns once per element in development mode, naming the element", async () => {
    await playhtml.init({ developmentMode: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});

    const first = addIdlessToggle("first");
    await playhtml.setupPlayElementForTag(first, "can-toggle");
    const second = addIdlessToggle("second");
    await playhtml.setupPlayElementForTag(second, "can-toggle");
    // Set up again: the element now has its hashed id and does not warn again.
    await playhtml.setupPlayElementForTag(first, "can-toggle");

    expect(first.id).toMatch(/^[0-9a-f]{40}$/);
    const warnings = hashFallbackWarnings(warnSpy);
    expect(warnings).toHaveLength(2);
    expect(warnings[0][0]).toContain("add an id");
    expect(warnings[0][1]).toBe(first);
    expect(warnings[1][1]).toBe(second);
  });

  it("warns only once for an element set up for two capabilities at once", async () => {
    await playhtml.init({ developmentMode: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});

    const element = addIdlessToggle("both");
    element.setAttribute("can-move", "");
    await Promise.all([
      playhtml.setupPlayElementForTag(element, "can-toggle"),
      playhtml.setupPlayElementForTag(element, "can-move"),
    ]);

    expect(hashFallbackWarnings(warnSpy)).toHaveLength(1);
  });

  it("does not warn outside development mode", async () => {
    await playhtml.init({});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const element = addIdlessToggle("quiet");
    await playhtml.setupPlayElementForTag(element, "can-toggle");

    expect(element.id).toMatch(/^[0-9a-f]{40}$/);
    expect(hashFallbackWarnings(warnSpy)).toHaveLength(0);
  });
});
