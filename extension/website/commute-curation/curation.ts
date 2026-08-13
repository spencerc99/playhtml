// ABOUTME: Defines local Internet Commute curation decisions and their portable artifact.
// ABOUTME: Normalizes submitted places and keeps serialization deterministic for review.

export const CURATION_STORAGE_KEY = "wwo-commute-curation-v1";

export const CURATION_VERDICTS = [
  "promoted",
  "scenery-only",
  "blocked",
] as const;

export type CurationVerdict = (typeof CURATION_VERDICTS)[number];

export type CuratedPlace = {
  id: string;
  place: string;
  domain: string;
  verdict: CurationVerdict;
  comment: string;
  updatedAt: string;
};

export type CurationArtifact = {
  format: "internet-commute-curation/v1";
  generatedAt: string;
  decisions: Array<{
    place: string;
    verdict: CurationVerdict;
    comment?: string;
  }>;
};

export type CommuteReviewItem = {
  id: string;
  domain: string;
  url?: string;
  title?: string;
  currentDisposition: "stop" | "scenery";
};

export type CommuteReviewResponse = {
  generatedAt: number;
  items: CommuteReviewItem[];
};

export type PublicPageInspection = {
  verdict: "public" | "gated" | "not_public" | "unavailable" | "unknown";
  reason: string;
  finalUrl: string;
};

export function parseCommuteReviewResponse(
  value: unknown,
): CommuteReviewResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The Commute review response is malformed.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.generatedAt !== "number" ||
    !Array.isArray(candidate.destinations) ||
    !Array.isArray(candidate.scenery)
  ) {
    throw new Error("The Commute review response is malformed.");
  }

  const destinations = candidate.destinations.filter(isCommuteDestination);
  const scenery = candidate.scenery.filter(isCommuteSceneryItem);
  if (
    destinations.length !== candidate.destinations.length ||
    scenery.length !== candidate.scenery.length
  ) {
    throw new Error("The Commute review response contains an invalid place.");
  }
  const destinationDomains = new Set(
    destinations.map((destination) => destination.domain),
  );
  return {
    generatedAt: candidate.generatedAt,
    items: [
      ...destinations.map((destination) => ({
        id: destination.url,
        domain: destination.domain,
        url: destination.url,
        ...(destination.title ? { title: destination.title } : {}),
        currentDisposition: "stop" as const,
      })),
      ...scenery
        .filter((item) => !destinationDomains.has(item.domain))
        .map((item) => ({
          id: item.domain,
          domain: item.domain,
          currentDisposition: "scenery" as const,
        })),
    ],
  };
}

export function getReviewTarget(item: CommuteReviewItem): string {
  return normalizePlace(item.url ?? item.domain).place;
}

export function normalizePlace(value: string): {
  place: string;
  domain: string;
} {
  const input = value.trim();
  if (!input) {
    throw new Error("Enter a domain or URL.");
  }

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;
  let url: URL;

  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Enter a valid public domain or URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS places can be reviewed.");
  }

  const domain = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!domain || !domain.includes(".")) {
    throw new Error("Enter a complete domain, such as example.com.");
  }

  url.hostname = domain;
  url.hash = "";
  const hasPageDetail = url.pathname !== "/" || url.search !== "";

  return {
    domain,
    place: hasPageDetail ? url.toString() : domain,
  };
}

export function createCuratedPlace({
  id,
  input,
  verdict,
  comment,
  updatedAt,
}: {
  id: string;
  input: string;
  verdict: CurationVerdict;
  comment: string;
  updatedAt: string;
}): CuratedPlace {
  const normalized = normalizePlace(input);

  return {
    id,
    ...normalized,
    verdict,
    comment: comment.trim(),
    updatedAt,
  };
}

export function upsertCuratedPlace(
  places: CuratedPlace[],
  place: CuratedPlace,
): CuratedPlace[] {
  const matchingIndex = places.findIndex(
    (candidate) => candidate.place === place.place,
  );
  if (matchingIndex === -1) {
    return [place, ...places];
  }

  return places.map((candidate, index) =>
    index === matchingIndex ? place : candidate,
  );
}

export function parseStoredCuration(value: string | null): CuratedPlace[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isCuratedPlace);
  } catch {
    return [];
  }
}

export function serializeCurationArtifact(
  places: CuratedPlace[],
  generatedAt: string,
): string {
  const verdictOrder = new Map(
    CURATION_VERDICTS.map((verdict, index) => [verdict, index]),
  );
  const decisions = [...places]
    .sort((a, b) => {
      const verdictDifference =
        (verdictOrder.get(a.verdict) ?? 0) - (verdictOrder.get(b.verdict) ?? 0);
      return verdictDifference || a.place.localeCompare(b.place);
    })
    .map(({ place, verdict, comment }) => ({
      place,
      verdict,
      ...(comment ? { comment } : {}),
    }));

  const artifact: CurationArtifact = {
    format: "internet-commute-curation/v1",
    generatedAt,
    decisions,
  };

  return JSON.stringify(artifact, null, 2);
}

function isCuratedPlace(value: unknown): value is CuratedPlace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.place === "string" &&
    typeof candidate.domain === "string" &&
    CURATION_VERDICTS.includes(candidate.verdict as CurationVerdict) &&
    typeof candidate.comment === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

type CommuteDestination = {
  domain: string;
  url: string;
  title?: string | null;
};

type CommuteSceneryItem = {
  domain: string;
};

function isCommuteDestination(value: unknown): value is CommuteDestination {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.domain === "string" &&
    typeof candidate.url === "string" &&
    (candidate.title === undefined ||
      candidate.title === null ||
      typeof candidate.title === "string")
  );
}

function isCommuteSceneryItem(value: unknown): value is CommuteSceneryItem {
  if (!value || typeof value !== "object") return false;
  return typeof (value as Record<string, unknown>).domain === "string";
}
