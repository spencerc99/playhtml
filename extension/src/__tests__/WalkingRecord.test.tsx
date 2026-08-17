// ABOUTME: Verifies the walking record period rail renders and dispatches navigation.
// ABOUTME: Covers data-weighted dabs, scope selection, and the forward boundary.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import type { TrailState } from "@movement/types";
import {
  cycleLandscapeTrails,
  scheduleLandscapeTrails,
} from "../components/MovementLandscape";
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
  settledPlaces: [
    {
      site: "garden.example",
      href: "https://garden.example",
      faviconUrl: "https://garden.example/icon.png",
      activeTime: "18m active",
      evidence: "returned in the mornings on 3 days · visited 3 pages",
      hue: "#d18a6b",
      score: 0.7,
    },
  ],
  landscapePaths: [],
  dayPlates: [
    {
      date: "day:2026-07-27",
      day: "mon",
      vignette: "12m on example.com",
      hue: "#4a9a8a",
      future: false,
      portraitDay: "2026-07-27",
      traceTargets: [],
      tracePaths: [],
    },
    {
      date: "2026-08-02",
      day: "sun",
      vignette: "still to come",
      hue: "#b5aea5",
      future: true,
      traceTargets: [],
      tracePaths: [],
    },
  ],
  timeSpent: [
    {
      rank: 1,
      site: "example.com",
      faviconUrl: "https://example.com/icon.png",
      time: "12 min",
      percentage: 80,
      hue: "#4a9a8a",
      note: "mostly around 9 AM–10 AM",
      href: "https://example.com",
    },
    {
      rank: 2,
      site: "3 others",
      time: "4m",
      percentage: 20,
      hue: "#c8c3bb",
      note: "",
    },
  ],
};

const periodSummaries: WalkingRecordPeriodSummary[] = Array.from(
  { length: 12 },
  (_, index) => {
    const offset = index - 11;
    return {
      offset,
      range: getWalkingRecordPeriodRange("week", offset, new Date(2026, 6, 30)),
      totalTimeMs: (index + 1) * 60 * 60_000,
    };
  },
);

function trailState(
  id: string,
  startOffsetMs: number,
  durationMs: number,
): TrailState {
  return {
    trail: {
      id,
      points: [
        { x: 10, y: 10, ts: 1_000 },
        { x: 20, y: 20, ts: 2_000 },
      ],
      color: "#4a9a8a",
      opacity: 1,
      startTime: 1_000,
      endTime: 2_000,
      clicks: [],
    },
    startOffsetMs,
    durationMs,
    variedPoints: [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ],
    clicksWithProgress: [],
  };
}

