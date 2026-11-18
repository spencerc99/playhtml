// ABOUTME: Covers built-in capabilities whose element supplies its own update callback.
// ABOUTME: The React wrappers do this for every can-* element, including can-hover.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { elementHandlers, playhtml } from "../index";

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  await playhtml.init({});
  await playhtml.ready;
  await tick();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("built-in capability with a custom update callback", () => {
  it("sets up can-hover when the element supplies updateElement", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const element = document.createElement("div");
    element.id = "custom-update-hover";
    element.setAttribute("can-hover", "");
    const updateElement = vi.fn();
    (element as any).updateElement = updateElement;
    document.body.appendChild(element);

    playhtml.setupPlayElement(element);
    await tick();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(elementHandlers.get("can-hover")?.has("custom-update-hover")).toBe(
      true,
    );
    expect(updateElement).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("sets up can-grow when the element supplies update", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const element = document.createElement("div");
    element.id = "custom-update-grow";
    element.setAttribute("can-grow", "");
    const update = vi.fn();
    (element as any).update = update;
    document.body.appendChild(element);

    playhtml.setupPlayElement(element);
    await tick();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(elementHandlers.get("can-grow")?.has("custom-update-grow")).toBe(
      true,
    );
    expect(update).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
