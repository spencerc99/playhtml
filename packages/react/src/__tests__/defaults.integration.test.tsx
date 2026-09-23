// ABOUTME: Verifies that React defaults are available during the first render.
// ABOUTME: Rejects DOM-dependent default callbacks without executing them.
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanPlayElement, withSharedState } from "../index";

describe("React default values", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    const messages = errors.mock.calls;
    errors.mockRestore();
    for (const [message] of messages) {
      expect(message).toContain("useLayoutEffect does nothing on the server");
    }
  });
  it("renders data and awareness before an element is mounted", () => {
    const markup = renderToString(
      <CanPlayElement
        standalone
        defaultData={{ label: "Alice" }}
        myDefaultAwareness={{ status: "here" }}
      >
        {({ data, myAwareness }) => (
          <div id="selection">{data.label}: {myAwareness.status}</div>
        )}
      </CanPlayElement>,
    );
    expect(markup).toContain("Alice");
    expect(markup).toContain("here");
  });

  it("derives first-render defaults from component props", () => {
    const Selection = withSharedState(
      ({ label }: { label: string }) => ({
        standalone: true,
        defaultData: { label },
        myDefaultAwareness: { status: label },
      }),
      ({ data, myAwareness }) => <div id="selection">{data.label}: {myAwareness.status}</div>,
    );
    expect(renderToString(<Selection label="Bob" />)).toContain("Bob");
  });

  it.each(["defaultData", "myDefaultAwareness"])("rejects a callback for %s", (prop) => {
    let calls = 0;
    const callback = () => {
      calls += 1;
      return { label: "callback" };
    };
    const props = {
      standalone: true,
      defaultData: { label: "Alice" },
      [prop]: callback,
    };
    expect(() => renderToString(
      <CanPlayElement {...props}>
        {({ data }) => <div id="selection">{data.label}</div>}
      </CanPlayElement>,
    )).toThrow(`${prop} must be a value, not a function`);
    expect(calls).toBe(0);
  });
});
