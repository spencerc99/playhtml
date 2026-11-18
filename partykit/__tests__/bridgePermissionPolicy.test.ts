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

  it("does not permit Object.prototype names", async () => {
    const { getPermittedSharedElementIds } =
      await loadBridgePermissionPolicy();

    expect(
      getPermittedSharedElementIds(["constructor", "toString"], {})
    ).toEqual([]);
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

describe("parseSharedElementPermission", () => {
  it("reads ro and read-only the same way", async () => {
    const { parseSharedElementPermission } = await import(
      "../bridgePermissionPolicy"
    );

    expect(parseSharedElementPermission("ro")).toBe("read-only");
    expect(parseSharedElementPermission("RO")).toBe("read-only");
    expect(parseSharedElementPermission("read-only")).toBe("read-only");
    expect(parseSharedElementPermission("read-write")).toBe("read-write");
    expect(parseSharedElementPermission("")).toBe("read-write");
    expect(parseSharedElementPermission(undefined)).toBe("read-write");
  });
});

describe("replaceSharedElementPermissions", () => {
  it("ignores distinct ids beyond the cap but still updates kept ones", async () => {
    const { replaceSharedElementPermissions } = await import(
      "../bridgePermissionPolicy"
    );

    expect(
      replaceSharedElementPermissions(
        {},
        [
          { elementId: "a", permissions: "read-write" },
          { elementId: "b", permissions: "read-write" },
          { elementId: "c", permissions: "read-write" },
          { elementId: "a", permissions: "ro" },
        ],
        2
      )
    ).toEqual({
      permissions: { a: "read-only", b: "read-write" },
      changed: true,
      ignoredForCap: 1,
    });
  });
});
