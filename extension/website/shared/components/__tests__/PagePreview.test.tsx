// ABOUTME: Verifies the page preview frames only web pages.
// ABOUTME: Event URLs come from public ingest, so a javascript: URL must never reach an iframe.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PagePreview } from "../PagePreview";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderPreview(url: string) {
  act(() => {
    root.render(
      <svg>
        <PagePreview
          url={url}
          x={0}
          y={0}
          width={320}
          height={200}
          scrollY={0}
          scrollRange={0}
        />
      </svg>,
    );
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("does not frame a javascript: URL", () => {
  renderPreview("javascript:alert(document.domain)");
  expect(container.querySelector("iframe")).toBeNull();
});

it("does not frame a data: URL", () => {
  renderPreview("data:text/html,<script>alert(1)</script>");
  expect(container.querySelector("iframe")).toBeNull();
});

it("frames an https page", () => {
  renderPreview("https://example.com/page");
  expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
    "https://example.com/page",
  );
});
