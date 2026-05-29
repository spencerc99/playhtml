// ABOUTME: Verifies Chrome Web Store submit API response handling.
// ABOUTME: Covers failed upload and publish statuses without calling external APIs.
import assert from "node:assert/strict";
import test from "node:test";

import { ensureChromeResponseSucceeded, submitChrome } from "./submitChrome.mjs";

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

  await assert.rejects(
    ensureChromeResponseSucceeded("upload", response),
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

  await assert.rejects(
    ensureChromeResponseSucceeded("publish", response),
    /Chrome publish did not return OK: ITEM_PENDING_REVIEW/,
  );
});

test("throws when Chrome submit review is disabled", async () => {
  await assert.rejects(
    submitChrome({
      env: {
        CHROME_SKIP_SUBMIT_REVIEW: "true",
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
    }),
    /would upload without changing the live store package/,
  );
});
