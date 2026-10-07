// ABOUTME: Reads the tldraw license key baked into the build and says whether the tldraw editor can run.
// ABOUTME: Pure parsing of the key's expiry date, kept apart from tldraw so settings can ask without loading it.

/** The key given to the build, or an empty string when none was. */
export const BUILD_LICENSE_KEY: string = import.meta.env.WXT_TLDRAW_LICENSE_KEY ?? "";

export type TldrawLicenseStatus =
  | { usable: true; key: string; expiresOn: string }
  | { usable: false; reason: "missing" | "unreadable" | "expired"; message: string };

function decodeBase64Url(text: string): string {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

/**
 * The last day a key works, as YYYY-MM-DD. A key reads
 * `tldraw-<date>/<payload>.<signature>`, where the payload is base64 JSON
 * `[id, hosts, flags, "YYYY-MM-DD"]`.
 */
export function licenseExpiryDate(key: string): string {
  const [data] = key.split(".");
  const [prefix, payload] = data.split("/");
  if (!prefix?.startsWith("tldraw-") || !payload) {
    throw new Error("The tldraw license key is not in the tldraw-<date>/<payload> form");
  }
  const decoded: unknown = JSON.parse(decodeBase64Url(payload));
  const expiry = Array.isArray(decoded) ? decoded[3] : undefined;
  if (typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    throw new Error("The tldraw license key does not carry an expiry date");
  }
  return expiry;
}

/**
 * Whether the key still works at a moment. Trial keys have no grace period:
 * like tldraw itself, a key stops working at the start of the day after its
 * expiry date, in UTC.
 */
export function licenseStatus(key: string, now: number = Date.now()): TldrawLicenseStatus {
  if (!key) {
    return {
      usable: false,
      reason: "missing",
      message: "This build was made without a tldraw license key, so the tldraw editor is off.",
    };
  }
  let expiresOn: string;
  try {
    expiresOn = licenseExpiryDate(key);
  } catch (error) {
    return {
      usable: false,
      reason: "unreadable",
      message: `The tldraw license key in this build could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const [year, month, day] = expiresOn.split("-").map(Number);
  if (now >= Date.UTC(year, month - 1, day + 1)) {
    return {
      usable: false,
      reason: "expired",
      message: `The tldraw license ran out on ${expiresOn}, so collages open in the regular editor.`,
    };
  }
  return { usable: true, key, expiresOn };
}
