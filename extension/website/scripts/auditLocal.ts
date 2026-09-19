// ABOUTME: Serves private commute evaluation artifacts only to same-origin loopback clients.
// ABOUTME: Prevents generated browsing datasets from entering website deployment builds.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";

const artifacts = ["commute-audit-data.json", "commute-evaluation-data.json"];

export function assertPrivateAuditArtifacts(websiteRoot: string): void {
  for (const name of artifacts) {
    if (existsSync(path.join(websiteRoot, "public", name))) {
      throw new Error(`Move public/${name} to private-data before building; audit data must not be deployed`);
    }
  }
}

export function isLocalAuditRequest(request: Pick<IncomingMessage, "headers" | "socket">): boolean {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) return false;
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)) return false;
    if (request.headers.origin && request.headers.origin !== host.origin) return false;
    return !request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin" || request.headers["sec-fetch-site"] === "none";
  } catch { return false; }
}

export function auditLocal(websiteRoot: string, enabled: boolean): Plugin {
  const privateRoot = path.resolve(websiteRoot, "../../private-data");
  const install: NonNullable<Plugin["configureServer"]> = (server) => {
    server.middlewares.use(async (request, response, next) => {
      const name = request.url?.split("?")[0]?.slice(1);
      if (!artifacts.includes(name ?? "")) return next();
      if (!enabled || !isLocalAuditRequest(request)) {
        response.statusCode = 403;
        response.end("Audit data requires local audit mode");
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json");
      try { response.end(await readFile(path.join(privateRoot, name as string))); }
      catch (error) {
        response.statusCode = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
        response.end("Audit data unavailable");
      }
    });
  };
  return {
    name: "private-commute-audit",
    buildStart() {
      assertPrivateAuditArtifacts(websiteRoot);
    },
    configureServer: install,
    configurePreviewServer: install as NonNullable<Plugin["configurePreviewServer"]>,
  };
}
