// ABOUTME: Dev-only endpoint that serves the workspace playhtml ESM build to the
// ABOUTME: playground iframe so library edits reflect live without rebuilding.
import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

// Resolve the workspace playhtml ESM build. We read package.json's "module"
// (or "main") field to find the canonical entry, so this stays correct even
// if the build output filename changes.
async function resolvePlayhtmlEntry(): Promise<string> {
  const pkgPath = path.join(repoRoot, "packages/playhtml/package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const rel = pkg.module ?? pkg.main ?? "dist/index.js";
  return path.join(repoRoot, "packages/playhtml", rel);
}

export const GET: APIRoute = async () => {
  if (import.meta.env.PROD) {
    return new Response("dev shim not available in production", { status: 404 });
  }
  try {
    const entry = await resolvePlayhtmlEntry();
    const code = await readFile(entry, "utf8");
    return new Response(code, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(`failed to load playhtml from workspace: ${(err as Error).message}`, {
      status: 500,
    });
  }
};
