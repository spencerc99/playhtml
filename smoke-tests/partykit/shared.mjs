// ABOUTME: Provides shared helpers for PartyKit staging smoke tests.
// ABOUTME: Connects real Yjs clients and loads optional local smoke-test env files.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(repoRoot, "package.json"));

export const Y = require("yjs");
export const { syncedStore } = require("@syncedstore/core");
const YProviderModule = require("y-partyserver/provider");
const WebSocket = require("ws");
const YProvider = YProviderModule.default ?? YProviderModule;

export const defaultHost = "playhtml-staging.spencerc99.workers.dev";

export function getHost() {
  return process.env.PARTYKIT_HOST ?? defaultHost;
}

export function getNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number, got ${raw}`);
  }
  return parsed;
}

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function deriveRoomId(host, inputRoom) {
  const normalizedHost = host ? host.replace(/^www\./i, "") : "LOCAL";
  const normalizedPath = inputRoom
    ? inputRoom.replace(/\.[^/.]+$/, "")
    : "/";
  const path = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return encodeURIComponent(`${normalizedHost}-${path}`);
}

export function createStore(doc) {
  return syncedStore({ play: {} }, doc);
}

export function connectRoom(host, room, doc, params = {}) {
  return new YProvider(host, room, doc, {
    party: "main",
    WebSocketPolyfill: WebSocket,
    disableBc: true,
    params,
  });
}

export function waitForSync(provider, label, timeoutMs = 20_000) {
  return new Promise((resolveSync, reject) => {
    if (provider.synced) {
      resolveSync();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} did not sync within ${timeoutMs}ms`));
    }, timeoutMs);

    const onSync = (synced) => {
      console.log(`${label}: sync=${synced}`);
      if (synced) {
        cleanup();
        resolveSync();
      }
    };

    const onStatus = (event) => {
      console.log(`${label}: status=${event.status}`);
    };

    function cleanup() {
      clearTimeout(timer);
      provider.off("sync", onSync);
      provider.off("status", onStatus);
    }

    provider.on("sync", onSync);
    provider.on("status", onStatus);
  });
}

export function waitForRoomReset(provider, timeoutMs = 20_000) {
  return new Promise((resolveReset, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("stale reconnect did not receive room-reset"));
    }, timeoutMs);

    const onMessage = (data) => {
      const message = JSON.parse(data);
      if (message.type === "room-reset") {
        cleanup();
        resolveReset(message.resetEpoch);
      }
    };

    function cleanup() {
      clearTimeout(timer);
      provider.off("custom-message", onMessage);
    }

    provider.on("custom-message", onMessage);
  });
}

export function waitForProviderStatus(
  provider,
  expectedStatus,
  timeoutMs = 20_000
) {
  return new Promise((resolveStatus, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `provider did not report status=${expectedStatus} within ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    const onStatus = (event) => {
      console.log(`provider status=${event.status}`);
      if (event.status === expectedStatus) {
        cleanup();
        resolveStatus();
      }
    };

    function cleanup() {
      clearTimeout(timer);
      provider.off("status", onStatus);
    }

    provider.on("status", onStatus);
  });
}

export async function inspectRoom({ host, room, adminToken }) {
  const response = await fetch(
    `https://${host}/parties/main/${encodeURIComponent(room)}/admin/inspect`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`inspect returned non-JSON ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`inspect failed ${response.status}: ${text}`);
  }
  return body;
}

export function loadSmokeEnv() {
  const candidates = process.env.SMOKE_ENV_FILE
    ? [resolve(process.env.SMOKE_ENV_FILE)]
    : [resolve(repoRoot, ".dev.vars"), resolve(repoRoot, ".env")];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const withoutExport = trimmed.startsWith("export ")
        ? trimmed.slice("export ".length).trim()
        : trimmed;
      const separatorIndex = withoutExport.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = withoutExport.slice(0, separatorIndex).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) {
        continue;
      }

      let value = withoutExport.slice(separatorIndex + 1).trim();
      const quote = value[0];
      if (
        (quote === "\"" || quote === "'") &&
        value[value.length - 1] === quote
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    return filePath;
  }

  return null;
}
