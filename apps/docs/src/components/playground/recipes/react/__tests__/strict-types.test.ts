// ABOUTME: Type-checks every React recipe source in strict mode against the built @playhtml/react.
// ABOUTME: Catches copy-paste code that transpiles but fails in a reader's TypeScript project.
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { exampleRecipes } from "../../index";

function typeErrors(sources: Map<string, string>): Map<string, string[]> {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => sources.has(file) || fileExists(file);
  host.readFile = (file) => sources.get(file) ?? readFile(file);
  host.getSourceFile = (file, language, ...rest) => {
    const source = sources.get(file);
    return source === undefined
      ? getSourceFile(file, language, ...rest)
      : ts.createSourceFile(file, source, language);
  };

  const program = ts.createProgram([...sources.keys()], options, host);
  return new Map(
    [...sources.keys()].map((file) => [
      file,
      ts
        .getPreEmitDiagnostics(program, program.getSourceFile(file))
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    ]),
  );
}

describe("React recipe sources", () => {
  it("type-check in strict mode", () => {
    const sources = new Map(
      exampleRecipes
        .filter((recipe) => recipe.react)
        .map((recipe) => [
          path.join(__dirname, `${recipe.id}.tsx`),
          recipe.react!.code,
        ]),
    );
    // The matter-physics recipe tells readers to install @types/matter-js,
    // which this repo doesn't depend on.
    sources.set(
      path.join(__dirname, "ambient.d.ts"),
      'declare module "matter-js";',
    );
    const errors = typeErrors(sources);
    for (const [file, fileErrors] of errors) {
      expect({ [path.basename(file)]: fileErrors }).toEqual({
        [path.basename(file)]: [],
      });
    }
  });
});
