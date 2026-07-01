// ABOUTME: Verifies Chrome Web Store submit API request and response handling.
// ABOUTME: Covers release submission behavior without calling external APIs.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { ensureChromeResponseSucceeded, submitChrome } from "./submitChrome.mjs";

const tempDirs = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const removals = tempDirs
    .splice(0)
    .map((dir) => rm(dir, { recursive: true, force: true }));
  await Promise.all(removals);
});

async function writeTempZip() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "submit-chrome-"));
  tempDirs.push(dir);
  const zipPath = path.join(dir, "extension.zip");
  await writeFile(zipPath, "zip");
  return zipPath;
}

test("throws when a Chrome API response has a failing HTTP status", async () => {
  const response = new Response(
    JSON.stringify({
      error: {
        message: "Invalid value",
      },
    }),
    {
      status: 400,
      statusText: "Bad Request",
      headers: {
        "content-type": "application/json",
      },
    },
  );

  await expect(ensureChromeResponseSucceeded("upload", response)).rejects.toThrow(
    /Chrome upload failed: 400 Bad Request/,
  );
});

test("throws when Chrome publish returns a non-OK status", async () => {
  const response = new Response(
    JSON.stringify({
      status: ["ITEM_PENDING_REVIEW"],
    }),
    {
      status: 200,
      statusText: "OK",
      headers: {
        "content-type": "application/json",
      },
    },
  );

  await expect(ensureChromeResponseSucceeded("publish", response)).rejects.toThrow(
    /Chrome publish did not return OK: ITEM_PENDING_REVIEW/,
  );
});

test("throws when Chrome submit review is disabled", async () => {
  await expect(
    submitChrome({
      env: {
        CHROME_SKIP_SUBMIT_REVIEW: "true",
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    }),
  ).rejects.toThrow(/would upload without changing the live store package/);
});

test("requests Chrome OAuth token with form-encoded refresh credentials", async () => {
  const requests = [];
  const logs = [];
  vi.spyOn(console, "log").mockImplementation((message) => logs.push(String(message)));

  await submitChrome({
    env: {
      DRY_RUN: "true",
      CHROME_ZIP: await writeTempZip(),
      CHROME_EXTENSION_ID: "chrome-extension-id",
      CHROME_CLIENT_ID: "client-id",
      CHROME_CLIENT_SECRET: "client-secret",
      CHROME_REFRESH_TOKEN: "refresh-token",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
        }),
        {
          status: 200,
          statusText: "OK",
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://oauth2.googleapis.com/token");
  expect(requests[0].options.headers["content-type"]).toBe(
    "application/x-www-form-urlencoded",
  );
  expect(requests[0].options.body).toBeInstanceOf(URLSearchParams);
  expect(Object.fromEntries(requests[0].options.body)).toEqual({
    client_id: "client-id",
    client_secret: "client-secret",
    refresh_token: "refresh-token",
    grant_type: "refresh_token",
  });
  expect(logs).toContain("DRY RUN: Chrome token is valid; skipped upload and publish.");
});
