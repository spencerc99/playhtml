// ABOUTME: Summarizes admin comparisons between persisted and live room data.
// ABOUTME: Provides small pure helpers for rendering admin console drift state.
type ComparisonStatus = "different" | "match" | "unavailable";
type ComparisonDifferenceKind = "admin-only" | "changed" | "live-only";

export interface AdminComparisonDifference {
  adminPreview: string;
  kind: ComparisonDifferenceKind;
  livePreview: string;
  path: string;
}

export interface AdminComparisonSummary {
  dataMatch: boolean | null;
  differenceCount: number;
  differences: AdminComparisonDifference[];
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathsEqualValue(adminValue: unknown, liveValue: unknown): boolean {
  return JSON.stringify(adminValue) === JSON.stringify(liveValue);
}

function formatPath(path: Array<string | number>): string {
  if (path.length === 0) return "root";

  return path
    .map((segment, index) => {
      if (typeof segment === "number") return `[${segment}]`;
      return index === 0 ? segment : `.${segment}`;
    })
    .join("");
}

function previewValue(value: unknown): string {
  if (typeof value === "undefined") return "undefined";

  const preview =
    typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);

  if (typeof preview !== "string") return String(value);
  return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
}

function collectDifferences(
  adminValue: unknown,
  liveValue: unknown,
  path: Array<string | number> = []
): AdminComparisonDifference[] {
  if (pathsEqualValue(adminValue, liveValue)) {
    return [];
  }

  if (Array.isArray(adminValue) && Array.isArray(liveValue)) {
    const differences: AdminComparisonDifference[] = [];
    const length = Math.max(adminValue.length, liveValue.length);

    for (let index = 0; index < length; index++) {
      const nextPath = [...path, index];

      if (index >= adminValue.length) {
        differences.push({
          adminPreview: "missing",
          kind: "live-only",
          livePreview: previewValue(liveValue[index]),
          path: formatPath(nextPath),
        });
        continue;
      }

      if (index >= liveValue.length) {
        differences.push({
          adminPreview: previewValue(adminValue[index]),
          kind: "admin-only",
          livePreview: "missing",
          path: formatPath(nextPath),
        });
        continue;
      }

      differences.push(
        ...collectDifferences(adminValue[index], liveValue[index], nextPath)
      );
    }

    return differences;
  }

  if (isPlainObject(adminValue) && isPlainObject(liveValue)) {
    const keys = Array.from(
      new Set([...Object.keys(adminValue), ...Object.keys(liveValue)])
    ).sort();

    return keys.flatMap((key) => {
      const nextPath = [...path, key];
      const hasAdminValue = Object.prototype.hasOwnProperty.call(
        adminValue,
        key
      );
      const hasLiveValue = Object.prototype.hasOwnProperty.call(
        liveValue,
        key
      );

      if (!hasAdminValue) {
        return [
          {
            adminPreview: "missing",
            kind: "live-only" as const,
            livePreview: previewValue(liveValue[key]),
            path: formatPath(nextPath),
          },
        ];
      }

      if (!hasLiveValue) {
        return [
          {
            adminPreview: previewValue(adminValue[key]),
            kind: "admin-only" as const,
            livePreview: "missing",
            path: formatPath(nextPath),
          },
        ];
      }

      return collectDifferences(adminValue[key], liveValue[key], nextPath);
    });
  }

  return [
    {
      adminPreview: previewValue(adminValue),
      kind: "changed",
      livePreview: previewValue(liveValue),
      path: formatPath(path),
    },
  ];
}

export function createComparisonSummary(
  comparison: any
): AdminComparisonSummary {
  if (!comparison) {
    return {
      dataMatch: null,
      differenceCount: 0,
      differences: [],
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
  const differences = collectDifferences(
    comparison.methods?.direct?.data,
    comparison.methods?.live?.data
  );
  const directElementCount = countElements(comparison.methods?.direct?.data);
  const liveElementCount = countElements(comparison.methods?.live?.data);

  if (dataMatch === false) {
    return {
      dataMatch,
      differenceCount: differences.length,
      differences,
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
      differenceCount: differences.length,
      differences,
      directElementCount,
      liveElementCount,
      shouldShowDetails: false,
      status: "match",
      statusLabel: "Live and admin data match",
    };
  }

  return {
    dataMatch,
    differenceCount: 0,
    differences: [],
    directElementCount,
    liveElementCount,
    shouldShowDetails: false,
    status: "unavailable",
    statusLabel: "Comparison unavailable",
  };
}
