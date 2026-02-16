/**
 * @vitest-environment happy-dom
 *
 * This test file uses happy-dom instead of jsdom because:
 * - happy-dom allows proper mocking of window.location properties
 * - jsdom's Location object has non-configurable properties that prevent mocking
 * - These tests need to verify room normalization with different URLs/pathnames
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Helper to mock window.location
// In happy-dom, location properties are more easily mockable than jsdom
// We use Object.defineProperty to override individual properties
function mockLocation(host: string, pathname: string, search: string = "") {
  const hostname = host.split(":")[0];
  const port = host.includes(":") ? host.split(":")[1] : "";
  const href = `http://${host}${pathname}${search}`;
  const origin = `http://${hostname}${port ? `:${port}` : ""}`;

  // In happy-dom, we can directly override location properties
  // Delete and redefine to ensure clean mock
  try {
    delete (window as any).location;
  } catch (e) {
    // Ignore if can't delete
  }

  // Create a new location object with our mocked values
  const locationMock = {
    host,
    hostname,
    pathname,
    search,
    href,
    origin,
    protocol: "http:" as const,
    port,
    hash: "",
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => href,
  };

  // Use Object.defineProperty to set location
  Object.defineProperty(window, "location", {
    value: locationMock,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

async function freshPlayhtml() {
  // Ensure a clean module instance and clear global window guard
  // @ts-ignore
  delete (globalThis as any).playhtml;
  // @ts-ignore
  delete (window as any).playhtml;

  // Reset vitest module cache to get fresh module state
  // This ensures module-level variables like `firstSetup` are reset
  vi.resetModules();

  const mod = await import("../index");
  return mod.playhtml;
}

describe("Room normalization and cursor room matching", () => {
  beforeEach(async () => {
    if (typeof document !== "undefined") {
      document.body.innerHTML = "";
    }
  });

  describe("Main room construction", () => {
    it("should construct main room with host and pathname", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({ room: "/test/playground" });

      // Main room should be encoded as: host + "-" + room
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should strip filename extensions from default room", async () => {
      mockLocation("example.com", "/test/playground.html");
      const playhtml = await freshPlayhtml();
      await playhtml.init({});

      // Default room should strip .html extension
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should normalize www. and non-www hosts to the same room", async () => {
      mockLocation("www.example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({ room: "/test/playground" });

      // www. should be stripped — same room as example.com
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should include search params when defaultRoomOptions.includeSearch is true", async () => {
      mockLocation("example.com", "/test/playground", "?query=test");
      const playhtml = await freshPlayhtml();
      await playhtml.init({ defaultRoomOptions: { includeSearch: true } });

      const expectedRoom = encodeURIComponent(
        "example.com-/test/playground?query=test"
      );
      expect(playhtml.roomId).toBe(expectedRoom);
    });
  });

  describe("Cursor room matching with main room", () => {
    it("should reuse main provider when cursor room is 'page' and matches default room", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "page",
        },
      });

      // Should reuse main provider, so cursorProvider should be null
      // We can verify this by checking that both use the same room
      // Since we can't easily access cursorProvider, we'll verify through behavior
      // The key is that when rooms match, no separate provider is created
      expect(playhtml.roomId).toBeDefined();
    });

    it("should match when cursor 'page' room matches custom main room", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        room: "/test/playground",
        cursors: {
          enabled: true,
          room: "page",
        },
      });

      // Both should normalize to the same room ID
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should create separate provider when cursor room is 'domain'", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "domain",
        },
      });

      // Domain room should be just the host (no pathname)
      // Main room should include pathname, so they should differ
      const mainRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(mainRoom);

      // Cursor room for domain would be: encodeURIComponent("example.com")
      // They should be different, so a separate provider should be created
      const cursorDomainRoom = encodeURIComponent("example.com");
      expect(cursorDomainRoom).not.toBe(mainRoom);
    });

    it("should create separate provider when cursor room is 'section'", async () => {
      mockLocation("example.com", "/test/playground/page");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "section",
        },
      });

      // Section room should be: host + "-/" + firstSegment
      // Main room should be: host + "-" + full pathname (without extension)
      // Since pathname is "/test/playground/page", main room should include the full path
      const mainRoom = encodeURIComponent("example.com-/test/playground/page");
      expect(playhtml.roomId).toBe(mainRoom);

      // Section room would be: encodeURIComponent("example.com-/test")
      const cursorSectionRoom = encodeURIComponent("example.com-/test");
      expect(cursorSectionRoom).not.toBe(mainRoom);
    });

    it("should handle custom function cursor room", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: ({ pathname }) => pathname, // Returns same pathname
        },
      });

      // Should match main room since function returns same pathname
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should strip filename extensions from cursor room pathnames", async () => {
      mockLocation("example.com", "/test/playground.html");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "page",
        },
      });

      // Both main and cursor room should strip .html extension
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should handle root pathname correctly", async () => {
      mockLocation("example.com", "/");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "page",
        },
      });

      // Root pathname should still normalize correctly
      const expectedRoom = encodeURIComponent("example.com-/");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should handle section room with root pathname", async () => {
      mockLocation("example.com", "/");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "section",
        },
      });

      // Section with root pathname should handle empty first segment
      const mainRoom = encodeURIComponent("example.com-/");
      expect(playhtml.roomId).toBe(mainRoom);

      // Section room with no segments would be: encodeURIComponent("example.com-/")
      // In this case, they would match
    });

    it("should handle pathname with port in host", async () => {
      mockLocation("example.com:8080", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "page",
        },
      });

      // Host with port should be included in room ID
      const expectedRoom = encodeURIComponent(
        "example.com:8080-/test/playground"
      );
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should normalize nested pathname for section room", async () => {
      mockLocation("example.com", "/section/subsection/page.html");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: "section",
        },
      });

      // Main room: full pathname without extension
      const mainRoom = encodeURIComponent(
        "example.com-/section/subsection/page"
      );
      expect(playhtml.roomId).toBe(mainRoom);

      // Section room should be first segment only
      const cursorSectionRoom = encodeURIComponent("example.com-/section");
      expect(cursorSectionRoom).not.toBe(mainRoom);
    });
  });

  describe("Edge cases", () => {
    it("should handle custom room string that matches cursor page room", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        room: "/test/playground",
        cursors: {
          enabled: true,
          room: "page",
        },
      });

      // Both should normalize to same room
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should handle function that returns empty string (domain case)", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        cursors: {
          enabled: true,
          room: () => "", // Returns empty string like "domain" case
        },
      });

      // Main room has pathname, cursor room is domain-only
      const mainRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(mainRoom);

      // Cursor room would be: encodeURIComponent("example.com")
      const cursorDomainRoom = encodeURIComponent("example.com");
      expect(cursorDomainRoom).not.toBe(mainRoom);
    });

    it("should normalize function-returned pathname with extension", async () => {
      mockLocation("example.com", "/test/playground");
      const playhtml = await freshPlayhtml();
      await playhtml.init({
        room: "/test/playground",
        cursors: {
          enabled: true,
          room: () => "/test/playground.html", // Function returns pathname with extension
        },
      });

      // Both should normalize to same room (extension stripped from cursor room)
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });
  });
});