async function renderWalkingRecord(
  periodOffset: number,
  callbacks: {
    onPeriodChange: ReturnType<typeof vi.fn>;
    onPeriodOffsetChange: ReturnType<typeof vi.fn>;
  },
  loading = false,
  visibleRecord = record,
  movementLoading = false,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <WalkingRecordPage
        record={visibleRecord}
        period="week"
        periodOffset={periodOffset}
        periodSummaries={periodSummaries}
        onPeriodChange={callbacks.onPeriodChange}
        onPeriodOffsetChange={callbacks.onPeriodOffsetChange}
        loading={loading}
        movementLoading={movementLoading}
        loadingProgress={{
          completed: 3,
          total: 5,
          message: "mapping familiar roads…",
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
      wwoInternalAccess: { enabled: false, checkedAt: 1 },
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
      expect(later?.textContent).toBe("later ↦");
      expect(later?.disabled).toBe(true);
      expect(
        Array.from(container.querySelectorAll("section h1, section h2")).map(
          (heading) => heading.textContent,
        ),
      ).toEqual([
        "how you browsed",
        "places you settled into",
        "browsing portraits",
      ]);
      expect(
        container
          .querySelector(".walking-record__settled-ledger strong")
          ?.getAttribute("title"),
      ).toBe("garden.example");
      expect(
        (
          container.querySelector(
            ".walking-record__time-legend-site",
          ) as HTMLElement | null
        )?.style.borderBottomColor,
      ).toBe("rgb(74, 154, 138)");
      expect(
        container.querySelector(".walking-record__site-favicon-globe"),
      ).not.toBeNull();
      expect(
        container
          .querySelector(".walking-record__site-favicon")
          ?.getAttribute("src"),
      ).toBe("https://example.com/icon.png");
      expect(
        container.querySelector(".walking-record__day-plate--future"),
      ).not.toBeNull();
      expect(
        container
          .querySelector('a[title="Open mon portrait"]')
          ?.getAttribute("href"),
      ).toBe("chrome-extension://test/portrait.html?day=2026-07-27");
      expect(
        container.querySelector(".walking-record__future-trace"),
      ).not.toBeNull();
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
    const { container, root } = await renderWalkingRecord(0, callbacks, true);

    try {
      const progress = container.querySelector(
        '[role="progressbar"]',
      ) as HTMLElement | null;
      const cursorWalk = container.querySelector(
        ".walking-record__loading-cursors",
      );

      expect(container.textContent).toContain("mapping familiar roads…");
      expect(container.textContent).toContain("60%");
      expect(cursorWalk?.getAttribute("aria-hidden")).toBe("true");
      expect(
        cursorWalk?.querySelectorAll(".walking-record__loading-cursor"),
      ).toHaveLength(3);
      expect(progress?.getAttribute("aria-valuenow")).toBe("60");
      expect(progress?.querySelector("span")?.style.width).toBe("60%");
    } finally {
      cleanup(root, container);
    }
  });

  it("shows a compact total beside how you browsed", async () => {
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(
      0,
      callbacks,
      false,
      {
        ...record,
        totalTimeMs: 62 * 60_000,
        totalTimeLabel: "1 hr 2 min",
      },
    );

    try {
      expect(container.textContent).toContain("1h2m online this week");
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

  it("shows a real movement landscape when the period has cursor paths", async () => {
    const cursorEvent = (id: string, ts: number, x: number) => ({
      id,
      type: "cursor" as const,
      ts,
      data: { event: "move" as const, x, y: 0.5 },
      meta: {
        pid: "pk_test",
        sid: "sid_test",
        url: "https://example.com/page",
        vw: 1_000,
        vh: 800,
        tz: "America/Los_Angeles",
        cursor_color: "#4a9a8a",
      },
    });
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(0, callbacks, false, {
      ...record,
      landscapePaths: [
        [
          cursorEvent("cursor-1", 1_000, 0.2),
          cursorEvent("cursor-2", 1_250, 0.8),
        ],
      ],
    });

    try {
      expect(container.textContent).toContain("movement from this week");
      expect(
        container
          .querySelector(".walking-record__movement-landscape")
          ?.getAttribute("aria-label"),
      ).toBe("Real cursor movements from this week");
    } finally {
      cleanup(root, container);
    }
  });

  it("localizes cursor movement loading after the base record is visible", async () => {
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(
      0,
      callbacks,
      false,
      record,
      true,
    );

    try {
      expect(container.querySelector(".walking-record__portrait")).not.toBeNull();
      expect(container.querySelector(".walking-record__loading")).toBeNull();
      expect(container.textContent).toContain("restoring portrait trails…");
      expect(container.textContent).toContain("restoring movement…");
      expect(
        container.querySelectorAll(".walking-record__day-plate-skeleton"),
      ).toHaveLength(1);
      expect(
        container.querySelector(".walking-record__movement-skeleton"),
      ).not.toBeNull();
    } finally {
      cleanup(root, container);
    }
  });

  it("reveals every ranked exploration in place", async () => {
    const departures = Array.from({ length: 5 }, (_, index) => ({
      day: "mon",
      from: "google.com",
      to: `small-${index + 1}.example`,
      toUrl: `https://small-${index + 1}.example`,
      time: `${index + 1} min active`,
      note: "your first visit",
      score: 1 - index * 0.1,
    }));
    const callbacks = {
      onPeriodChange: vi.fn(),
      onPeriodOffsetChange: vi.fn(),
    };
    const { container, root } = await renderWalkingRecord(0, callbacks, false, {
      ...record,
      departures,
      movementCount: departures.length,
    });

    try {
      const showMore = container.querySelector(
        ".walking-record__departures-more",
      ) as HTMLButtonElement;

      expect(
        container.querySelectorAll(".walking-record__departure"),
      ).toHaveLength(3);
      expect(container.textContent).toContain("3 shown from 5");
      expect(showMore.textContent).toBe("show more");

      await act(async () => {
        showMore.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(
        container.querySelectorAll(".walking-record__departure"),
      ).toHaveLength(5);
      expect(container.textContent).toContain("5 shown from 5");
      expect(showMore.textContent).toBe("show less");
      expect(showMore.getAttribute("aria-expanded")).toBe("true");
    } finally {
      cleanup(root, container);
    }
  });

  it("keeps landscape trails entering on a dense repeating schedule", () => {
    const scheduled = scheduleLandscapeTrails([
      trailState("long", 1_000, 60_000),
      trailState("short", 0, 500),
      trailState("medium", 500, 6_000),
    ]);

    expect(scheduled.map((trail) => trail.durationMs)).toEqual([
      9_000, 3_000, 6_000,
    ]);
    expect(scheduled.map((trail) => trail.startOffsetMs)).toEqual([
      600, 0, 300,
    ]);

    const playback = cycleLandscapeTrails(scheduled);
    expect(playback.duration).toBe(6_000);
    expect(
      playback.trailStates.filter((trail) => trail.startOffsetMs < 0),
    ).toHaveLength(2);
    expect(
      playback.trailStates
        .filter((trail) => trail.startOffsetMs < 0)
        .every((trail) => trail.startOffsetMs + trail.durationMs > 0),
    ).toBe(true);
  });
});
