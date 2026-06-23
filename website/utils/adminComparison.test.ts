// ABOUTME: Verifies admin comparison summaries for live and database room data.
// ABOUTME: Keeps drift detection behavior independent from the admin console UI.
import { describe, expect, test } from "bun:test";

import { createComparisonSummary } from "./adminComparison";

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
      directElementCount: 0,
      liveElementCount: 0,
      shouldShowDetails: false,
      status: "unavailable",
      statusLabel: "Comparison not run",
    });
  });
});
