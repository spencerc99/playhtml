// ABOUTME: Verifies Microsoft Edge Add-ons submit API request handling.
// ABOUTME: Covers release automation behavior without calling external APIs.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { submitEdge } from "./submitEdge.mjs";

const tempDirs = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const removals = tempDirs
    .splice(0)
    .map((dir) => rm(dir, { recursive: true, force: true }));
  await Promise.all(removals);
});

async function writeTempZip() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "submit-edge-"));
  tempDirs.push(dir);
  const zipPath = path.join(dir, "extension.zip");
  await writeFile(zipPath, "zip");
  return zipPath;
}

test("dry run validates Edge inputs without calling the API", async () => {
  const logs = [];
  vi.spyOn(console, "log").mockImplementation((message) => logs.push(String(message)));

  await submitEdge({
    env: {
      DRY_RUN: "true",
      EDGE_ZIP: await writeTempZip(),
      EDGE_PRODUCT_ID: "edge-product-id",
      EDGE_CLIENT_ID: "edge-client-id",
      EDGE_API_KEY: "edge-api-key",
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });

  expect(logs).toContain("DRY RUN: Edge inputs are present; skipped upload and publish.");
});

test("uploads, polls, publishes, and polls an Edge submission", async () => {
  const requests = [];

  await submitEdge({
    env: {
      EDGE_ZIP: await writeTempZip(),
      EDGE_PRODUCT_ID: "edge-product-id",
      EDGE_CLIENT_ID: "edge-client-id",
      EDGE_API_KEY: "edge-api-key",
      EDGE_CERTIFICATION_NOTES: "Release notes for certification.",
      EDGE_POLL_INTERVAL_MS: "0",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });

      if (requests.length === 1) {
        return new Response("", {
          status: 202,
          statusText: "Accepted",
          headers: {
            location:
              "https://api.addons.microsoftedge.microsoft.com/v1/products/edge-product-id/submissions/draft/package/operations/upload-operation",
          },
        });
      }

      if (requests.length === 2) {
        return new Response(JSON.stringify({ status: "Succeeded" }), {
          status: 202,
          statusText: "Accepted",
          headers: {
            "content-type": "application/json",
          },
        });
      }

      if (requests.length === 3) {
        return new Response("", {
          status: 202,
          statusText: "Accepted",
          headers: {
            location:
              "https://api.addons.microsoftedge.microsoft.com/v1/products/edge-product-id/submissions/operations/publish-operation",
          },
        });
      }

      return new Response(JSON.stringify({ status: "Succeeded" }), {
        status: 202,
        statusText: "Accepted",
        headers: {
          "content-type": "application/json",
        },
      });
    },
    sleepImpl: async () => {},
  });

  expect(requests).toHaveLength(4);
  expect(requests[0].url).toBe(
    "https://api.addons.microsoftedge.microsoft.com/v1/products/edge-product-id/submissions/draft/package",
  );
  expect(requests[0].options.method).toBe("POST");
  expect(requests[0].options.headers.authorization).toBe("ApiKey edge-api-key");
  expect(requests[0].options.headers["x-clientid"]).toBe("edge-client-id");
  expect(requests[0].options.headers["content-type"]).toBe("application/zip");

  expect(requests[1].url).toBe(
    "https://api.addons.microsoftedge.microsoft.com/v1/products/edge-product-id/submissions/draft/package/operations/upload-operation",
  );
  expect(requests[1].options.method).toBe("GET");

  expect(requests[2].url).toBe(
    "https://api.addons.microsoftedge.microsoft.com/v1/products/edge-product-id/submissions",
  );
  expect(requests[2].options.method).toBe("POST");
  expect(requests[2].options.headers["content-type"]).toBe("application/json");
  expect(requests[2].options.body).toBe(
    JSON.stringify({ notes: "Release notes for certification." }),
  );

  expect(requests[3].url).toBe(
    "https://api.addons.microsoftedge.microsoft.com/v1/products/edge-product-id/submissions/operations/publish-operation",
  );
  expect(requests[3].options.method).toBe("GET");
});
