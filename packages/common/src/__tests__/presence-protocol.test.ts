// ABOUTME: Verifies the generic realtime presence wire-message contract.
// ABOUTME: Covers channel cadence selection and runtime message validation.

import { describe, expect, it } from "vitest";
import {
  getPresenceChannelCadence,
  validatePresenceClientMessage,
} from "../presence-protocol";

describe("presence protocol", () => {
  it("treats cursor updates as frame-cadence presence", () => {
    expect(getPresenceChannelCadence("cursor")).toBe("frame");
  });

  it("treats element awareness as interactive presence", () => {
    expect(getPresenceChannelCadence("element:can-mirror:tile-1")).toBe(
      "interactive",
    );
  });

  it("treats custom presence channels as event-cadence presence", () => {
    expect(getPresenceChannelCadence("status")).toBe("event");
  });

  it("accepts finite cursor presence updates", () => {
    const message = validatePresenceClientMessage({
      type: "presence-update",
      channel: "cursor",
      value: {
        cursor: { x: 12, y: 34, pointer: "mouse" },
        page: "/week/1",
        zone: null,
        at: 123,
      },
    });

    expect(message.type).toBe("presence-update");
    expect(message.channel).toBe("cursor");
  });

  it("rejects cursor updates with non-finite coordinates", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "cursor",
        value: {
          cursor: { x: Number.POSITIVE_INFINITY, y: 34, pointer: "mouse" },
        },
      }),
    ).toThrow("cursor.x must be a finite number");
  });

  it("rejects oversized presence values", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "status",
        value: "x".repeat(4097),
      }),
    ).toThrow("Presence value must be 4096 bytes or less");
  });
});
