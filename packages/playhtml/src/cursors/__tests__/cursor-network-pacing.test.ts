// ABOUTME: Verifies transport cursor pacing changes with room load and server limits.
// ABOUTME: Keeps cursor movement ephemeral so shared document data is untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";
import { getCursorNetworkHz, getCursorNetworkIntervalMs } from "../cursor-network-pacing";

const identity = (key: string) => ({ publicKey: key, playerStyle: { colorPalette: ["#f00"] } });
function move(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
}

describe("cursor network pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("keeps small rooms at 60Hz and scales down large rooms", () => {
    expect(getCursorNetworkIntervalMs(30)).toBeCloseTo(1000 / 60);
    expect(getCursorNetworkHz(31)).toBeCloseTo(30);
    expect(getCursorNetworkHz(100)).toBeCloseTo(150_000 / (100 * 99));
  });

  it("publishes pointer movement only through the presence transport", () => {
    const { client, transport } = createTransportCursorClient({ enabled: true, playerIdentity: identity("self") });
    const before = transport.updates.length;
    move(10, 20);
    vi.advanceTimersByTime(20);
    expect(transport.updates.slice(before).some(({ channel }) => channel === "cursor")).toBe(true);
    client.destroy();
  });

  it("honors the server cursor rate limit", () => {
    const { client, transport } = createTransportCursorClient({ enabled: true, playerIdentity: identity("self") });
    transport.emit({ type: "presence-rate", channel: "cursor", hz: 5 });
    const before = transport.updates.length;
    move(1, 1);
    move(2, 2);
    vi.advanceTimersByTime(199);
    expect(transport.updates).toHaveLength(before + 1);
    vi.advanceTimersByTime(1);
    expect(transport.updates).toHaveLength(before + 2);
    client.destroy();
  });

  it("does not publish a second identity channel on user changes", () => {
    const { client, transport, users } = createTransportCursorClient({ enabled: true, playerIdentity: identity("self") });
    users.me.color = "#0f0";
    expect(transport.updates.filter(({ channel }) => channel === "identity")).toEqual([]);
    client.destroy();
  });
});
