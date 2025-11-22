/**
 * Room ID validation and normalization utilities
 * These functions ensure consistent room ID generation and handle edge cases
 */

/**
 * Simple hash function for truncating long room IDs
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Normalizes a host string for consistent room IDs
 * - Handles local file testing
 * - Strips www prefix
 * - Removes standard ports (80, 443)
 * - Lowercases for consistency
 */
export function normalizeHost(host: string | undefined): string {
  // Handle local file testing
  if (
    !host ||
    host === "" ||
    host.startsWith("file") ||
    host.includes(":\\") ||
    host.includes("localhost")
  ) {
    return "local-file";
  }

  // Lowercase first for consistent processing
  let normalized = host.toLowerCase();

  // Strip www prefix
  normalized = normalized.replace(/^www\./, "");

  // Remove standard ports
  normalized = normalized.replace(/:(80|443)$/, "");

  return normalized;
}

/**
 * Normalizes a path string for consistent room IDs
 * - Handles local filesystem paths
 * - Removes file extensions
 * - Ensures consistent slash behavior
 */
export function normalizePath(path: string | undefined): string {
  // Handle empty/root
  if (!path || path === "/" || path === "") {
    return "/";
  }

  // Handle local filesystem paths - extract just the filename
  // Check for Windows paths (C:\), file:// protocol, or common Unix home directories
  if (
    path.includes(":\\") ||
    path.startsWith("file://") ||
    path.startsWith("/Users/") ||
    path.startsWith("/home/")
  ) {
    const filename = path.split(/[/\\]/).pop()?.replace(/\.[^.]*$/, "") || "";
    return filename ? `/${filename}` : "/";
  }

  // Remove file extensions
  let normalized = path.replace(/\.[^/.]+$/, "");

  // Remove trailing slash (except root)
  normalized = normalized.replace(/\/$/, "") || "/";

  // Ensure leading slash
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }

  return normalized;
}

/**
 * Validates and sanitizes a room ID
 * - Rejects invalid patterns
 * - Enforces length limits
 * - Returns encoded room ID
 */
export function validateAndSanitizeRoomId(roomId: string): string {
  // Reject obvious invalid patterns
  if (
    !roomId ||
    roomId === "undefined" ||
    roomId === "null" ||
    roomId.trim() === ""
  ) {
    throw new Error("Invalid room ID: empty or undefined");
  }

  // Encode the room ID
  const encoded = encodeURIComponent(roomId);

  // Max length constraint (255 characters after encoding)
  const MAX_LENGTH = 255;
  if (encoded.length > MAX_LENGTH) {
    // Hash the overflow part
    const base = encoded.substring(0, 200);
    const overflow = encoded.substring(200);
    const hash = simpleHash(overflow);
    return `${base}-hash${hash}`;
  }

  return encoded;
}

/**
 * Creates a normalized room ID from host and path
 * This is the main function to use for generating room IDs
 */
export function createRoomId(host: string | undefined, path: string | undefined): string {
  const normalizedHost = normalizeHost(host);
  const normalizedPath = normalizePath(path);

  const roomId = normalizedPath === "/"
    ? normalizedHost
    : `${normalizedHost}-${normalizedPath}`;

  return validateAndSanitizeRoomId(roomId);
}

/**
 * Checks if a room ID appears to be invalid (for migration purposes)
 */
export function isInvalidRoomId(roomId: string): boolean {
  // Check for common invalid patterns
  if (roomId.includes("undefined")) return true;
  if (roomId.includes("null")) return true;
  if (roomId.includes(":\\")) return true; // Windows path
  if (roomId.includes("/Users/")) return true; // Unix absolute path
  if (roomId.includes("/home/")) return true; // Unix absolute path
  if (roomId.startsWith("file")) return true;

  return false;
}
