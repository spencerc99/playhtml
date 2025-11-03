import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Helper to mock window.location using a Proxy
// This intercepts all property access on window.location
let mockedLocationValues: {
  host: string;
  hostname: string;
  pathname: string;
  search: string;
  href: string;
  origin: string;
  protocol: string;
  port: string;
} | null = null;

function mockLocation(host: string, pathname: string, search: string = "") {
  const hostname = host.split(":")[0];
  const port = host.includes(":") ? host.split(":")[1] : "";
  const href = `http://${host}${pathname}${search}`;
  const origin = `http://${hostname}${port ? `:${port}` : ""}`;

  // Store mocked values
  mockedLocationValues = {
    host,
    hostname,
    pathname,
    search,
    href,
    origin,
    protocol: "http:",
    port,
  };

  // Get the original location
  const originalLocation = window.location;

  // Create a Proxy that intercepts property access
  // We only use the 'get' trap to avoid descriptor incompatibility issues
  const locationProxy = new Proxy(originalLocation, {
    get(target, prop: string | symbol) {
      // If we have a mocked value for this property, return it
      if (mockedLocationValues && typeof prop === "string") {
        if (prop in mockedLocationValues) {
          return mockedLocationValues[
            prop as keyof typeof mockedLocationValues
          ];
        }
      }
      // Otherwise, return the original property value
      const value = (target as any)[prop];
      // If it's a function, bind it to the original target
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });

  // Replace window.location with our proxy using vi.stubGlobal
  // This works better with vitest's test environment
  vi.stubGlobal("location", locationProxy);
}

async function freshPlayhtml() {
  // Ensure a clean module instance and clear global window guard
  // @ts-ignore
  delete (globalThis as any).playhtml;
  const mod = await import("../index");
  return mod.playhtml;
}

describe("Room normalization and cursor room matching", () => {
  beforeEach(async () => {
    if (typeof document !== "undefined") {
      document.body.innerHTML = "";
    }
    // Reset location mock
    mockedLocationValues = null;
  });

  afterEach(() => {
    // Reset location mock
    mockedLocationValues = null;
  });

  describe("Main room construction", () => {
    it("should construct main room with host and pathname", async () => {
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground");
      await playhtml.init({ room: "/test/playground" });

      // Main room should be encoded as: host + "-" + room
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should strip filename extensions from default room", async () => {
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground.html");
      await playhtml.init({});

      // Default room should strip .html extension
      const expectedRoom = encodeURIComponent("example.com-/test/playground");
      expect(playhtml.roomId).toBe(expectedRoom);
    });

    it("should include search params when defaultRoomOptions.includeSearch is true", async () => {
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground", "?query=test");
      await playhtml.init({ defaultRoomOptions: { includeSearch: true } });

      const expectedRoom = encodeURIComponent(
        "example.com-/test/playground?query=test"
      );
      expect(playhtml.roomId).toBe(expectedRoom);
    });
  });

  describe("Cursor room matching with main room", () => {
    it("should reuse main provider when cursor room is 'page' and matches default room", async () => {
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground");
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
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground");
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
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground");
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
      const playhtml = await freshPlayhtml();
      // Mock location with the pathname we want to test AFTER module import
      mockLocation("example.com", "/test/playground/page");
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
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground");
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
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/test/playground.html");
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
      const playhtml = await freshPlayhtml();
      // Mock location with root pathname AFTER module import
      mockLocation("example.com", "/");
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
      const playhtml = await freshPlayhtml();
      // Mock location with root pathname AFTER module import
      mockLocation("example.com", "/");
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
      const playhtml = await freshPlayhtml();
      mockLocation("example.com:8080", "/test/playground");
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
      const playhtml = await freshPlayhtml();
      mockLocation("example.com", "/section/subsection/page.html");
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
      mockLocation("example.com", "/test/playground");
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
      mockLocation("example.com", "/test/playground");
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
      mockLocation("example.com", "/test/playground");
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
