// ABOUTME: Verifies the Vanilla HTML and React sources shown under each live docs demo.
// ABOUTME: Guards valid TSX, copy-pasteable imports, and current (non-deprecated) API names.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { doodleStripSnippet } from "../snippets/doodle-strip";
import { liveReactionsSnippet, rainSnippet } from "../snippets/events";
import {
  emojiMirrorSnippet,
  growingListMirrorSnippet,
} from "../snippets/mirror";
import { onlineIndicatorSnippet } from "../snippets/online-indicator";
import { prizeWheelSnippet } from "../snippets/prize-wheel";
import {
  lampSnippet,
  sharedSwitchSnippet,
  toggleSwitchSnippet,
} from "../snippets/toggles";

const snippets = {
  lampSnippet,
  toggleSwitchSnippet,
  sharedSwitchSnippet,
  emojiMirrorSnippet,
  growingListMirrorSnippet,
  doodleStripSnippet,
  prizeWheelSnippet,
  onlineIndicatorSnippet,
  rainSnippet,
  liveReactionsSnippet,
};

const DEPRECATED = [
  "updateElement",
  "myDefaultAwareness",
  "setMyAwareness",
  "awareness",
  "playerIdentity",
];

function tsxErrors(source: string): string[] {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe.each(Object.entries(snippets))("%s", (_name, snippet) => {
  it("has a Vanilla HTML version that loads playhtml from the CDN", () => {
    expect(snippet.html).toContain('from "https://unpkg.com/playhtml@latest"');
    expect(snippet.html).toContain("playhtml.init(");
    expect(snippet.html).toMatch(/\sid="[^"]+"/);
  });

  it("has a React version that compiles and uses @playhtml/react", () => {
    expect(tsxErrors(snippet.react)).toEqual([]);
    expect(snippet.react).toContain('from "@playhtml/react"');
  });

  it("uses current API names", () => {
    for (const name of DEPRECATED) {
      expect(snippet.html).not.toContain(name);
      expect(snippet.react).not.toContain(name);
    }
  });
});

describe("vanilla script blocks", () => {
  it("parse as JavaScript modules", () => {
    for (const snippet of Object.values(snippets)) {
      const script = snippet.html.match(
        /<script type="module">([\s\S]*?)<\/script>/,
      )?.[1];
      expect(script).toBeDefined();
      expect(tsxErrors(script!)).toEqual([]);
    }
  });
});
