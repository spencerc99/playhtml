// ABOUTME: Tests function-form React defaults against the initialized PlayHTML runtime.
// ABOUTME: Verifies DOM-derived initialization does not duplicate shared writes in Strict Mode.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { playhtml, resetPlayHTML } from "playhtml";
import { CanPlayElement } from "../index";

describe("CanPlayElement function defaults", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await playhtml.init({});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("initializes from its mounted element without duplicate shared writes", async () => {
    const defaultData = vi.fn((element: HTMLElement) => ({
      color: element.dataset.color,
    }));
    const myDefaultAwareness = vi.fn((element: HTMLElement) => ({
      presence: element.dataset.presence,
    }));
    const provider = (globalThis as any).PLAYHTML_TEST_PROVIDERS[0];

    const existingElement = document.createElement("button");
    existingElement.id = "existing-element";
    existingElement.setAttribute("can-play", "");
    (existingElement as any).defaultData = { color: "blue" };
    (existingElement as any).updateElement = () => {};
    document.body.appendChild(existingElement);
    playhtml.setupPlayElement(existingElement);
    await waitFor(() => {
      expect(
        playhtml.elementHandlers.get("can-play")?.get("existing-element"),
      ).toBeTruthy();
    });
    provider.ws.send.mockClear();

    const { getByTestId } = render(
      <React.StrictMode>
        <CanPlayElement
          id="function-defaults"
          defaultData={defaultData}
          myDefaultAwareness={myDefaultAwareness}
        >
          {({ data, myAwareness }) => (
            <button
              data-color="violet"
              data-presence="present"
              data-testid="function-defaults"
            >
              {data?.color}:{myAwareness?.presence}
            </button>
          )}
        </CanPlayElement>
      </React.StrictMode>,
    );

    const element = getByTestId("function-defaults");
    await waitFor(() => {
      expect(
        playhtml.elementHandlers.get("can-play")?.get("function-defaults"),
      ).toBeTruthy();
    });
    const handler = playhtml.elementHandlers
      .get("can-play")!
      .get("function-defaults")!;

    expect(defaultData).toHaveBeenCalledTimes(1);
    expect(defaultData).toHaveBeenCalledWith(element);
    expect(myDefaultAwareness).toHaveBeenCalledTimes(1);
    expect(myDefaultAwareness).toHaveBeenCalledWith(element);
    expect(handler.data).toEqual({ color: "violet" });
    expect(handler.selfAwareness).toEqual({ presence: "present" });
    expect(playhtml.syncedStore["can-play"]["function-defaults"]).toEqual({
      color: "violet",
    });
    expect(provider.ws.send).toHaveBeenCalledTimes(1);
  });
});
