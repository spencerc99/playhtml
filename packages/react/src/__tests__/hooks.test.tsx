// ABOUTME: Tests for usePresence, usePageData, usePresenceRoom hooks
// ABOUTME: Verifies pre-init no-op behavior and post-sync wiring

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import "@testing-library/dom";
import { PlayProvider, usePresence, usePageData, usePresenceRoom } from "../index";

describe("usePresence", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns empty map and null identity before init, then wires up", async () => {
    const seen: Array<{ size: number; hasIdentity: boolean }> = [];

    function TestComponent() {
      const { presences, myIdentity } = usePresence("selection");
      seen.push({ size: presences.size, hasIdentity: myIdentity !== null });
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    // First render: pre-sync — empty presences, null identity
    expect(seen[0]).toEqual({ size: 0, hasIdentity: false });

    // After init resolves, identity becomes available
    await waitFor(() => {
      expect(seen.at(-1)?.hasIdentity).toBe(true);
    });
  });

  it("setMyPresence is a no-op pre-sync, works post-sync", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    let captured: ReturnType<typeof usePresence> | null = null;

    function TestComponent() {
      captured = usePresence("selection");
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    // Pre-sync call should warn
    act(() => {
      captured!.setMyPresence({ x: 1 });
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("setMyPresence called before init"),
    );

    // Post-sync call should succeed and populate presences
    await waitFor(() => {
      expect(captured!.myIdentity).not.toBeNull();
    });

    act(() => {
      captured!.setMyPresence({ x: 2 });
    });

    await waitFor(() => {
      expect(captured!.presences.size).toBeGreaterThan(0);
    });
  });
});

describe("usePageData", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns defaultValue pre-sync, then real data post-sync", async () => {
    const seen: Array<{ count: number }> = [];

    function TestComponent() {
      const [data] = usePageData("counter", { count: 0 });
      seen.push(data);
      return <div>{data.count}</div>;
    }

    const { getByText } = render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    expect(seen[0]).toEqual({ count: 0 });
    await waitFor(() => expect(getByText("0")).toBeDefined());
  });

  it("setData no-ops pre-sync, writes post-sync", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    let captured: ReturnType<typeof usePageData<{ count: number }>> | null = null;

    function TestComponent() {
      captured = usePageData("counter", { count: 0 });
      return <div>{captured[0].count}</div>;
    }

    const { getByText } = render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    // Pre-sync setData warns
    act(() => {
      captured![1]({ count: 5 });
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("setData called before init"),
    );

    // Wait for sync, then setData should flow through
    await waitFor(() => expect(getByText("0")).toBeDefined());

    act(() => {
      captured![1]({ count: 42 });
    });

    await waitFor(() => expect(getByText("42")).toBeDefined());
  });
});

describe("usePresenceRoom", () => {
  it("returns null pre-sync, then a room post-sync", async () => {
    const seen: Array<boolean> = [];

    function TestComponent() {
      const room = usePresenceRoom("voice");
      seen.push(room !== null);
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    expect(seen[0]).toBe(false);
    await waitFor(() => expect(seen.at(-1)).toBe(true));
  });
});
