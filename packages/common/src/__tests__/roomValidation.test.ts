import { describe, it, expect } from "bun:test";
import {
  normalizeHost,
  normalizePath,
  createRoomId,
  validateAndSanitizeRoomId,
  isInvalidRoomId,
} from "../roomValidation";

describe("normalizeHost", () => {
  it("should handle empty host (local file)", () => {
    expect(normalizeHost("")).toBe("local-file");
    expect(normalizeHost(undefined)).toBe("local-file");
  });

  it("should handle file protocol", () => {
    expect(normalizeHost("file://")).toBe("local-file");
  });

  it("should handle localhost", () => {
    expect(normalizeHost("localhost")).toBe("local-file");
    expect(normalizeHost("localhost:3000")).toBe("local-file");
  });

  it("should strip www prefix", () => {
    expect(normalizeHost("www.example.com")).toBe("example.com");
    expect(normalizeHost("www.subdomain.example.com")).toBe(
      "subdomain.example.com"
    );
  });

  it("should remove standard ports", () => {
    expect(normalizeHost("example.com:80")).toBe("example.com");
    expect(normalizeHost("example.com:443")).toBe("example.com");
  });

  it("should keep non-standard ports", () => {
    expect(normalizeHost("example.com:3000")).toBe("example.com:3000");
    expect(normalizeHost("example.com:8080")).toBe("example.com:8080");
  });

  it("should lowercase the host", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
    expect(normalizeHost("WWW.Example.COM")).toBe("example.com");
  });

  it("should handle Windows paths", () => {
    expect(normalizeHost("C:\\Users\\test")).toBe("local-file");
  });
});

describe("normalizePath", () => {
  it("should handle empty path", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath(undefined)).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });

  it("should remove file extensions", () => {
    expect(normalizePath("/index.html")).toBe("/index");
    expect(normalizePath("/page.php")).toBe("/page");
    expect(normalizePath("/test.something.html")).toBe("/test.something");
  });

  it("should handle filesystem paths", () => {
    expect(normalizePath("C:\\Users\\test\\file.html")).toBe("/file");
    expect(normalizePath("/Users/test/file.html")).toBe("/file");
    expect(normalizePath("file:///path/to/file.html")).toBe("/file");
  });

  it("should remove trailing slash", () => {
    expect(normalizePath("/test/")).toBe("/test");
    expect(normalizePath("/a/b/c/")).toBe("/a/b/c");
  });

  it("should ensure leading slash", () => {
    expect(normalizePath("test")).toBe("/test");
    expect(normalizePath("a/b/c")).toBe("/a/b/c");
  });

  it("should handle complex paths", () => {
    expect(normalizePath("/test/playground/index.html")).toBe(
      "/test/playground/index"
    );
    expect(normalizePath("/api/v1/users")).toBe("/api/v1/users");
  });
});

describe("createRoomId", () => {
  it("should create domain-only room ID", () => {
    const roomId = createRoomId("example.com", undefined);
    expect(roomId).toBe(encodeURIComponent("example.com"));
  });

  it("should create room ID with path", () => {
    const roomId = createRoomId("example.com", "/test");
    expect(roomId).toBe(encodeURIComponent("example.com-/test"));
  });

  it("should normalize host", () => {
    const roomId = createRoomId("www.example.com", "/test");
    expect(roomId).toBe(encodeURIComponent("example.com-/test"));
  });

  it("should normalize path", () => {
    const roomId = createRoomId("example.com", "/test.html");
    expect(roomId).toBe(encodeURIComponent("example.com-/test"));
  });

  it("should handle local file paths", () => {
    const roomId = createRoomId("", "/test.html");
    expect(roomId).toBe(encodeURIComponent("local-file-/test"));
  });

  it("should handle root path as domain-only", () => {
    const roomId = createRoomId("example.com", "/");
    expect(roomId).toBe(encodeURIComponent("example.com"));
  });

  it("should consolidate www domains", () => {
    const roomId1 = createRoomId("www.example.com", "/page");
    const roomId2 = createRoomId("example.com", "/page");
    expect(roomId1).toBe(roomId2);
  });

  it("should handle query parameters in path", () => {
    const roomId = createRoomId("example.com", "/page?foo=bar");
    expect(roomId).toBe(encodeURIComponent("example.com-/page?foo=bar"));
  });
});

