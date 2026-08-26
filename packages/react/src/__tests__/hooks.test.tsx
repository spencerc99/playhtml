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

const mockedPlayhtml = (globalThis as any).MOCKED_PLAYHTML as {
  isLoading: boolean;
  init: ReturnType<typeof vi.fn>;
  ready: Promise<void>;
  resetReady: () => void;
  resolveReady: () => void;
  createPresenceRoom: ReturnType<typeof vi.fn>;
  presence: unknown;
};

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
    let captured:
      | ReturnType<typeof usePresence<"selection", { x: number }>>
      | null = null;

    function TestComponent() {
      captured = usePresence<"selection", { x: number }>("selection");
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
    expect(playhtml.presence.setMyPresence).toHaveBeenLastCalledWith("selection", {
      x: 2,
    });

    await waitFor(() => {
      expect(captured!.presences.size).toBeGreaterThan(0);
      expect(captured!.presences.get("me")).toMatchObject({
        selection: { x: 2 },
        isMe: true,
      });
    });
    expect(captured!.presences.get("me")).not.toHaveProperty("x");
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

  it("supports functional updates for primitive page data", async () => {
    let captured: ReturnType<typeof usePageData<number>> | null = null;

    function TestComponent() {
      captured = usePageData("view-count", 0);
      return <div>{captured[0]}</div>;
    }

    const { getByText } = render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    await waitFor(() => expect(getByText("0")).toBeDefined());

    act(() => {
      captured![1]((value) => value + 1);
    });

    await waitFor(() => expect(getByText("1")).toBeDefined());
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

  it("keeps returning null when the provider is briefly ahead of core readiness", async () => {
    mockedPlayhtml.resetReady();
    mockedPlayhtml.isLoading = false;
    mockedPlayhtml.init.mockImplementation(() => mockedPlayhtml.ready);
    mockedPlayhtml.createPresenceRoom.mockClear();

    const room = {
      presence: mockedPlayhtml.presence,
      destroy: vi.fn(),
    };
    mockedPlayhtml.createPresenceRoom
      .mockImplementationOnce(() => {
        throw new Error("playhtml.createPresenceRoom is not available before init()");
      })
      .mockImplementation(() => room);

    function TestComponent() {
      const room = usePresenceRoom("voice");
      return <div data-testid="room">{room ? "ready" : "loading"}</div>;
    }

    const { getByTestId } = render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    expect(getByTestId("room")).toHaveTextContent("loading");
    await waitFor(() => {
      expect(mockedPlayhtml.createPresenceRoom).toHaveBeenCalledTimes(1);
    });

    act(() => {
      document.dispatchEvent(new CustomEvent("playhtml:navigated"));
    });

    await waitFor(() => {
      expect(getByTestId("room")).toHaveTextContent("ready");
    });
  });

  it("retries the current room name when readiness resolves", async () => {
    mockedPlayhtml.resetReady();
    mockedPlayhtml.isLoading = false;
    mockedPlayhtml.init.mockImplementation(() => mockedPlayhtml.ready);
    mockedPlayhtml.createPresenceRoom.mockClear();

    let coreReady = false;
    mockedPlayhtml.createPresenceRoom.mockImplementation((name: string) => {
      if (!coreReady) {
        throw new Error("playhtml.createPresenceRoom is not available before init()");
      }
      return {
        name,
        presence: mockedPlayhtml.presence,
        destroy: vi.fn(),
      };
    });

    function TestComponent({ name }: { name: string }) {
      const room = usePresenceRoom(name) as { name: string } | null;
      return <div data-testid="room">{room?.name ?? "loading"}</div>;
    }

    const { getByTestId, rerender } = render(
      <PlayProvider>
        <TestComponent name="first" />
      </PlayProvider>,
    );
    expect(getByTestId("room")).toHaveTextContent("loading");

    rerender(
      <PlayProvider>
        <TestComponent name="second" />
      </PlayProvider>,
    );
    coreReady = true;
    act(() => {
      mockedPlayhtml.resolveReady();
    });

    await waitFor(() => {
      expect(getByTestId("room")).toHaveTextContent("second");
    });
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

    expect(seen[0]).toEqual({
      color: "",
      pid: undefined,
      name: undefined,
      verified: false,
      roles: [],
    });

    await waitFor(() => {
      expect(seen.at(-1)?.pid).toBe("mock-pid");
    });
    expect(seen.at(-1)).toEqual({
      color: "#123456",
      pid: "mock-pid",
      name: undefined,
      verified: false,
      roles: [],
    });
  });

  it("reflects a color/name change made via playhtml.users.me", async () => {
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
    });

    await waitFor(() => {
      expect(captured?.color.toLowerCase()).toBe("#ffae00");
      expect(captured?.name).toBe("ada");
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
  it("returns an empty array pre-sync, then includes self post-sync", async () => {
    let captured: Array<{ isMe: boolean }> | null = null;
    function TestComponent() {
      captured = useUsers();
      return <div />;
    }

    render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>,
    );

    await waitFor(() => {
      expect(captured?.length).toBeGreaterThan(0);
    });
    const self = captured!.find((user) => user.isMe);
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
