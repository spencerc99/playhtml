// ABOUTME: Verifies the trails overlay reports a failed load to normal users and on its host.
// ABOUTME: A failed first load shows the short error and reaches "error"; a later success reaches "ready".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { loadHistoricalData } = vi.hoisted(() => ({
  loadHistoricalData: vi.fn(),
}));

vi.mock("../storage/historyLoader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage/historyLoader")>()),
  loadHistoricalData,
}));
vi.mock("../features/featureAccess", () => ({
  isFeatureEnabled: vi.fn(async () => true),
}));
// jsdom has no AudioContext; the overlay's sound never starts here.
vi.mock("@movement/sound/SoundEngine", () => ({
  SoundEngine: class {
    init() {
      return new Promise<void>(() => {});
    }
    dispose() {}
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { HistoricalOverlay, LOAD_FAILED_TEXT } from "../components/HistoricalOverlay";

const PAGE_URL = "https://example.com/some/page";

function cursorEvent(id: string) {
  return {
    id,
    type: "cursor",
    ts: Date.now(),
    data: { x: 0.5, y: 0.5, event: "move" },
    meta: { pid: "pk_test", sid: "sid_test", url: PAGE_URL, vw: 1000, vh: 800, tz: "UTC" },
  };
}

/** The text in the canvas area's placeholder, or null when none is shown. */
function canvasPlaceholder(shadow: ShadowRoot): string | null {
  const texts = ["loading...", "no data", LOAD_FAILED_TEXT];
  const match = [...shadow.querySelectorAll<HTMLElement>("div")].find(
    (el) => el.style.pointerEvents === "none" && texts.includes(el.textContent ?? ""),
  );
  return match?.textContent ?? null;
}

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
  }
}

describe("HistoricalOverlay load state", () => {
  let host: HTMLDivElement;
  let shadow: ShadowRoot;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadHistoricalData.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadow.appendChild(container);
    root = createRoot(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // jsdom has no SVG path geometry, so the trail animation loop cannot run here.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  const render = (currentUrl: string) =>
    act(async () => {
      root.render(
        <HistoricalOverlay
          visible
          currentUrl={currentUrl}
          onClose={() => {}}
          initialSource="everyone"
        />,
      );
    });

  it("shows the short error in place of the empty state and reaches error, then ready", async () => {
    loadHistoricalData.mockRejectedValue(
      new Error("Could not load shared trails (server error 403)"),
    );
    await render(PAGE_URL);
    await flush();

    expect(host.getAttribute("data-wwo-trails-source")).toBe("everyone");
    expect(host.getAttribute("data-wwo-trails-state")).toBe("error");
    expect(canvasPlaceholder(shadow)).toBe(LOAD_FAILED_TEXT);
    // Dev mode is off, so the detailed message stays out of view.
    expect(shadow.textContent).not.toContain("server error 403");
    expect(consoleError).toHaveBeenCalledWith(
      "[HistoricalOverlay] Failed to load data:",
      expect.objectContaining({ message: "Could not load shared trails (server error 403)" }),
    );

    loadHistoricalData.mockResolvedValue([cursorEvent("e1"), cursorEvent("e2")]);
    await render(`${PAGE_URL}?again`);
    await flush();

    expect(host.getAttribute("data-wwo-trails-state")).toBe("ready");
    expect(host.getAttribute("data-wwo-trails-count")).toBe("2");
    expect(canvasPlaceholder(shadow)).toBeNull();
  });

  it("drops earlier trails when a later load fails", async () => {
    loadHistoricalData.mockResolvedValue([cursorEvent("e1")]);
    await render(PAGE_URL);
    await flush();
    expect(host.getAttribute("data-wwo-trails-state")).toBe("ready");

    loadHistoricalData.mockRejectedValue(new Error("Could not reach the server"));
    await render(`${PAGE_URL}?again`);
    await flush();

    expect(host.getAttribute("data-wwo-trails-state")).toBe("error");
    expect(host.getAttribute("data-wwo-trails-count")).toBe("0");
    expect(canvasPlaceholder(shadow)).toBe(LOAD_FAILED_TEXT);
    expect(consoleError).toHaveBeenCalledWith(
      "[HistoricalOverlay] Failed to load data:",
      expect.objectContaining({ message: "Could not reach the server" }),
    );
  });

  it("still says no data when a load succeeds with nothing", async () => {
    loadHistoricalData.mockResolvedValue([]);
    await render(PAGE_URL);
    await flush();

    expect(host.getAttribute("data-wwo-trails-state")).toBe("empty");
    expect(canvasPlaceholder(shadow)).toBe("no data");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
