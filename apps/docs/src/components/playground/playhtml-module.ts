// ABOUTME: Builds a self-contained PlayHTML module URL for sandboxed recipe iframes.
// ABOUTME: Inlines the bundle's relative leaf-editor import before data URL encoding.
import playhtmlSource from "../../../../../packages/playhtml/dist/playhtml.es.js?raw";
import leafEditorSource from "../../../../../packages/playhtml/dist/leafEditor.es.js?raw";

function makeModuleDataUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}

export function makePlayhtmlModuleUrl(): string {
  const leafEditorUrl = makeModuleDataUrl(leafEditorSource);
  const bundledSource = playhtmlSource.replace(
    '"./leafEditor.es.js"',
    JSON.stringify(leafEditorUrl),
  );

  if (bundledSource === playhtmlSource) {
    throw new Error("PlayHTML bundle is missing its expected leaf editor import");
  }

  return makeModuleDataUrl(bundledSource);
}
