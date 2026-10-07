// ABOUTME: Verifies docs code blocks register and animate through the public playhtml API.
// ABOUTME: Prevents copy effects from depending on private runtime readiness state.

import { afterEach, describe, expect, it, vi } from "vitest";
import { playhtml } from "playhtml";

const listenerByType = new Map<string, (payload: unknown) => void>();
const handle = {
  getData: vi.fn(() => ({ wear: 2 })),
  setData: vi.fn(),
};

vi.mock("playhtml", () => ({
  playhtml: {
    ready: Promise.resolve(),
    register: vi.fn(() => handle),
    getHandle: vi.fn(() => handle),
    registerPlayEventListener: vi.fn(
      (type: string, event: { onEvent: (payload: unknown) => void }) => {
        listenerByType.set(type, event.onEvent);
        return "listener-1";
      },
    ),
    dispatchPlayEvent: vi.fn(
      ({ type, eventPayload }: { type: string; eventPayload: unknown }) => {
        listenerByType.get(type)?.(eventPayload);
      },
    ),
  },
}));

afterEach(() => {
  document.body.innerHTML = "";
  listenerByType.clear();
  vi.clearAllMocks();
});

describe("docs code-block copy enhancement", () => {
  it("registers the event and animates a copy without private runtime state", async () => {
    document.body.innerHTML = `
      <main>
        <pre class="astro-code"><code>const lamp = "on";</code></pre>
      </main>
    `;

    await import("../enhance-code-blocks");
    await Promise.resolve();

    expect(playhtml.registerPlayEventListener).toHaveBeenCalledWith(
      "docs-code-copy",
      expect.objectContaining({ onEvent: expect.any(Function) }),
    );
    expect(playhtml.register).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        defaultData: { wear: 0 },
        updateElement: expect.any(Function),
      }),
    );

    const button = document.querySelector<HTMLButtonElement>(".ph-copy__btn");
    expect(button).not.toBeNull();
    button?.click();
    await Promise.resolve();

    expect(playhtml.dispatchPlayEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "docs-code-copy" }),
    );
    expect(document.querySelector(".ph-copy")?.getAttribute("data-pulse")).toBe(
      "1",
    );
    expect(document.querySelectorAll(".ph-copy-particle").length).toBeGreaterThan(
      0,
    );
    expect(handle.setData).toHaveBeenCalledOnce();
  });
});
