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
  it("returns exactly the declared entries and reports changes", async () => {
    const { replaceSharedElementPermissions } = await import(
      "../bridgePermissionPolicy"
    );

    expect(
      replaceSharedElementPermissions(
        { dropped: "read-only", loosened: "read-only" },
        [
          { elementId: "loosened", permissions: "read-write" },
          { elementId: "added", permissions: "ro" },
        ],
        500
      )
    ).toEqual({
      permissions: { loosened: "read-write", added: "read-only" },
      changed: true,
      ignoredForCap: 0,
    });
    expect(
      replaceSharedElementPermissions(
        { a: "read-only" },
        [{ elementId: "a", permissions: "ro" }],
        500
      ).changed
    ).toBe(false);
  });

  it("skips malformed entries and prototype keys", async () => {
    const { replaceSharedElementPermissions, getPermittedSharedElementIds } =
      await import("../bridgePermissionPolicy");

    const result = replaceSharedElementPermissions(
      {},
      [
        null,
        "shared",
        { permissions: "read-write" },
        { elementId: "", permissions: "read-write" },
        { elementId: "__proto__", permissions: "read-write" },
      ],
      500
    );

    expect(result).toEqual({ permissions: {}, changed: false, ignoredForCap: 0 });
    expect(
      getPermittedSharedElementIds(["constructor", "toString"], {})
    ).toEqual([]);
  });

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

describe("setSharedElementPermission", () => {
  it("sets one entry in either direction without mutating the input", async () => {
    const { setSharedElementPermission } = await import(
      "../bridgePermissionPolicy"
    );
    const existing = { open: "read-only" as const };

    expect(
      setSharedElementPermission(
        existing,
        { elementId: "open", permissions: "read-write" },
        500
      )
    ).toEqual({
      permissions: { open: "read-write" },
      changed: true,
      ignoredForCap: 0,
    });
    expect(existing).toEqual({ open: "read-only" });
  });

  it("ignores a new id at the cap but updates an existing one", async () => {
    const { setSharedElementPermission } = await import(
      "../bridgePermissionPolicy"
    );
    const full = { a: "read-write" as const };

    expect(
      setSharedElementPermission(full, { elementId: "b" }, 1)
    ).toEqual({ permissions: full, changed: false, ignoredForCap: 1 });
    expect(
      setSharedElementPermission(full, { elementId: "a", permissions: "ro" }, 1)
    ).toEqual({
      permissions: { a: "read-only" },
      changed: true,
      ignoredForCap: 0,
    });
  });
});
