// ABOUTME: Verifies how `shared` attribute values map to permission modes.
// ABOUTME: Covers the parser and the diagnostics listing that reads it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { findSharedElementsOnPage, parseSharedPermission } from "../sharing";
import { listSharedElements } from "../shared-elements";

describe("parseSharedPermission", () => {
  it("treats empty and absent values as read-write", () => {
    expect(parseSharedPermission(null)).toBe("read-write");
    expect(parseSharedPermission("")).toBe("read-write");
  });

  it("accepts read-only, ro, and any casing", () => {
    expect(parseSharedPermission("read-only")).toBe("read-only");
    expect(parseSharedPermission("ro")).toBe("read-only");
    expect(parseSharedPermission("RO")).toBe("read-only");
    expect(parseSharedPermission("Read-Only")).toBe("read-only");
  });

  it("treats other values as read-write", () => {
    expect(parseSharedPermission("read-write")).toBe("read-write");
    expect(parseSharedPermission("rw")).toBe("read-write");
  });
});

describe("shared element listings", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("lists shared=\"ro\" sources as read-only", () => {
    vi.spyOn(console, "table").mockImplementation(() => {});
    document.body.innerHTML = `<div id="board" shared="ro"></div>`;

    const listed = listSharedElements();
    expect(listed).toHaveLength(1);
    expect(listed[0].permissions).toBe("read-only");
    expect(findSharedElementsOnPage()[0].permissions).toBe("read-only");
  });

  it("parses data-source consumers and skips malformed ones", () => {
    vi.spyOn(console, "table").mockImplementation(() => {});
    document.body.innerHTML = `
      <div data-source="example.com/fridge.html#words"></div>
      <div data-source="example.com#"></div>
    `;

    const listed = listSharedElements();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      type: "consumer",
      elementId: "words",
      dataSource: "example.com/fridge.html#words",
      normalized: "example.com/fridge#words",
    });
  });
});
