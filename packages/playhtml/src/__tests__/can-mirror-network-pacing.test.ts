// ABOUTME: Covers can-mirror network pacing under many simultaneous DOM mutations.
// ABOUTME: Verifies pixel-grid style changes coalesce before leaving the client.
import { beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const flushFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => setTimeout(resolve, 0));
      return;
    }
    setTimeout(resolve, 0);
  });

function getMainProvider(): any {
  const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
  const provider = providers?.[0];
  if (!provider) throw new Error("Expected test provider");
  return provider;
}

describe("can-mirror network pacing", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("coalesces simultaneous element mutations into one document update", async () => {
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/can-mirror-network-pacing",
      cursors: { enabled: false },
    });

    const pixels: HTMLElement[] = [];
    for (let i = 0; i < 32; i++) {
      const pixel = document.createElement("div");
      pixel.id = `pixel-${i}`;
      pixel.setAttribute("can-mirror", "");
      document.body.appendChild(pixel);
      pixels.push(pixel);
      await playhtml.setupPlayElementForTag(pixel, "can-mirror");
    }
    await flush();

    const provider = getMainProvider();
    provider.ws.send.mockClear();

    for (const pixel of pixels) {
      pixel.classList.add("writing");
      pixel.style.opacity = "0.5";
    }

    await flushFrame();
    await flush();

    expect(provider.ws.send).toHaveBeenCalledTimes(1);
    for (const pixel of pixels) {
      expect(playhtml.syncedStore["can-mirror"][pixel.id].attributes.class).toBe(
        "writing",
      );
      expect(
        playhtml.syncedStore["can-mirror"][pixel.id].attributes.style,
      ).toContain("opacity: 0.5");
    }
  });
});
