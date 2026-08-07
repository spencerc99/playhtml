// ABOUTME: Verifies user-facing feature releases follow committed feature flags.
// ABOUTME: Covers both hidden experiments and features enabled for general use.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleasedFeature } from "./ReleasedFeature";

function renderFeature(feature: "COMMUTE" | "INVENTORY") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ReleasedFeature feature={feature}>
        <span>feature content</span>
      </ReleasedFeature>,
    );
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("ReleasedFeature", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides a feature whose release flag is disabled", () => {
    const { container, root } = renderFeature("COMMUTE");

    try {
      expect(container.textContent).toBe("");
    } finally {
      cleanup(root, container);
    }
  });

  it("renders a feature whose release flag is enabled", () => {
    const { container, root } = renderFeature("INVENTORY");

    try {
      expect(container.textContent).toBe("feature content");
    } finally {
      cleanup(root, container);
    }
  });
});
