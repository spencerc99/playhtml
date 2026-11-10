// ABOUTME: Gives the generated iOS project's app and Safari extension one App Group.
// ABOUTME: Points each target's build settings at its entitlements file and lets the extension message the app.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Sets CODE_SIGN_ENTITLEMENTS in every build configuration of the app target
 * and of its Safari extension, told apart by their bundle ids. Throws when
 * either target is missing, so a packager change cannot silently drop the
 * shared folder.
 */
export function withEntitlements(project, { bundleId, app, extension }) {
  const found = { app: 0, extension: 0 };
  const updated = project.replace(
    /buildSettings = \{([\s\S]*?)\n(\t*)\};/g,
    (block, body, indent) => {
      const id = body.match(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/)?.[1];
      const entitlements =
        id === bundleId
          ? app
          : id === `${bundleId}.Extension`
            ? extension
            : null;
      if (!entitlements) return block;
      found[entitlements === app ? "app" : "extension"] += 1;
      const kept = body.replace(/\n\t*CODE_SIGN_ENTITLEMENTS = [^;]*;/g, "");
      return `buildSettings = {\n${indent}\tCODE_SIGN_ENTITLEMENTS = "${entitlements}";${kept}\n${indent}};`;
    },
  );
  if (found.app === 0 || found.extension === 0) {
    throw new Error(
      `Could not find both targets in the project (app: ${found.app}, extension: ${found.extension})`,
    );
  }
  return updated;
}

/** The iOS manifest also asks for native messaging, which the shared folder runs through. */
export function withNativeMessaging(manifest) {
  const permissions = new Set(manifest.permissions ?? []);
  permissions.add("nativeMessaging");
  return { ...manifest, permissions: [...permissions] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [projectFile, bundleId, app, extension] = process.argv.slice(2);
  const project = readFileSync(projectFile, "utf8");
  writeFileSync(
    projectFile,
    withEntitlements(project, { bundleId, app, extension }),
  );
}
