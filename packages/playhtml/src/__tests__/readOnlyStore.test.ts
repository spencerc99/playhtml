// ABOUTME: Tests read-only views over shared playhtml data.
// ABOUTME: Verifies inspection behavior and blocked mutation paths.
import { describe, expect, it } from "vitest";
import { createReadOnlyStore } from "../readOnlyStore";

describe("createReadOnlyStore", () => {
  it("allows key enumeration and deep reads", () => {
    const source = {
      "can-toggle": {
        element: { on: false },
      },
    };
    const view = createReadOnlyStore(source);

    expect(Object.keys(view)).toEqual(["can-toggle"]);
    expect(Object.keys(view["can-toggle"])).toEqual(["element"]);
    expect(view["can-toggle"].element).toEqual({ on: false });
  });

  it("blocks object mutation paths", () => {
    const source = {
      "can-toggle": {
        element: { on: false },
      },
    };
    const view = createReadOnlyStore(source);

    expect(() => {
      view["can-toggle"] = {};
    }).toThrow(/read-only/);
    expect(() => {
      delete view["can-toggle"].element;
    }).toThrow(/read-only/);
    expect(() => {
      Object.defineProperty(view["can-toggle"], "other", {
        value: { on: true },
      });
    }).toThrow(/read-only/);
    expect(() => {
      Object.setPrototypeOf(view["can-toggle"], null);
    }).toThrow(/read-only/);
    expect(() => {
      Object.preventExtensions(view["can-toggle"]);
    }).toThrow(/read-only/);
    expect(() => {
      Object.freeze(view["can-toggle"]);
    }).toThrow(/read-only/);

    expect(source).toEqual({
      "can-toggle": {
        element: { on: false },
      },
    });
  });

  it("does not expose mutation instructions in thrown errors", () => {
    const view = createReadOnlyStore({
      "can-toggle": {
        element: { on: false },
      },
    });

    let thrownError: unknown;
    try {
      view["can-toggle"].element.on = true;
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe(
      "playhtml.syncedStore is read-only.",
    );
  });

  it("blocks array mutation paths", () => {
    const source = {
      "can-duplicate": {
        element: ["existing"],
      },
    };
    const view = createReadOnlyStore(source);
    const publicArray = view["can-duplicate"].element;

    expect(publicArray).toEqual(["existing"]);
    expect(() => {
      publicArray.push("corrupted");
    }).toThrow(/read-only/);
    expect(() => {
      publicArray[0] = "corrupted";
    }).toThrow(/read-only/);
    expect(() => {
      publicArray.length = 0;
    }).toThrow(/read-only/);

    expect(source["can-duplicate"].element).toEqual(["existing"]);
  });

  it("keeps non-configurable values inspectable and read-only", () => {
    const nested = { ok: true };
    const source = {};
    Object.defineProperty(source, "fixed", {
      value: nested,
      enumerable: true,
      configurable: false,
      writable: false,
    });

    const view = createReadOnlyStore(source as { fixed: { ok: boolean } });

    expect(view.fixed).toEqual({ ok: true });
    expect(() => {
      view.fixed.ok = false;
    }).toThrow(/read-only/);
    expect(nested).toEqual({ ok: true });
  });
});
