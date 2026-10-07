// ABOUTME: Verifies the copy-paste React sources for canonical basic recipes.
// ABOUTME: Guards valid TSX, provider usage, stable ids, and bounded user writes.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  canHoverReactSource,
  canMoveReactSource,
  canToggleReactSource,
} from "../built-in-capabilities";
import {
  sharedCounterReactSource,
  sharedGuestbookReactSource,
} from "../shared-state-basics";

const sources = [
  canMoveReactSource,
  canToggleReactSource,
  canHoverReactSource,
  sharedCounterReactSource,
  sharedGuestbookReactSource,
];

describe("basic React recipe sources", () => {
  it("provides complete TypeScript React apps", () => {
    for (const source of sources) {
      const result = ts.transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      });
      const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );

      expect(errors).toEqual([]);
      expect(source).toContain('from "@playhtml/react"');
      expect(source).toContain("<PlayProvider");
      expect(source).toContain("export default function App()");
      expect(source).toMatch(/id="[^"]+"/);
    }
  });

  it("keeps shared writes in explicit counter and guestbook handlers", () => {
    expect(sharedCounterReactSource).toContain("onClick={() =>");
    expect(sharedCounterReactSource).toContain("draft.count += 1");
    expect(sharedGuestbookReactSource).toContain(
      "shared.entries.splice(0, shared.entries.length - MAX_ENTRIES)",
    );
    expect(sharedGuestbookReactSource).not.toMatch(
      /useEffect\([\s\S]*?setData\(/,
    );
    expect(sharedGuestbookReactSource).toContain("at: Date.now()");
  });

  it("keeps the established element ids and example assets", () => {
    expect(canMoveReactSource).toContain('id="ph-cap-hat"');
    expect(canMoveReactSource).toContain('id="ph-cap-cat"');
    expect(canMoveReactSource).toContain(
      'https://playhtml.fun/docs/yankees-hat.png',
    );
    expect(canMoveReactSource).toContain(
      'https://playhtml.fun/docs/long-cat.png',
    );
    expect(canToggleReactSource).toContain('id="ph-docs-toggle-demo"');
    expect(canHoverReactSource).toContain('id="ph-cap-hover-pad"');
    expect(sharedCounterReactSource).toContain('id="ph-docs-counter"');
    expect(sharedGuestbookReactSource).toContain(
      'id="ph-cap-docs-guestbook"',
    );
  });
});
