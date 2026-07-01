// ABOUTME: Verifies shared-element permission filtering for bridge payloads.
// ABOUTME: Prevents consumers from hydrating source elements that were not exported.
import { describe, expect, it } from "bun:test";

async function loadBridgePermissionPolicy(): Promise<{
  getPermittedSharedElementIds: (
    requestedIds: string[],
    permissions: Record<string, "read-only" | "read-write">
  ) => string[];
}> {
  const module = await import("../bridgePermissionPolicy").catch(() => null);
  expect(module).not.toBeNull();
  return module as NonNullable<typeof module>;
}

describe("getPermittedSharedElementIds", () => {
  it("keeps only element ids that the source exported", async () => {
    const { getPermittedSharedElementIds } =
      await loadBridgePermissionPolicy();

    expect(
      getPermittedSharedElementIds(["shared", "private"], {
        shared: "read-write",
      })
    ).toEqual(["shared"]);
  });

  it("treats read-only exports as hydratable", async () => {
    const { getPermittedSharedElementIds } =
      await loadBridgePermissionPolicy();

    expect(
      getPermittedSharedElementIds(["readonly"], {
        readonly: "read-only",
      })
    ).toEqual(["readonly"]);
  });
});
