// ABOUTME: Verifies the installation control client accepts only safe Worker payloads.
// ABOUTME: Covers no-store requests, server failures, and malformed generations.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getInstallationControl,
  parseInstallationControl,
} from "../installationControlApi";

vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

describe("installation control API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests and validates the public no-store control", async () => {
    const payload = { generation: 12, updatedAt: "2026-09-06 12:00:00" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getInstallationControl()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example/installation/control",
      { cache: "no-store" },
    );
  });

  it("rejects failed and malformed responses", async () => {
    expect(() => parseInstallationControl({ generation: -1, updatedAt: "now" })).toThrow();
    expect(() => parseInstallationControl({ generation: 1.5, updatedAt: "now" })).toThrow();
    expect(() => parseInstallationControl({ generation: 1 })).toThrow();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    await expect(getInstallationControl()).rejects.toThrow("503");
  });
});
