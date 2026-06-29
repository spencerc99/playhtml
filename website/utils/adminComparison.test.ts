// ABOUTME: Verifies admin comparison summaries for live and database room data.
// ABOUTME: Keeps drift detection behavior independent from the admin console UI.
import { describe, expect, test } from "bun:test";

import {
  createComparisonSummary,
  createInlineDiffLookup,
} from "./adminComparison";

describe("createComparisonSummary", () => {
  test("summarizes matching live and admin data without showing details", () => {
    const summary = createComparisonSummary({
      methods: {
        direct: {
          data: {
            "can-move": {
              box: { x: 1 },
            },
          },
        },
        live: {
          data: {
            "can-move": {
              box: { x: 1 },
            },
          },
        },
      },
      differences: {
        dataMatch: true,
      },
    });

    expect(summary).toEqual({
      dataMatch: true,
      differenceCount: 0,
      differences: [],
      directElementCount: 1,
      liveElementCount: 1,
      shouldShowDetails: false,
      status: "match",
      statusLabel: "Live and admin data match",
    });
  });

  test("flags drift and asks the admin console to show comparison details", () => {
    const summary = createComparisonSummary({
      methods: {
        direct: {
          data: {
            "can-move": {
              box: { x: 1 },
            },
          },
        },
        live: {
          data: {
            "can-move": {
              box: { x: 2 },
              circle: { x: 3 },
            },
          },
        },
      },
      differences: {
        dataMatch: false,
      },
    });

    expect(summary).toEqual({
      dataMatch: false,
      differenceCount: 2,
      differences: [
        {
          adminPreview: "1",
          kind: "changed",
          livePreview: "2",
          path: "can-move.box.x",
        },
        {
          adminPreview: "missing",
          kind: "live-only",
          livePreview: "{\"x\":3}",
          path: "can-move.circle",
        },
      ],
      directElementCount: 1,
      liveElementCount: 2,
      shouldShowDetails: true,
      status: "different",
      statusLabel: "Live and admin data differ",
    });
  });

  test("treats missing comparison data as unavailable", () => {
    const summary = createComparisonSummary(null);

    expect(summary).toEqual({
      dataMatch: null,
      differenceCount: 0,
      differences: [],
      directElementCount: 0,
      liveElementCount: 0,
      shouldShowDetails: false,
      status: "unavailable",
      statusLabel: "Comparison not run",
    });
  });

  test("reports nested admin-only and live-only values in path order", () => {
    const summary = createComparisonSummary({
      methods: {
        direct: {
          data: {
            "can-play": {
              guestbook: {
                entries: [
                  { id: "first", text: "hello" },
                  { id: "second", text: "admin only" },
                ],
              },
            },
          },
        },
        live: {
          data: {
            "can-play": {
              guestbook: {
                entries: [
                  { id: "first", text: "hello" },
                  { id: "third", text: "live only" },
                ],
              },
            },
          },
        },
      },
      differences: {
        dataMatch: false,
      },
    });

    expect(summary.differences).toEqual([
      {
        adminPreview: "\"second\"",
        kind: "changed",
        livePreview: "\"third\"",
        path: "can-play.guestbook.entries[1].id",
      },
      {
        adminPreview: "\"admin only\"",
        kind: "changed",
        livePreview: "\"live only\"",
        path: "can-play.guestbook.entries[1].text",
      },
    ]);
  });

  test("maps differences to git-style admin and live inline markers", () => {
    const summary = createComparisonSummary({
      methods: {
        direct: {
          data: {
            "can-move": {
              box: { x: 1 },
              triangle: { x: 4 },
            },
          },
        },
        live: {
          data: {
            "can-move": {
              box: { x: 2 },
              circle: { x: 3 },
            },
          },
        },
      },
      differences: {
        dataMatch: false,
      },
    });

    expect(createInlineDiffLookup(summary.differences)).toEqual({
      admin: {
        "can-move.box.x": "removed",
        "can-move.triangle": "removed",
      },
      live: {
        "can-move.box.x": "added",
        "can-move.circle": "added",
      },
    });
  });
});
