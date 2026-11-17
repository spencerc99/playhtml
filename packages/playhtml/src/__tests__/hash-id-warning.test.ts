// ABOUTME: Verifies development mode warns once per element that falls back to a hashed id.
// ABOUTME: Production mode stays silent and the hashed id itself is unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";
import { hashElement } from "../utils";

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
    const expectedId = await hashElement("can-toggle", first);
    await playhtml.setupPlayElementForTag(first, "can-toggle");
    const second = addIdlessToggle("second");
    await playhtml.setupPlayElementForTag(second, "can-toggle");
    // Set up again: the element now has its hashed id and does not warn again.
    await playhtml.setupPlayElementForTag(first, "can-toggle");

    expect(first.id).toBe(expectedId);
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
    const expectedId = await hashElement("can-toggle", element);
    await playhtml.setupPlayElementForTag(element, "can-toggle");

    expect(element.id).toBe(expectedId);
    expect(hashFallbackWarnings(warnSpy)).toHaveLength(0);
  });
});
