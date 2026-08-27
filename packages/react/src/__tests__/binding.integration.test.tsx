// ABOUTME: Tests React hooks and element bindings against the real playhtml core.
// ABOUTME: Verifies binding cleanup and presence-room readiness across navigation.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { elementHandlers, playhtml, resetPlayHTML, TagType } from "playhtml";
import {
  CanMoveElement,
  PlayProvider,
  usePresenceRoom,
  withSharedState,
} from "../index";

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

  it("registers built-in capabilities with one renderer name", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <CanMoveElement standalone>
        <div id="moving-card">move me</div>
      </CanMoveElement>,
    );

    await waitFor(() => {
      expect(
        elementHandlers.get(TagType.CanMove)?.get("moving-card"),
      ).toBeDefined();
    });
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("update and updateElement are mutually exclusive"),
    );
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
