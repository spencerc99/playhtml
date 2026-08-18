// ABOUTME: Tests the WWO admin office beta-access API client.
// ABOUTME: Covers public-ID validation and authenticated mutation request shapes.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addInternalAccess,
  isValidPublicId,
  removeInternalAccess,
} from "./internalAccessApi";

vi.mock("@movement/config", () => ({
  WORKER_URL: "https://worker.example",
}));

const PUBLIC_ID = `pk_${"a".repeat(130)}`;

describe("internalAccessApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts only complete extension public IDs", () => {
    expect(isValidPublicId(PUBLIC_ID)).toBe(true);
    expect(isValidPublicId("pk_short")).toBe(false);
    expect(isValidPublicId(`user_${"a".repeat(130)}`)).toBe(false);
  });

  it("adds a public ID with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ publicId: PUBLIC_ID, addedAt: "now" }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(addInternalAccess("secret", ` ${PUBLIC_ID.toUpperCase()} `)).resolves.toEqual({
      publicId: PUBLIC_ID,
      addedAt: "now",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example/admin/internal-access",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicId: PUBLIC_ID }),
      }),
    );
  });

  it("removes the exact encoded public ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await removeInternalAccess("secret", PUBLIC_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://worker.example/admin/internal-access/${PUBLIC_ID}`,
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer secret" },
      }),
    );
  });
});