describe("validateAndSanitizeRoomId", () => {
  it("should accept valid room IDs", () => {
    expect(() =>
      validateAndSanitizeRoomId("example.com-/test")
    ).not.toThrow();
    expect(() => validateAndSanitizeRoomId("example.com")).not.toThrow();
  });

  it("should reject undefined string", () => {
    expect(() => validateAndSanitizeRoomId("undefined")).toThrow();
    expect(() => validateAndSanitizeRoomId("null")).toThrow();
  });

  it("should reject empty strings", () => {
    expect(() => validateAndSanitizeRoomId("")).toThrow();
    expect(() => validateAndSanitizeRoomId("   ")).toThrow();
  });

  it("should encode room IDs", () => {
    const result = validateAndSanitizeRoomId("example.com-/test page");
    expect(result).toBe(encodeURIComponent("example.com-/test page"));
  });

  it("should handle very long room IDs by hashing overflow", () => {
    const longPath = "/a".repeat(300);
    const longRoomId = `example.com-${longPath}`;
    const result = validateAndSanitizeRoomId(longRoomId);

    // Should be truncated and have hash appended
    expect(result.length).toBeLessThan(encodeURIComponent(longRoomId).length);
    expect(result).toContain("hash");
  });
});

describe("isInvalidRoomId", () => {
  it("should detect undefined in room ID", () => {
    expect(isInvalidRoomId("undefined-/test")).toBe(true);
    expect(isInvalidRoomId("example.com-undefined")).toBe(true);
  });

  it("should detect null in room ID", () => {
    expect(isInvalidRoomId("null-/test")).toBe(true);
    expect(isInvalidRoomId("example.com-null")).toBe(true);
  });

  it("should detect Windows paths", () => {
    expect(isInvalidRoomId("C:\\Users\\test")).toBe(true);
    expect(isInvalidRoomId("D:\\path\\to\\file")).toBe(true);
  });

  it("should detect Unix absolute paths", () => {
    expect(isInvalidRoomId("/Users/test/file")).toBe(true);
    expect(isInvalidRoomId("/home/user/project")).toBe(true);
  });

  it("should detect file protocol", () => {
    expect(isInvalidRoomId("file:///path/to/file")).toBe(true);
  });

  it("should accept valid room IDs", () => {
    expect(isInvalidRoomId("example.com-/test")).toBe(false);
    expect(isInvalidRoomId("example.com")).toBe(false);
    expect(isInvalidRoomId("local-file-/test")).toBe(false);
  });
});

describe("integration tests", () => {
  it("should handle complete room creation flow", () => {
    // Simulate browser environment
    const host = "www.example.com:443";
    const path = "/test/page.html";

    const roomId = createRoomId(host, path);

    // Should normalize www, strip port 443, remove .html
    expect(roomId).toBe(encodeURIComponent("example.com-/test/page"));
  });

  it("should handle local file testing", () => {
    const host = "";
    const path = "file:///Users/test/mypage.html";

    const roomId = createRoomId(host, path);

    expect(roomId).toBe(encodeURIComponent("local-file-/mypage"));
  });

  it("should create consistent IDs for www and non-www", () => {
    const roomId1 = createRoomId("www.example.com", "/page");
    const roomId2 = createRoomId("example.com", "/page");
    const roomId3 = createRoomId("WWW.EXAMPLE.COM", "/page");

    expect(roomId1).toBe(roomId2);
    expect(roomId2).toBe(roomId3);
  });

  it("should handle edge case: domain with path separator", () => {
    // This could happen with malformed URLs
    const roomId = createRoomId("example.com/malformed", "/test");
    expect(isInvalidRoomId(roomId)).toBe(false);
  });
});
