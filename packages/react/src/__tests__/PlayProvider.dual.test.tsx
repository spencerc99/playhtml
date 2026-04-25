// ABOUTME: Tests dual-PlayProvider mounting in Pattern A: one init-owning,
// ABOUTME: one or more context-only siblings (Astro islands pattern).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/dom";
import { PlayProvider, PlayContext, usePresenceRoom } from "../index";

function StatusReporter({ id }: { id: string }) {
  const ctx = React.useContext(PlayContext);
  const room = usePresenceRoom("dual-test");
  return (
    <div data-testid={id}>
      {ctx.isLoading ? "loading" : room ? "ready+room" : "ready"}
    </div>
  );
}

describe("dual PlayProvider mounted concurrently", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("init-owning + context-only siblings both reach isLoading=false", async () => {
    // Pattern A: one init-owning provider, one context-only sibling. The
    // context-only provider does NOT call init — it relays state from the
    // global playhtml singleton. Both contexts flip to isLoading=false
    // once the init-owning provider's ready promise resolves.
    const { getByTestId } = render(
      <>
        <PlayProvider initOptions={{}}>
          <StatusReporter id="a" />
        </PlayProvider>
        <PlayProvider>
          <StatusReporter id="b" />
        </PlayProvider>
      </>,
    );

    await waitFor(() => {
      expect(getByTestId("a").textContent).not.toBe("loading");
      expect(getByTestId("b").textContent).not.toBe("loading");
    });
  });

  it("warns when a second init-owning PlayProvider mounts", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <>
        <PlayProvider initOptions={{}}>
          <div />
        </PlayProvider>
        <PlayProvider initOptions={{}}>
          <div />
        </PlayProvider>
      </>,
    );

    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("Multiple <PlayProvider> instances passed `initOptions`"),
      ),
    ).toBe(true);
  });
});
