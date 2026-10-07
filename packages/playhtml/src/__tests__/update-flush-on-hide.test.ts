// ABOUTME: Verifies batched outgoing updates are sent as soon as the page is hidden.
// ABOUTME: Hidden tabs throttle timers, so the batch must not wait for its timer.
import { beforeEach, describe, expect, it } from "vitest";
import { elementHandlers, playhtml, resetPlayHTML } from "../index";
import { UPDATE_SEND_INTERVAL_MS } from "../updateCoalescer";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("outgoing update batching", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
  });

  it("sends a waiting batch when the page is hidden", async () => {
    const el = document.createElement("div");
    el.id = "note";
    el.setAttribute("can-play", "");
    (el as any).defaultData = { text: "" };
    (el as any).updateElement = () => {};
    document.body.appendChild(el);
    await playhtml.init({ host: "http://localhost:1999", room: "/flush-on-hide" } as any);
    await new Promise((r) => setTimeout(r, UPDATE_SEND_INTERVAL_MS * 2));

    const provider = (globalThis as any).PLAYHTML_TEST_PROVIDERS[0];
    const handler = elementHandlers.get("can-play")!.get("note")!;
    provider.ws.send.mockClear();
    handler.setData({ text: "first" });
    handler.setData({ text: "second" });
    expect(provider.ws.send).toHaveBeenCalledTimes(1);

    try {
      setVisibility("hidden");
      expect(provider.ws.send).toHaveBeenCalledTimes(2);
    } finally {
      setVisibility("visible");
    }
  });
});
