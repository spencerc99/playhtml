// ABOUTME: Covers the first-letter writing prompt shown on an empty bottle sheet.
// ABOUTME: Keeps contribution framing consistent whether a thread exists or not.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WriteSegment } from "../components/bottle/WriteSegment";

async function renderWriteSegment() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <WriteSegment
        authorColor="#4a9a8a"
        onStamped={() => {}}
      />,
    );
  });
  return { container, root };
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("WriteSegment", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the normal writing prompt for the first letter", async () => {
    const first = await renderWriteSegment();
    try {
      const firstPlaceholder = first.container
        .querySelector("textarea")
        ?.getAttribute("placeholder");
      expect(firstPlaceholder).toBe(
        "what brought you here? what do you want this place to know?",
      );
    } finally {
      cleanupRoot(first.root, first.container);
    }
  });
});
