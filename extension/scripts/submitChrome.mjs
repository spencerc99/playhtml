#!/usr/bin/env node
// ABOUTME: Submits Chrome extension zips and fails on Chrome Web Store API errors.
// ABOUTME: Used by CI and local release scripts to avoid silent upload failures.
import fs from "node:fs/promises";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHROME_API_VERSION_HEADER = "2";

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

export async function ensureChromeResponseSucceeded(action, response) {
  const body = await readResponseBody(response);

  if (!response.ok) {
    const detail = formatBody(body);
    throw new Error(
      `Chrome ${action} failed: ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`,
    );
  }

  if (action === "upload") {
    if (Array.isArray(body?.itemError) && body.itemError.length > 0) {
      throw new Error(`Chrome upload returned item errors: ${formatBody(body.itemError)}`);
    }

    if (body?.uploadState && body.uploadState !== "SUCCESS") {
      throw new Error(`Chrome upload did not complete: ${body.uploadState}`);
    }
  }

  if (action === "publish") {
    const statuses = Array.isArray(body?.status) ? body.status : [];
    if (!statuses.includes("OK")) {
      throw new Error(
        `Chrome publish did not return OK: ${statuses.length > 0 ? statuses.join(", ") : "missing status"}`,
      );
    }
  }

  return body;
}

async function getAccessToken({ env, fetchImpl }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requireEnv(env, "CHROME_CLIENT_ID"),
      client_secret: requireEnv(env, "CHROME_CLIENT_SECRET"),
      refresh_token: requireEnv(env, "CHROME_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  const body = await ensureChromeResponseSucceeded("token", response);
  if (!body?.access_token || !body?.token_type) {
    throw new Error("Chrome token response did not include an access token");
  }

  return `${body.token_type} ${body.access_token}`;
}

function chromeUploadUrl(extensionId) {
  return `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}?uploadType=media`;
}

function chromePublishUrl({ extensionId, publishTarget, deployPercentage, reviewExemption }) {
  const url = new URL(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish`,
  );
  url.searchParams.set("publishTarget", publishTarget);
  if (deployPercentage) url.searchParams.set("deployPercentage", deployPercentage);
  if (reviewExemption) url.searchParams.set("reviewExemption", "true");
  return url.href;
}

export async function submitChrome({ env = process.env, fetchImpl = fetch } = {}) {
  if (booleanEnv(env.CHROME_SKIP_SUBMIT_REVIEW)) {
    throw new Error("CHROME_SKIP_SUBMIT_REVIEW=true would upload without changing the live store package");
  }

  const zipPath = requireEnv(env, "CHROME_ZIP");
  const extensionId = requireEnv(env, "CHROME_EXTENSION_ID");
  const dryRun = booleanEnv(env.DRY_RUN);

  await fs.stat(zipPath);
  console.log(`Chrome zip: ${zipPath}`);

  const authorization = await getAccessToken({ env, fetchImpl });
  if (dryRun) {
    console.log("DRY RUN: Chrome token is valid; skipped upload and publish.");
    return;
  }

  const zip = await fs.readFile(zipPath);
  const uploadResponse = await fetchImpl(chromeUploadUrl(extensionId), {
    method: "PUT",
    headers: {
      authorization,
      "content-type": "application/zip",
      "content-length": String(zip.byteLength),
      "x-goog-api-version": CHROME_API_VERSION_HEADER,
    },
    body: zip,
  });
  const uploadBody = await ensureChromeResponseSucceeded("upload", uploadResponse);
  console.log(`Chrome upload accepted${uploadBody?.uploadState ? `: ${uploadBody.uploadState}` : ""}.`);

  const publishResponse = await fetchImpl(
    chromePublishUrl({
      extensionId,
      publishTarget: env.CHROME_PUBLISH_TARGET || "default",
      deployPercentage: env.CHROME_DEPLOY_PERCENTAGE,
      reviewExemption: booleanEnv(env.CHROME_REVIEW_EXEMPTION),
    }),
    {
      method: "POST",
      headers: {
        authorization,
        "content-length": "0",
        "x-goog-api-version": CHROME_API_VERSION_HEADER,
      },
    },
  );
  const publishBody = await ensureChromeResponseSucceeded("publish", publishResponse);
  console.log(`Chrome publish accepted: ${publishBody.status.join(", ")}.`);
  console.log("Chrome will update the live store package after Web Store review approval.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  submitChrome().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
