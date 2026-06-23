// ABOUTME: Summarizes admin comparisons between persisted and live room data.
// ABOUTME: Provides small pure helpers for rendering admin console drift state.
type ComparisonStatus = "different" | "match" | "unavailable";

export interface AdminComparisonSummary {
  dataMatch: boolean | null;
  directElementCount: number;
  liveElementCount: number;
  shouldShowDetails: boolean;
  status: ComparisonStatus;
  statusLabel: string;
}

function countElements(data: unknown): number {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return 0;
  }

  return Object.values(data).reduce((sum, tagData) => {
    if (!tagData || typeof tagData !== "object" || Array.isArray(tagData)) {
      return sum;
    }

    return sum + Object.keys(tagData).length;
  }, 0);
}

export function createComparisonSummary(
  comparison: any
): AdminComparisonSummary {
  if (!comparison) {
    return {
      dataMatch: null,
      directElementCount: 0,
      liveElementCount: 0,
      shouldShowDetails: false,
      status: "unavailable",
      statusLabel: "Comparison not run",
    };
  }

  const dataMatch =
    typeof comparison.differences?.dataMatch === "boolean"
      ? comparison.differences.dataMatch
      : null;
  const directElementCount = countElements(comparison.methods?.direct?.data);
  const liveElementCount = countElements(comparison.methods?.live?.data);

  if (dataMatch === false) {
    return {
      dataMatch,
      directElementCount,
      liveElementCount,
      shouldShowDetails: true,
      status: "different",
      statusLabel: "Live and admin data differ",
    };
  }

  if (dataMatch === true) {
    return {
      dataMatch,
      directElementCount,
      liveElementCount,
      shouldShowDetails: false,
      status: "match",
      statusLabel: "Live and admin data match",
    };
  }

  return {
    dataMatch,
    directElementCount,
    liveElementCount,
    shouldShowDetails: false,
    status: "unavailable",
    statusLabel: "Comparison unavailable",
  };
}
