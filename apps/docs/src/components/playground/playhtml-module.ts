// ABOUTME: Builds a self-contained PlayHTML module URL for sandboxed recipe iframes.
// ABOUTME: Inlines generated package chunks so data URL modules have no relative imports.
import playhtmlSource from "../../../../../packages/playhtml/dist/playhtml.es.js?raw";
import leafEditorSource from "../../../../../packages/playhtml/dist/leafEditor.es.js?raw";

const packageChunkSources = import.meta.glob(
  "../../../../../packages/playhtml/dist/*.js",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
) as Record<string, string>;

function makeModuleDataUrl(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:text/javascript;base64,${btoa(binary)}`;
}

function getChunkSource(specifier: string): string {
  const filename = specifier.replace("./", "");
  const match = Object.entries(packageChunkSources).find(([path]) =>
    path.endsWith(`/${filename}`),
  );
  if (!match) {
    throw new Error(`PlayHTML bundle is missing ${filename}`);
  }
  return match[1];
}

const LEAF_EDITOR_SPECIFIER = /(["'])\.\/leafEditor\.es\.js\1/g;
const SHARED_CHUNK_GLOBAL = "__playhtmlSharedChunk";

function replaceLeafEditorImport(source: string, leafEditorUrl: string): string {
  return source.replace(LEAF_EDITOR_SPECIFIER, JSON.stringify(leafEditorUrl));
}

// Lazily imported chunks (development tools, cursors) import from the shared
// chunk, which imports them back. Data URLs cannot reference each other in a
// cycle, so those chunks read the shared chunk's exports from a global that the
// shared chunk sets while it evaluates, before any lazy import can run.
function readSharedChunkFromGlobal(
  source: string,
  sharedChunkSpecifier: string,
): string {
  const escaped = sharedChunkSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importStatement = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["'];?`,
  );
  return source.replace(importStatement, (_match, specifiers: string) => {
    const bindings = specifiers
      .split(",")
      .map((specifier) => specifier.trim())
      .filter(Boolean)
      .map((specifier) => {
        const [imported, local = imported] = specifier.split(/\s+as\s+/);
        return `${imported}: ${local}`;
      });
    return `const { ${bindings.join(", ")} } = globalThis.${SHARED_CHUNK_GLOBAL};`;
  });
}

function exposeSharedChunkExports(source: string): string {
  const exportClause = source.match(/export\s*\{([^}]*)\}\s*;?/);
  if (!exportClause) {
    throw new Error("PlayHTML bundle is missing its shared chunk exports");
  }
  const entries = exportClause[1]
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const [local, exported = local] = specifier.split(/\s+as\s+/);
      return `${exported}: ${local}`;
    });
  return source.replace(
    exportClause[0],
    `globalThis.${SHARED_CHUNK_GLOBAL} = { ${entries.join(", ")} };\n${exportClause[0]}`,
  );
}

export function makePlayhtmlModuleUrl(): string {
  const leafEditorUrl = makeModuleDataUrl(leafEditorSource);
  const sharedChunkSpecifier = playhtmlSource.match(
    /from\s*"(\.\/index-[^"]+\.js)"/,
  )?.[1];
  if (!sharedChunkSpecifier) {
    throw new Error("PlayHTML bundle is missing its shared chunk import");
  }

  let sharedChunkSource = exposeSharedChunkExports(
    replaceLeafEditorImport(getChunkSource(sharedChunkSpecifier), leafEditorUrl),
  );
  const lazyChunkSpecifiers = [
    ...sharedChunkSource.matchAll(/import\(\s*"(\.\/[^"]+\.js)"\s*\)/g),
  ].map((match) => match[1]);
  if (!lazyChunkSpecifiers.some((specifier) => specifier.includes("development-"))) {
    throw new Error("PlayHTML bundle is missing its development chunk import");
  }
  for (const specifier of lazyChunkSpecifiers) {
    const lazyChunkUrl = makeModuleDataUrl(
      readSharedChunkFromGlobal(
        replaceLeafEditorImport(getChunkSource(specifier), leafEditorUrl),
        sharedChunkSpecifier,
      ),
    );
    sharedChunkSource = sharedChunkSource.replace(
      `"${specifier}"`,
      JSON.stringify(lazyChunkUrl),
    );
  }

  const bundledSource = replaceLeafEditorImport(
    playhtmlSource.replace(
      `"${sharedChunkSpecifier}"`,
      JSON.stringify(makeModuleDataUrl(sharedChunkSource)),
    ),
    leafEditorUrl,
  );

  return makeModuleDataUrl(bundledSource);
}
