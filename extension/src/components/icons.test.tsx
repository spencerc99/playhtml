// ABOUTME: Verifies shared collector icons inherit the active extension color scheme.
// ABOUTME: Keeps explicit cursor identity colors independent from theme defaults.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectorIcon, CursorSvg } from "./icons";

describe("collector icons", () => {
  it("uses theme-aware colors for every collector type", () => {
    const markup = ["cursor", "keyboard", "navigation", "viewport", "element"]
      .map((type) => renderToStaticMarkup(<CollectorIcon type={type} />))
      .join("");

    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('fill="var(--surface-hover)"');
    expect(markup).toContain('fill="var(--text-faint)"');
    expect(markup).not.toMatch(/#3d3833|#efe9df|#b5aea5/);
  });

  it("preserves an explicit cursor identity color", () => {
    const markup = renderToStaticMarkup(<CursorSvg color="#4a9a8a" />);

    expect(markup).toContain('fill="#4a9a8a"');
  });
});
