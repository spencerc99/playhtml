// ABOUTME: Extracts fenced code blocks from docs and mounts vanilla HTML snippets in jsdom.
// ABOUTME: Lets integration tests run real docs examples against the real playhtml library.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DOCS_CONTENT_DIR = path.resolve(here, "../content/docs");

export interface DocsSnippet {
  /** Fence language tag, e.g. "html", "js", "tsx". */
  lang: string;
  /** Extra space-separated tokens on the fence info line, e.g. "ignore-test". */
  flags: string[];
  /** The raw code inside the fence. */
  code: string;
  /** Docs file the snippet came from, relative to the docs content dir. */
  sourceFile: string;
  /** Nearest preceding markdown heading, for pointing failures back to source. */
  nearestHeading: string;
  /** 1-based line where the opening fence appears. */
  line: number;
}

/**
 * Parses fenced code blocks out of a markdown/MDX file. Tracks the nearest
 * preceding `#`-style heading so a failing snippet names its section.
 */
export function extractSnippets(relativePath: string): DocsSnippet[] {
  const absPath = path.join(DOCS_CONTENT_DIR, relativePath);
  const text = readFileSync(absPath, "utf8");
  const lines = text.split("\n");

  const snippets: DocsSnippet[] = [];
  let nearestHeading = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      nearestHeading = headingMatch[1].trim();
      i++;
      continue;
    }

    const fenceMatch = line.match(/^```(\S+)?\s*(.*)$/);
    if (fenceMatch) {
      const lang = (fenceMatch[1] ?? "").trim();
      const flags = fenceMatch[2].trim().split(/\s+/).filter(Boolean);
      const openLine = i + 1;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      // Skip the closing fence (if EOF reached, the loop simply ends).
      i++;
      snippets.push({
        lang,
        flags,
        code: body.join("\n"),
        sourceFile: relativePath,
        nearestHeading,
        line: openLine,
      });
      continue;
    }

    i++;
  }

  return snippets;
}

/**
 * Snippets opt out of execution with an `ignore-test` fence flag, e.g.
 * ```html ignore-test, or by being intentionally partial (containing a
 * `/* ... *​/` placeholder). Such snippets are illustrative, not runnable.
 */
export function isExecutable(snippet: DocsSnippet): boolean {
  if (snippet.flags.includes("ignore-test")) return false;
  if (snippet.code.includes("/* ... */")) return false;
  if (snippet.code.includes("/* … */")) return false;
  return true;
}

/** Returns runnable vanilla snippets (html/js) from a docs file. */
export function vanillaSnippets(relativePath: string): DocsSnippet[] {
  return extractSnippets(relativePath).filter(
    (s) => (s.lang === "html" || s.lang === "js") && isExecutable(s),
  );
}

export interface MountedSnippet {
  /** The container holding the snippet markup (a child of document.body). */
  container: HTMLElement;
  /** Look an element up by id within the mounted snippet. */
  byId<T extends HTMLElement = HTMLElement>(id: string): T;
  /** Remove the snippet from the DOM. */
  cleanup(): void;
}

/**
 * Injects an HTML snippet into document.body. Inline `<script>` tags inside the
 * snippet are NOT auto-executed: jsdom does not run scripts inserted via
 * innerHTML, and many doc scripts attach listeners to ids that only exist on
 * the full docs page. Tests that need a snippet's script behavior should pull
 * the `js`/inline-script intent and exercise it explicitly. `<style>` and
 * `<script>` blocks are left in the DOM (inert) so the markup matches the docs.
 */
export function mountHtml(html: string): MountedSnippet {
  const container = document.createElement("div");
  container.className = "__docs-snippet";
  container.innerHTML = html;
  document.body.appendChild(container);

  return {
    container,
    byId<T extends HTMLElement = HTMLElement>(id: string): T {
      // ids may legitimately contain characters that break CSS selectors
      // (e.g. duplicate clones get ids like "#bunny-template-abc"), so walk
      // the container instead of using querySelector.
      const found = Array.from(container.querySelectorAll<HTMLElement>("*")).find(
        (el) => el.id === id,
      );
      if (!found) {
        throw new Error(`No element with id "${id}" in mounted snippet`);
      }
      return found as T;
    },
    cleanup() {
      // Unregister any playhtml handlers this snippet created so its ids don't
      // collide with later snippets that reuse the same id (docs examples
      // legitimately reuse ids like "clone-btn" across sections).
      const playhtml = (window as { playhtml?: { removePlayElement(el: Element): void } })
        .playhtml;
      if (playhtml) {
        for (const el of Array.from(
          container.querySelectorAll(".__playhtml-element"),
        )) {
          playhtml.removePlayElement(el);
        }
      }
      container.remove();
    },
  };
}

/**
 * Captures console.error and console.warn for the duration of `fn`. The project
 * requires pristine test output, so a snippet that logs either should fail.
 */
export async function withConsoleCapture<T>(
  fn: () => Promise<T> | T,
): Promise<{ result: T; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const result = await fn();
    return { result, errors, warnings };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}
