// ABOUTME: Tests React hooks and element bindings against the real playhtml core.
// ABOUTME: Verifies binding cleanup and presence-room readiness across navigation.
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { elementHandlers, playhtml, resetPlayHTML, TagType } from "playhtml";
import { PlayProvider, usePresenceRoom, withSharedState } from "../index";

describe("CanPlayElement binding lifecycle", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    await playhtml.init({});
  });

  afterEach(async () => {
    cleanup();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("removes the previous data-source handler after core assigns a DOM id", async () => {
    const SharedElement = withSharedState(
      ({ dataSource }: { dataSource: string }) => ({
        dataSource,
        defaultData: { count: 0 },
        standalone: true,
      }),
      ({ data }) => <div>{data.count}</div>,
    );

    const { container, rerender, unmount } = render(
      <SharedElement dataSource="/first#first-source" />,
    );
    const element = container.querySelector("[can-play]") as HTMLElement;

    await waitFor(() => {
      expect(
        elementHandlers.get(TagType.CanPlay)?.get("first-source")
          ?.element,
      ).toBe(element);
    });
    expect(element.id).not.toBe("");

    rerender(<SharedElement dataSource="/second#second-source" />);

    await waitFor(() => {
      expect(
        elementHandlers.get(TagType.CanPlay)?.get("second-source")
          ?.element,
      ).toBe(element);
    });
    expect(
      elementHandlers.get(TagType.CanPlay)?.has("first-source"),
    ).toBe(false);

    unmount();
  });

  it("lets a newly mounted movable element respond during the same commit", async () => {
    const MovableWord = withSharedState<
      { x: number; y: number },
      { startMouseX: number; startMouseY: number }
    >(
      {
        id: "new-word",
        standalone: true,
        tagInfo: [TagType.CanMove],
        defaultData: { x: 0, y: 0 },
        defaultLocalData: { startMouseX: 0, startMouseY: 0 },
        onDragStart: (event, { setLocalData }) => {
          const mouseEvent = event as MouseEvent;
          setLocalData({
            startMouseX: mouseEvent.clientX,
            startMouseY: mouseEvent.clientY,
          });
        },
        onDrag: (event, { data, localData, setData }) => {
          const mouseEvent = event as MouseEvent;
          setData({
            x: data.x + mouseEvent.clientX - localData.startMouseX,
            y: data.y + mouseEvent.clientY - localData.startMouseY,
          });
        },
      },
      ({ data }) => (
        <div
          data-testid="new-word"
          style={{ transform: `translate(${data.x}px, ${data.y}px)` }}
        />
      ),
    );

    function FridgeWordCommit() {
      React.useLayoutEffect(() => {
        const word = document.querySelector(
          '[data-testid="new-word"]',
        ) as HTMLElement;
        word.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            clientX: 20,
            clientY: 30,
          }),
        );
        document.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: 70,
            clientY: 80,
          }),
        );
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }, []);

      return <MovableWord />;
    }

    const rendered = render(<FridgeWordCommit />);

    await waitFor(() => {
      expect(rendered.getByTestId("new-word").style.transform).toBe(
        "translate(50px, 50px)",
      );
    });
  });
});

describe("usePresenceRoom navigation readiness", () => {
  const originalPath = window.location.pathname + window.location.search;

  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    history.replaceState(null, "", "/presence-room-a");
    await playhtml.init({});
  });

  afterEach(async () => {
    cleanup();
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    history.replaceState(null, "", originalPath);
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("recovers when the provider remounts while the next page is syncing", async () => {
    function RoomStatus() {
      const room = usePresenceRoom("chat");
      return <div data-testid="room">{room ? "ready" : "loading"}</div>;
    }

    const firstRender = render(
      <PlayProvider>
        <RoomStatus />
      </PlayProvider>,
    );
    await waitFor(() => {
      expect(firstRender.getByTestId("room").textContent).toBe("ready");
    });

    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = true;
    history.replaceState(null, "", "/presence-room-b");

    let navigation!: Promise<void>;
    act(() => {
      navigation = playhtml.handleNavigation();
    });
    firstRender.unmount();

    const secondRender = render(
      <PlayProvider>
        <RoomStatus />
      </PlayProvider>,
    );
    expect(secondRender.getByTestId("room").textContent).toBe("loading");

    const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as Array<{
      emit: (type: string, value: boolean) => void;
    }>;
    act(() => {
      providers.at(-1)?.emit("sync", true);
    });
    await act(async () => {
      await navigation;
    });

    await waitFor(() => {
      expect(secondRender.getByTestId("room").textContent).toBe("ready");
    });
  });
});
