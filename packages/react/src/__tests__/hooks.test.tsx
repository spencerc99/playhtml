// ABOUTME: Tests for usePresence, usePageData, usePresenceRoom hooks
// ABOUTME: Verifies pre-init no-op behavior and post-sync wiring

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import "@testing-library/dom";
import {
  PlayProvider,
  PlayContext,
  usePresence,
  usePageData,
  usePresenceRoom,
  usePlayerIdentity,
  useUsers,
  useCursorZone,
  playhtml,
} from "../index";
import type { PlayerIdentity } from "playhtml";

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

describe("usePlayerIdentity", () => {
  // usePlayerIdentity is backed by playhtml.users (not the cursors context),
  // so it works without `cursors: { enabled: true }`. These tests render a
  // <PlayProvider> with NO cursors option and drive the mocked users module
  // from setup.ts, which stands in for the real Yjs/PartyKit stack.
  it("returns empty values pre-sync, then the identity post-sync", async () => {
    const seen: Array<ReturnType<typeof usePlayerIdentity>> = [];
    function TestComponent() {
      const identity = usePlayerIdentity();
      seen.push(identity);
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    expect(seen[0]).toEqual({ color: "", pid: undefined, name: undefined, custom: {} });

    await waitFor(() => {
      expect(seen.at(-1)?.pid).toBe("mock-pid");
    });
    expect(seen.at(-1)?.color).toBe("#123456");
  });

  it("reflects a color/name/custom change made via playhtml.users.me", async () => {
    let captured: ReturnType<typeof usePlayerIdentity> | null = null;
    function TestComponent() {
      captured = usePlayerIdentity();
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    await waitFor(() => expect(captured?.pid).toBe("mock-pid"));

    act(() => {
      playhtml.users.me.color = "#ffae00";
      playhtml.users.me.name = "ada";
      playhtml.users.me.custom = { mood: "curious" };
    });

    await waitFor(() => {
      expect(captured?.color.toLowerCase()).toBe("#ffae00");
      expect(captured?.name).toBe("ada");
      expect(captured?.custom).toEqual({ mood: "curious" });
    });
  });

  it("works without cursors enabled", async () => {
    let captured: ReturnType<typeof usePlayerIdentity> | null = null;
    function TestComponent() {
      captured = usePlayerIdentity();
      return <div />;
    }

    // No initOptions at all — in particular no `cursors: { enabled: true }` —
    // proving usePlayerIdentity doesn't require cursors to resolve an identity.
    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    await waitFor(() => expect(captured?.pid).toBe("mock-pid"));
    expect(captured?.color).toBeTruthy();
  });
});

describe("useUsers", () => {
  it("returns an empty map pre-sync, then includes self post-sync", async () => {
    let captured: Map<string, { isMe: boolean }> | null = null;
    function TestComponent() {
      captured = useUsers() as Map<string, { isMe: boolean }>;
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    await waitFor(() => {
      expect(captured?.size).toBeGreaterThan(0);
    });
    const self = Array.from(captured!.values()).find((u) => u.isMe);
    expect(self).toBeDefined();
  });
});

describe("useCursorZone", () => {
  function makeContext({
    registerCursorZone,
    unregisterCursorZone,
  }: {
    registerCursorZone: React.ContextType<typeof PlayContext>["registerCursorZone"];
    unregisterCursorZone: React.ContextType<typeof PlayContext>["unregisterCursorZone"];
  }) {
    return {
      setupPlayElements: vi.fn(),
      dispatchPlayEvent: vi.fn(),
      registerPlayEventListener: vi.fn(),
      removePlayEventListener: vi.fn(),
      deleteElementData: vi.fn(),
      hasSynced: true,
      isLoading: false,
      isProviderMissing: false,
      configureCursors: vi.fn(),
      getMyPlayerIdentity: vi.fn(() => null),
      triggerCursorAnimation: vi.fn(() => false),
      registerCursorZone,
      unregisterCursorZone,
      cursors: { allColors: [], color: "", name: undefined },
      cursorPresences: new Map(),
    } as unknown as React.ContextType<typeof PlayContext>;
  }

  function CursorZone({
    options,
  }: {
    options?: Parameters<typeof useCursorZone>[1];
  }) {
    const ref = React.useRef<HTMLDivElement>(null);
    useCursorZone(ref, options);
    return <div id="zone-a" data-testid="zone" ref={ref} />;
  }

  it("unregisters the id that was registered even if the element id changes before cleanup", () => {
    const registerCursorZone = vi.fn();
    const unregisterCursorZone = vi.fn();
    const ctx = makeContext({ registerCursorZone, unregisterCursorZone });

    const { getByTestId, unmount } = render(
      <PlayContext.Provider value={ctx}>
        <CursorZone />
      </PlayContext.Provider>,
    );

    const element = getByTestId("zone") as HTMLDivElement;
    expect(registerCursorZone).toHaveBeenCalledWith(element, undefined);

    element.id = "zone-b";
    unmount();

    expect(unregisterCursorZone).toHaveBeenCalledWith("zone-a");
  });

  it("re-registers the zone when options change", () => {
    const registerCursorZone = vi.fn();
    const unregisterCursorZone = vi.fn();
    const ctx = makeContext({ registerCursorZone, unregisterCursorZone });
    const firstOptions = { getCursorStyle: vi.fn(() => ({ opacity: "0.5" })) };
    const secondOptions = { getCursorStyle: vi.fn(() => ({ opacity: "1" })) };

    const { getByTestId, rerender } = render(
      <PlayContext.Provider value={ctx}>
        <CursorZone options={firstOptions} />
      </PlayContext.Provider>,
    );

    const element = getByTestId("zone") as HTMLDivElement;
    expect(registerCursorZone).toHaveBeenCalledWith(element, firstOptions);

    rerender(
      <PlayContext.Provider value={ctx}>
        <CursorZone options={firstOptions} />
      </PlayContext.Provider>,
    );
    registerCursorZone.mockClear();
    unregisterCursorZone.mockClear();

    rerender(
      <PlayContext.Provider value={ctx}>
        <CursorZone options={secondOptions} />
      </PlayContext.Provider>,
    );

    expect(unregisterCursorZone).toHaveBeenCalledWith("zone-a");
    expect(registerCursorZone).toHaveBeenCalledWith(element, secondOptions);
    expect(registerCursorZone).toHaveBeenCalledTimes(1);
  });
});
