// ABOUTME: Verifies that incoming play events reach every registered listener.
// ABOUTME: A listener that throws is logged and does not stop the others.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

describe("play event fan-out", () => {
  beforeEach(async () => {
    try { await resetPlayHTML(); } catch {}
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("delivers an event to later listeners when an earlier one throws", async () => {
    const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
    await playhtml.init({ host: "http://localhost:1999" } as any);
    const provider = providers[providers.length - 1];
    expect(provider).toBeTruthy();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: unknown[] = [];
    playhtml.registerPlayEventListener("confetti", {
      onEvent: () => {
        throw new Error("listener failed");
      },
    });
    playhtml.registerPlayEventListener("confetti", {
      onEvent: (payload: unknown) => received.push(payload),
    });

    provider.emit(
      "custom-message",
      JSON.stringify({ type: "confetti", eventPayload: { color: "red" } }),
    );

    expect(received).toEqual([{ color: "red" }]);
    expect(errorSpy).toHaveBeenCalledWith(
      '[playhtml] "confetti" event listener callback threw:',
      expect.objectContaining({ message: "listener failed" }),
    );
    errorSpy.mockRestore();
  });
});
