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

export function makePlayhtmlModuleUrl(): string {
  const leafEditorUrl = makeModuleDataUrl(leafEditorSource);
  const sharedChunkSpecifier = playhtmlSource.match(
    /from "(\.\/index-[^"]+\.js)"/,
  )?.[1];
  if (!sharedChunkSpecifier) {
    throw new Error("PlayHTML bundle is missing its shared chunk import");
  }

  const sharedChunkSource = getChunkSource(sharedChunkSpecifier).replace(
    '"./leafEditor.es.js"',
    JSON.stringify(leafEditorUrl),
  );
  const developmentChunkSpecifier = sharedChunkSource.match(
    /import\("(\.\/development-[^"]+\.js)"\)/,
  )?.[1];
  if (!developmentChunkSpecifier) {
    throw new Error("PlayHTML bundle is missing its development chunk import");
  }

  const listSharedElementsName = sharedChunkSource.match(
    /([A-Za-z_$][\w$]*) as l,/,
  )?.[1];
  if (!listSharedElementsName) {
    throw new Error("PlayHTML bundle is missing its shared-element export");
  }

  const developmentChunkSource = getChunkSource(developmentChunkSpecifier)
    .replace('"./leafEditor.es.js"', JSON.stringify(leafEditorUrl))
    .replace(
      new RegExp(
        `import \\{ l as ([A-Za-z_$][\\w$]*) \\} from "${sharedChunkSpecifier.replace(".", "\\.")}";`,
      ),
      "const $1 = (...args) => globalThis.__playhtmlListSharedElements(...args);",
    );
  const developmentChunkUrl = makeModuleDataUrl(developmentChunkSource);
  const sharedChunkUrl = makeModuleDataUrl(
    sharedChunkSource
      .replace(
        `import("${developmentChunkSpecifier}")`,
        `import(${JSON.stringify(developmentChunkUrl)})`,
      )
      .replace(
        "export {\n",
        `globalThis.__playhtmlListSharedElements = ${listSharedElementsName};\nexport {\n`,
      ),
  );
  const bundledSource = playhtmlSource
    .replace(sharedChunkSpecifier, sharedChunkUrl)
    .replace('"./leafEditor.es.js"', JSON.stringify(leafEditorUrl));

  return makeModuleDataUrl(bundledSource);
}
