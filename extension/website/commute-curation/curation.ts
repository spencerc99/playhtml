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
