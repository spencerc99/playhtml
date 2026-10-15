// ABOUTME: Parses the generated reserve catalog into reviewable Commute candidates.
// ABOUTME: Preserves editorial provenance without turning source membership into policy.

import type { CommuteReviewItem } from "./curation";

export type ReserveSourceMode = "trusted-editorial" | "discovery-only";

export type ReserveMetadata = {
  sourceCollection: string;
  sourceUrl: string;
  sourceMode: ReserveSourceMode;
  issue?: string;
  section?: string;
  tags: string[];
  interactionLevel: string;
  healthStatus: string;
  healthNote: string;
};

export type ReserveReviewItem = CommuteReviewItem & {
  reserve: ReserveMetadata;
};

export type ReserveCatalog = {
  generatedAt: string;
  items: ReserveReviewItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength = 2_000,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Reserve catalog has an invalid ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, 500);
}

function requiredWebUrl(value: unknown, field: string): string {
  const url = requiredString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Reserve catalog has an invalid ${field}.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Reserve catalog has an invalid ${field}.`);
  }
  return url;
}

function parseEntry(value: unknown): ReserveReviewItem {
  if (!isRecord(value) || !isRecord(value.health)) {
    throw new Error("Reserve catalog contains an invalid entry.");
  }
  const url = requiredWebUrl(value.url, "URL");
  const parsedUrl = new URL(url);
  if (
    value.sourceMode !== "trusted-editorial" &&
    value.sourceMode !== "discovery-only"
  ) {
    throw new Error("Reserve catalog contains an invalid source mode.");
  }
  if (
    !Array.isArray(value.tags) ||
    value.tags.length === 0 ||
    !value.tags.every((tag) => typeof tag === "string" && tag.length <= 100)
  ) {
    throw new Error("Reserve catalog contains invalid tags.");
  }

  const issue = optionalString(value.issue, "issue");
  const section = optionalString(value.section, "section");
  return {
    id: url,
    url,
    domain: parsedUrl.hostname.replace(/^www\./, ""),
    title: requiredString(value.title, "title", 500),
    currentDisposition: "stop",
    reserve: {
      sourceCollection: requiredString(
        value.sourceCollection,
        "source collection",
        200,
      ),
      sourceUrl: requiredWebUrl(value.sourceUrl, "source URL"),
      sourceMode: value.sourceMode,
      ...(issue ? { issue } : {}),
      ...(section ? { section } : {}),
      tags: [...new Set(value.tags as string[])],
      interactionLevel: requiredString(
        value.interactionLevel,
        "interaction level",
        100,
      ),
      healthStatus: requiredString(value.health.status, "health status", 100),
      healthNote: requiredString(value.health.note, "health note", 500),
    },
  };
}

export function parseReserveCatalog(value: unknown): ReserveCatalog {
  if (
    !isRecord(value) ||
    value.format !== "internet-commute-reserve-catalog/v1" ||
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("Reserve catalog is malformed.");
  }

  const items = value.entries.map(parseEntry);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Reserve catalog contains duplicate URLs.");
  }

  return { generatedAt: value.generatedAt, items };
}
