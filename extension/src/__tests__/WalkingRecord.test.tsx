// ABOUTME: Verifies the walking record period rail renders and dispatches navigation.
// ABOUTME: Covers data-weighted dabs, scope selection, and the forward boundary.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { WalkingRecordPage } from "../components/WalkingRecord";
import {
  getWalkingRecordPeriodRange,
  type WalkingRecord,
  type WalkingRecordPeriodSummary,
} from "../history/walkingRecord";

const record: WalkingRecord = {
  period: "week",
  range: {
    startTs: new Date(2026, 6, 27).getTime(),
    endTs: new Date(2026, 7, 3).getTime() - 1,
  },
  rangeLabel: "jul 27 – aug 2, 2026",
  totalTimeMs: 0,
  totalTimeLabel: "0 min",
  cursorDistancePx: 0,
  pageCount: 0,
  hourBuckets: new Array(24).fill(0),
  movementCount: 0,
  departures: [],
  revisits: [],
  dayPlates: [],
  timeSpent: [],
  timeSpentIntro: "there is no screen-time record for this period.",
};

const periodSummaries: WalkingRecordPeriodSummary[] = Array.from(
  { length: 12 },
  (_, index) => {
    const offset = index - 11;
    return {
      offset,
      range: getWalkingRecordPeriodRange(
        "week",
        offset,
        new Date(2026, 6, 30),
      ),
      totalTimeMs: (index + 1) * 60 * 60_000,
    };
  },
);

async function renderWalkingRecord(
  periodOffset: number,
  callbacks: {
    onPeriodChange: ReturnType<typeof vi.fn>;
    onPeriodOffsetChange: ReturnType<typeof vi.fn>;
  },
  loading = false,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <WalkingRecordPage
        record={record}
        period="week"
        periodOffset={periodOffset}
        periodSummaries={periodSummaries}
        onPeriodChange={callbacks.onPeriodChange}
        onPeriodOffsetChange={callbacks.onPeriodOffsetChange}
        loading={loading}
        loadingProgress={{
          completed: 3,
          total: 5,
          message: "familiar places found…",
        }}
        error={null}
      />,
    );
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("WalkingRecordPage calendar navigation", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.assign(browser.runtime, {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    });
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      internalDevFeaturesEnabled: false,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      globalAlpha: 1,
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders twelve stable dabs and the latest-week disabled state", async () => {
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(0, callbacks);

    try {
      const earlier = container.querySelector('[aria-label="Earlier week"]');
      const later = container.querySelector(
        '[aria-label="Later week"]',
      ) as HTMLButtonElement | null;
      const dabs = container.querySelectorAll("[data-period-offset]");
      const selected = container.querySelector('[data-period-offset="0"]');
      const lightestDab = dabs[0]?.querySelector("span");
      const heavierDab = dabs[10]?.querySelector("span");

      expect(
        container.textContent?.match(/jul 27 – aug 2, 2026/g),
      ).toHaveLength(1);
      expect(dabs).toHaveLength(12);
      expect(selected?.getAttribute("title")).toBe("week of Jul 27, 2026");
      expect(selected?.getAttribute("aria-pressed")).toBe("true");
      expect(lightestDab?.style.width).toBe("4.68px");
      expect(heavierDab?.style.width).toBe("6.48px");
      expect(Number(lightestDab?.style.opacity)).toBeCloseTo(0.315);
      expect(Number(heavierDab?.style.opacity)).toBeCloseTo(0.465);
      expect(earlier?.textContent).toBe("↤ earlier");
      expect(later?.textContent).toBe("browsing to come ↦");
      expect(later?.disabled).toBe(true);

      await act(async () => {
        earlier?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        selected?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(callbacks.onPeriodOffsetChange).toHaveBeenNthCalledWith(1, -1);
      expect(callbacks.onPeriodOffsetChange).toHaveBeenNthCalledWith(2, 0);
    } finally {
      cleanup(root, container);
    }
  });

  it("shows the current loading step and measured progress", async () => {
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(
      0,
      callbacks,
      true,
    );

    try {
      const progress = container.querySelector(
        '[role="progressbar"]',
      ) as HTMLElement | null;

      expect(container.textContent).toContain("familiar places found…");
      expect(container.textContent).toContain("60%");
      expect(progress?.getAttribute("aria-valuenow")).toBe("60");
      expect(progress?.querySelector("span")?.style.width).toBe("60%");
    } finally {
      cleanup(root, container);
    }
  });

  it("selects another scope and allows stepping toward the current period", async () => {
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(-1, callbacks);

    try {
      const month = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "month",
      );
      const later = container.querySelector('[aria-label="Later week"]');

      await act(async () => {
        month?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        later?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(callbacks.onPeriodChange).toHaveBeenCalledWith("month");
      expect(later?.textContent).toBe("later ↦");
      expect(callbacks.onPeriodOffsetChange).toHaveBeenCalledWith(0);
    } finally {
      cleanup(root, container);
    }
  });
});
