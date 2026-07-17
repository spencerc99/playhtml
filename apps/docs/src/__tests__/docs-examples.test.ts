// ABOUTME: Renders real vanilla docs snippets with the live library and asserts behavior.
// ABOUTME: A broken copy-paste example in the docs fails CI here instead of silently shipping.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { playhtml } from "playhtml";
import {
  vanillaSnippets,
  extractSnippets,
  isExecutable,
  mountHtml,
  withConsoleCapture,
  type DocsSnippet,
} from "./docs-snippets";

const CAPABILITIES = "capabilities.mdx";
const SHARED_ELEMENTS = "advanced/shared-elements.md";

function findSnippet(
  file: string,
  predicate: (s: DocsSnippet) => boolean,
): DocsSnippet {
  const match = vanillaSnippets(file).find(predicate);
  if (!match) {
    throw new Error(`No matching vanilla snippet found in ${file}`);
  }
  return match;
}

beforeAll(async () => {
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("docs snippet extractor", () => {
  it("extracts fenced blocks with language, heading, and source", () => {
    const all = extractSnippets(CAPABILITIES);
    expect(all.length).toBeGreaterThan(0);

    const htmlBlocks = all.filter((s) => s.lang === "html");
    const tsxBlocks = all.filter((s) => s.lang === "tsx");
    expect(htmlBlocks.length).toBeGreaterThan(0);
    expect(tsxBlocks.length).toBeGreaterThan(0);

    for (const s of all) {
      expect(s.sourceFile).toBe(CAPABILITIES);
      expect(s.line).toBeGreaterThan(0);
    }

    const toggleBlock = htmlBlocks.find((s) => s.nearestHeading === "can-toggle");
    expect(toggleBlock?.code).toContain("can-toggle");
  });

  it("keeps the shared-state React consumer example self-contained", () => {
    const snippet = extractSnippets(SHARED_ELEMENTS).find(
      (s) => s.lang === "tsx" && s.code.includes("withSharedState"),
    );
    if (!snippet) {
      throw new Error(`No withSharedState snippet found in ${SHARED_ELEMENTS}`);
    }

    expect(snippet.code).toContain("withSharedState,");
    expect(snippet.code).toContain("dataSourceReadOnly: true");
    expect(snippet.code).toContain("({ data }) =>");
    expect(snippet.code).not.toMatch(/\bProps\b/);
  });

  it("honors the ignore-test opt-out and partial-snippet placeholder", () => {
    expect(
      isExecutable({
        lang: "html",
        flags: ["ignore-test"],
        code: "<div></div>",
      } as DocsSnippet),
    ).toBe(false);
    expect(
      isExecutable({
        lang: "js",
        flags: [],
        code: "doThing(/* ... */)",
      } as DocsSnippet),
    ).toBe(false);
    expect(
      isExecutable({
        lang: "html",
        flags: [],
        code: "<button can-toggle></button>",
      } as DocsSnippet),
    ).toBe(true);
  });
});

describe("docs capability snippets render and behave", () => {
  it("can-toggle: clicking the real snippet flips the toggled class", async () => {
    const snippet = findSnippet(
      CAPABILITIES,
      (s) => s.nearestHeading === "can-toggle" && s.code.includes("can-toggle"),
    );

    const { errors, warnings } = await withConsoleCapture(async () => {
      const mounted = mountHtml(snippet.code);
      await playhtml.setupPlayElements();

      const button = mounted.byId<HTMLButtonElement>("my-switch");
      expect(button.classList.contains("toggled")).toBe(false);

      button.click();
      await new Promise((r) => queueMicrotask(r));
      expect(button.classList.contains("toggled")).toBe(true);

      button.click();
      await new Promise((r) => queueMicrotask(r));
      expect(button.classList.contains("toggled")).toBe(false);

      mounted.cleanup();
    });

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("can-duplicate: clicking the real snippet clones the template element", async () => {
    const snippet = findSnippet(
      CAPABILITIES,
      (s) =>
        s.nearestHeading === "can-duplicate" &&
        s.code.includes('can-duplicate="bunny-template"') &&
        s.code.includes("clone-btn"),
    );

    const { errors, warnings } = await withConsoleCapture(async () => {
      const mounted = mountHtml(snippet.code);
      await playhtml.setupPlayElements();

      const cloneButton = mounted.byId<HTMLButtonElement>("clone-btn");
      expect(
        mounted.container.querySelectorAll("[id^='bunny-template-']").length,
      ).toBe(0);

      cloneButton.click();
      await new Promise((r) => queueMicrotask(r));

      const clones = mounted.container.querySelectorAll(
        "[id^='bunny-template-']",
      );
      expect(clones.length).toBe(1);
      expect((clones[0] as HTMLImageElement).tagName).toBe("IMG");

      mounted.cleanup();
    });

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
