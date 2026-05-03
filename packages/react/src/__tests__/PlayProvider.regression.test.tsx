// ABOUTME: Regression tests locking in PlayProvider's bootstrap contract.
// ABOUTME: Catches breakages where bare <PlayProvider> stops initializing playhtml.

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PlayContext, PlayProvider } from "../index";

const mockedPlayhtml = (globalThis as any).MOCKED_PLAYHTML as {
  init: ReturnType<typeof vi.fn>;
  resetReady: () => void;
  resolveReady: () => void;
};

describe("PlayProvider bootstrap contract", () => {
  beforeEach(() => {
    mockedPlayhtml.init.mockClear();
  });

  it("bare <PlayProvider> (no initOptions) bootstraps playhtml", async () => {
    // Regression for the breakage shipped in PR #102 and reverted: the
    // experiments site (e.g. /experiments/4/) renders <PlayProvider> with no
    // initOptions and relies on it to call playhtml.init(). If the provider
    // ever stops bootstrapping in this case, all bare-provider sites break
    // with "Element X does not have proper info to initial a playhtml element".
    render(
      <PlayProvider>
        <div data-testid="child" />
      </PlayProvider>,
    );

    await waitFor(() => {
      expect(mockedPlayhtml.init).toHaveBeenCalledTimes(1);
    });
  });

  it("<PlayProvider initOptions={{}}> bootstraps playhtml", async () => {
    render(
      <PlayProvider initOptions={{}}>
        <div data-testid="child" />
      </PlayProvider>,
    );

    await waitFor(() => {
      expect(mockedPlayhtml.init).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps context loading until playhtml.ready resolves", async () => {
    mockedPlayhtml.resetReady();
    mockedPlayhtml.init.mockImplementation(() => Promise.resolve());

    function Status() {
      const context = React.useContext(PlayContext);
      return <div data-testid="status">{context.isLoading ? "loading" : "ready"}</div>;
    }

    const { getByTestId } = render(
      <PlayProvider>
        <Status />
      </PlayProvider>,
    );

    await waitFor(() => {
      expect(mockedPlayhtml.init).toHaveBeenCalledTimes(1);
    });
    expect(getByTestId("status")).toHaveTextContent("loading");

    mockedPlayhtml.resolveReady();

    await waitFor(() => {
      expect(getByTestId("status")).toHaveTextContent("ready");
    });
  });
});
