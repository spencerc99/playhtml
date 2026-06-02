#!/usr/bin/env node
// ABOUTME: Submits Microsoft Edge Add-ons extension zips and checks operation status.
// ABOUTME: Used by CI and local release scripts to update the Edge store package.
import fs from "node:fs/promises";

const EDGE_API_ROOT = "https://api.addons.microsoftedge.microsoft.com";
const DEFAULT_CERTIFICATION_NOTES = "Automated extension release.";

function booleanEnv(value) {
  if (value == null || value === "") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function edgeHeaders(env, extra = {}) {
  return {
    authorization: `ApiKey ${requireEnv(env, "EDGE_API_KEY")}`,
    "x-clientid": requireEnv(env, "EDGE_CLIENT_ID"),
    ...extra,
  };
}

function uploadUrl(productId) {
  return `${EDGE_API_ROOT}/v1/products/${productId}/submissions/draft/package`;
}

function uploadStatusUrl(productId, operationId) {
  return `${EDGE_API_ROOT}/v1/products/${productId}/submissions/draft/package/operations/${operationId}`;
}

function publishUrl(productId) {
  return `${EDGE_API_ROOT}/v1/products/${productId}/submissions`;
}

function publishStatusUrl(productId, operationId) {
  return `${EDGE_API_ROOT}/v1/products/${productId}/submissions/operations/${operationId}`;
}

function operationIdFromLocation(location) {
  if (!location) throw new Error("Edge response did not include an operation location");
  const segments = location.split("/").filter(Boolean);
  const operationId = segments.at(-1);
  if (!operationId) throw new Error(`Edge response included an invalid operation location: ${location}`);
  return operationId;
}

async function ensureEdgeResponseAccepted(action, response) {
  const body = await readResponseBody(response);

  if (!response.ok) {
    const detail = formatBody(body);
    throw new Error(
      `Edge ${action} failed: ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`,
    );
  }

  return body;
}

async function waitForEdgeOperation({
  action,
  operationUrl,
  env,
  fetchImpl,
  sleepImpl,
}) {
  const pollLimit = Number(env.EDGE_POLL_LIMIT || 10);
  const pollIntervalMs = Number(env.EDGE_POLL_INTERVAL_MS || 5000);

  for (let attempt = 1; attempt <= pollLimit; attempt += 1) {
    const response = await fetchImpl(operationUrl, {
      method: "GET",
      headers: edgeHeaders(env),
    });
    const body = await ensureEdgeResponseAccepted(`${action} status`, response);
    const status = body?.status;

    if (status === "Succeeded") {
      console.log(`Edge ${action} succeeded.`);
      return body;
    }

    if (status && status !== "InProgress") {
      throw new Error(`Edge ${action} failed with status: ${status}`);
    }

    if (attempt < pollLimit) await sleepImpl(pollIntervalMs);
  }

  throw new Error(`Edge ${action} did not finish after ${pollLimit} status checks`);
}

export async function submitEdge({
  env = process.env,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const zipPath = requireEnv(env, "EDGE_ZIP");
  const productId = requireEnv(env, "EDGE_PRODUCT_ID");
  requireEnv(env, "EDGE_CLIENT_ID");
  requireEnv(env, "EDGE_API_KEY");
  const dryRun = booleanEnv(env.DRY_RUN);

  await fs.stat(zipPath);
  console.log(`Edge zip: ${zipPath}`);

  if (dryRun) {
    console.log("DRY RUN: Edge inputs are present; skipped upload and publish.");
    return;
  }

  const zip = await fs.readFile(zipPath);
  const uploadResponse = await fetchImpl(uploadUrl(productId), {
    method: "POST",
    headers: edgeHeaders(env, {
      "content-type": "application/zip",
      "content-length": String(zip.byteLength),
    }),
    body: zip,
  });
  await ensureEdgeResponseAccepted("upload", uploadResponse);
  const uploadOperationId = operationIdFromLocation(uploadResponse.headers.get("location"));

  await waitForEdgeOperation({
    action: "upload",
    operationUrl: uploadStatusUrl(productId, uploadOperationId),
    env,
    fetchImpl,
    sleepImpl,
  });

  const publishResponse = await fetchImpl(publishUrl(productId), {
    method: "POST",
    headers: edgeHeaders(env, {
      "content-type": "application/json",
    }),
    body: JSON.stringify({
      notes: env.EDGE_CERTIFICATION_NOTES || DEFAULT_CERTIFICATION_NOTES,
    }),
  });
  await ensureEdgeResponseAccepted("publish", publishResponse);
  const publishOperationId = operationIdFromLocation(publishResponse.headers.get("location"));

  await waitForEdgeOperation({
    action: "publish",
    operationUrl: publishStatusUrl(productId, publishOperationId),
    env,
    fetchImpl,
    sleepImpl,
  });

  console.log("Edge will update the live store package after Add-ons review approval.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  submitEdge().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
