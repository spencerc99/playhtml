// ABOUTME: Regression tests for the wewere.online homepage shell.
// ABOUTME: Verifies passive hero indicators do not trigger navigation.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayProvider } from "@playhtml/react";
import App from "../App";

function renderApp() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <PlayProvider
      initOptions={{
        cursors: {
          enabled: true,
          enableChat: false,
          coordinateMode: "absolute",
        },
      }}
    >
      <App />
    </PlayProvider>,
  );
  return host;
}

function findScrollCue(host: HTMLElement) {
  for (const svg of host.querySelectorAll("svg")) {
    if (svg.getAttribute("viewBox") === "0 0 72 48") {
      return svg.parentElement;
    }
  }

  return null;
}

describe("App", () => {
  it("renders the scroll cue as a passive indicator", () => {
    const host = renderApp();
    const cue = findScrollCue(host);

    expect(cue).not.toBeNull();
    expect(cue?.tagName).not.toBe("A");
    expect(cue?.hasAttribute("href")).toBe(false);
    expect(cue?.getAttribute("aria-hidden")).toBe("true");
    expect(cue?.getAttribute("role")).toBeNull();
    expect(cue?.getAttribute("tabindex")).toBeNull();
  });
});
