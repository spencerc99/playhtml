// ABOUTME: Verifies installation administration request URLs and bearer authentication.
// ABOUTME: Covers public status reads and protected production reload mutations.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentInstallationControl,
  reloadInstallationScreens,
} from "./installationControlApi";

vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

const responseBody = { generation: 3, updatedAt: "2026-09-06 12:00:00" };

describe("installation admin API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads current control without credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentInstallationControl()).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example/installation/control",
      { cache: "no-store" },
    );
  });

  it("sends the admin key only as a bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody)));
    vi.stubGlobal("fetch", fetchMock);

    await reloadInstallationScreens("admin-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://worker.example/admin/installation/reload",
      {
        method: "POST",
        headers: { Authorization: "Bearer admin-secret" },
      },
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("admin-secret");
  });
});
