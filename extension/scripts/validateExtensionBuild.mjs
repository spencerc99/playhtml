#!/usr/bin/env node
// ABOUTME: Validates built extension manifests against files in the output directory.
// ABOUTME: Catches store-facing package errors before upload automation submits zips.
import fs from "node:fs/promises";
import path from "node:path";

function collectManifestResources(manifest) {
  const resources = [];

  for (const script of manifest.content_scripts ?? []) {
    resources.push(...(script.js ?? []));
    resources.push(...(script.css ?? []));
  }

  for (const group of manifest.web_accessible_resources ?? []) {
    resources.push(...(group.resources ?? []));
  }

  return resources;
}

export async function validateExtensionBuild(buildDir) {
  const manifestPath = path.join(buildDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const resources = collectManifestResources(manifest);
  const missingResources = [];

  for (const resource of resources) {
    try {
      await fs.stat(path.join(buildDir, resource));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missingResources.push(resource);
    }
  }

  if (missingResources.length > 0) {
    throw new Error(
      `Extension build references missing files:\n${missingResources
        .map((resource) => `  - ${resource}`)
        .join("\n")}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateExtensionBuild(process.argv[2] ?? "publish/chrome-mv3").catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
