// ABOUTME: Tests that a milestone toast dismisses exactly once.
// ABOUTME: Covers auto-hide racing a close click, and unmounting during the exit animation.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MilestoneToast,
  type MilestoneToastData,
} from "../components/MilestoneToast";

const MILESTONE: MilestoneToastData = {
  type: "screenTime",
  displayValue: "2h 14m",
  copy: "time online today",
  ctaLabel: "see your trail",
  ctaAction: "TOGGLE_HISTORICAL_OVERLAY",
  period: "today",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("MilestoneToast", () => {
  it("calls onDismiss once when auto-hide and a close click both fire", () => {
    const onDismiss = vi.fn();
    act(() =>
      root.render(
        <MilestoneToast
          milestone={MILESTONE}
          onDismiss={onDismiss}
          autoHideMs={1_000}
        />,
      ),
    );

    act(() => vi.advanceTimersByTime(1_000));
    act(() =>
      container.querySelector<HTMLButtonElement>(".wwo-toast-close")?.click(),
    );
    act(() => vi.advanceTimersByTime(1_000));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not call onDismiss after unmounting mid-exit", () => {
    const onDismiss = vi.fn();
    act(() =>
      root.render(<MilestoneToast milestone={MILESTONE} onDismiss={onDismiss} />),
    );

    act(() =>
      container.querySelector<HTMLButtonElement>(".wwo-toast-close")?.click(),
    );
    act(() => root.render(<></>));
    act(() => vi.advanceTimersByTime(1_000));

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
