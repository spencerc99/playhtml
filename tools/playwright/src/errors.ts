// ABOUTME: Collects browser-level failures during artificial-user scenes.
// ABOUTME: Lets long Playwright runs fail on real page errors without hiding noise.

import type { ConsoleMessage, Page } from "@playwright/test";

export interface ActorErrorCollector {
  label: string;
  errors: string[];
  assertClean(): void;
}

const FATAL_CONSOLE_PATTERNS = [
  /does not have proper info to initial a playhtml element/i,
  /\[playhtml\]/i,
  /\[PLAYHTML\]/,
  /Uncaught .*Error/,
  /PlayProvider element missing/i,
];

const IGNORED_CONSOLE_PATTERNS = [
  /Issue connecting to yjs/i,
  /WebSocket/i,
  /partykit/i,
  /fonts\.(googleapis|gstatic)\.com/i,
  /favicon/i,
];

export function isFatalConsoleMessage(text: string): boolean {
  if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return FATAL_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

export function installErrorCollector(
  page: Page,
  label: string,
): ActorErrorCollector {
  const collector: ActorErrorCollector = {
    label,
    errors: [],
    assertClean() {
      if (collector.errors.length > 0) {
        throw new Error(
          `${label} had browser errors:\n${collector.errors.join("\n")}`,
        );
      }
    },
  };

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isFatalConsoleMessage(text)) collector.errors.push(`console: ${text}`);
  });

  page.on("pageerror", (error) => {
    collector.errors.push(`pageerror: ${error.name}: ${error.message}`);
  });

  page.on("response", (response) => {
    const url = response.url();
    if (!isLocalUrl(url)) return;
    if (response.status() >= 400) {
      collector.errors.push(`response ${response.status()}: ${url}`);
    }
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!isLocalUrl(url)) return;
    collector.errors.push(
      `${request.failure()?.errorText ?? "request failed"}: ${url}`,
    );
  });

  return collector;
}

function isLocalUrl(url: string): boolean {
  return (
    url.startsWith("http://localhost") ||
    url.startsWith("https://localhost") ||
    url.startsWith("http://127.0.0.1") ||
    url.startsWith("https://127.0.0.1")
  );
}
