// ABOUTME: Verifies cursor events react to identity changes from the users module.
// ABOUTME: The extension identity-injection path depends on these updates.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransportCursorClient } from "../../__tests__/presence-test-utils";

const identity = (publicKey: string, color: string, name?: string) => ({
  publicKey,
  name,
  playerStyle: { colorPalette: [color] },
});

describe("cursor identity events", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits color and name events when the shared identity changes", () => {
    const { client, users } = createTransportCursorClient({ enabled: true, playerIdentity: identity("self", "#f00", "Before") });
    const colors = vi.fn();
    const names = vi.fn();
    client.on("color", colors);
    client.on("name", names);
    users.adoptIdentity(identity("self", "#0f0", "After"));
    expect(colors).toHaveBeenCalledWith("#0f0");
    expect(names).toHaveBeenCalledWith("After");
    client.destroy();
  });

  it("does not emit fields that did not change", () => {
    const { client, users } = createTransportCursorClient({ enabled: true, playerIdentity: identity("self", "#f00", "Same") });
    const colors = vi.fn();
    const names = vi.fn();
    client.on("color", colors);
    client.on("name", names);
    users.adoptIdentity(identity("self", "#f00", "Same"));
    expect(colors).not.toHaveBeenCalled();
    expect(names).not.toHaveBeenCalled();
    client.destroy();
  });
});
