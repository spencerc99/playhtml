// ABOUTME: Tests React element binding lifecycle against the real playhtml core.
// ABOUTME: Verifies data-source changes remove handlers created after asynchronous ID assignment.
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { elementHandlers, playhtml, resetPlayHTML, TagType } from "playhtml";
import { withSharedState } from "../index";

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
});
