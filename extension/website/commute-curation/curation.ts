// ABOUTME: Defines Internet Commute curation decisions, evidence, and portable artifacts.
// ABOUTME: Normalizes page, hostname, and site identities consistently with the Worker catalog.

import {
  INTERNET_PLACE_VERDICTS,
  normalizeInternetPlace,
  type InternetPlaceScope,
  type InternetPlaceVerdict,
} from "../../shared/internetPlaceCatalog";

export const CURATION_STORAGE_KEY = "wwo-commute-curation-v1";

export const CURATION_VERDICTS = INTERNET_PLACE_VERDICTS;

export const CURATION_REASONS = [
  "authentication-required",
  "private-or-user-bound",
  "documentation-or-support",
  "jobs-or-recruiting",
  "generic-homepage",
  "business-or-product",
  "unsafe-or-low-quality",
  "human-community",
  "editorial-or-cultural",
  "standalone-tool",
  "inspection-error",
  "other",
] as const;

export type CurationVerdict = InternetPlaceVerdict;
export type CurationScope = InternetPlaceScope;
export type CurationReason = (typeof CURATION_REASONS)[number];

export type CuratedPlace = {
  id: string;
  place: string;
  domain: string;
  scope: CurationScope;
  verdict?: CurationVerdict;
  reason?: string;
  comment: string;
  updatedAt: string;
};

export type CurationArtifact = {
  format: "internet-commute-curation/v3";
  generatedAt: string;
  decisions: Array<{
    place: string;
    scope: CurationScope;
    verdict?: CurationVerdict;
    reason?: string;
    comment?: string;
  }>;
};

export type CommuteReviewItem = {
  id: string;
  domain: string;
  url?: string;
  title?: string;
  currentDisposition: "stop" | "scenery";
  evidence?: EvaluationEvidence;
  evidenceProvenance?: string;
  evidenceGeneratedAt?: string;
};

export type EvidenceLabel = {
  value: string;
  confidence: number;
  source: string;
  reasons: string[];
};

export type EvaluationEvidence = {
  category: EvidenceLabel;
  pageType: EvidenceLabel;
  exposure: EvidenceLabel;
  character: EvidenceLabel;
  observation: {
    visits: number;
    participants: number;
    sessions: number;
    screenTimeMs: number;
    firstSeen: string;
    lastSeen: string;
    domainParticipants: number;
    domainVisits: number;
    domainScreenTimeMs: number;
  };
  lanes: string[];
  components: Record<string, number | null>;
  scores: Record<string, number>;
  initialJudgment: EvidenceLabel;
  reasons: string[];
};

export type CatalogEvidenceItem = {
  url: string;
  domain: string;
  title: string;
  provenance: string;
  generatedAt: string;
  evidence: EvaluationEvidence;
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

export function mergeCatalogEvidence(
  liveItems: CommuteReviewItem[],
  evidenceItems: CatalogEvidenceItem[],
): CommuteReviewItem[] {
  const byUrl = new Map(
    evidenceItems.map((item) => [
      normalizeInternetPlace(item.url, "page"),
      item,
    ]),
  );
  const mergedLive = liveItems.map((item) => {
    if (!item.url) return item;
    const normalizedUrl = normalizeInternetPlace(item.url, "page");
    const evidence = byUrl.get(normalizedUrl);
    if (!evidence) return item;
    byUrl.delete(normalizedUrl);
    return {
      ...item,
      evidence: evidence.evidence,
      evidenceProvenance: evidence.provenance,
      evidenceGeneratedAt: evidence.generatedAt,
    };
  });
  const historical = [...byUrl.values()]
    .sort(
      (first, second) =>
        (second.evidence.scores.humanWeb ?? 0) -
        (first.evidence.scores.humanWeb ?? 0),
    )
    .map((item) => ({
      id: item.url,
      domain: item.domain,
      url: item.url,
      title: item.title,
      currentDisposition: "stop" as const,
      evidence: item.evidence,
      evidenceProvenance: item.provenance,
      evidenceGeneratedAt: item.generatedAt,
    }));
  return [...mergedLive, ...historical];
}

export function getReviewTarget(
  item: CommuteReviewItem,
  scope: CurationScope,
): string {
  return getScopedPlace(item.url ?? item.domain, scope).place;
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

export function getScopedPlace(
  value: string,
  scope: CurationScope,
): { place: string; domain: string } {
  const normalized = normalizePlace(value);
  return {
    place: normalizeInternetPlace(value, scope),
    domain: normalized.domain,
  };
}

export function getDecisionKey(scope: CurationScope, place: string): string {
  return `${scope}:${place}`;
}

export function getDecisionForReviewItem(
  places: CuratedPlace[],
  item: CommuteReviewItem,
): CuratedPlace | undefined {
  const scopes: CurationScope[] = item.url
    ? ["page", "hostname", "site"]
    : ["hostname", "site"];
  for (const scope of scopes) {
    const target = getReviewTarget(item, scope);
    const decision = places.find(
      (place) =>
        getDecisionKey(place.scope, place.place) ===
        getDecisionKey(scope, target),
    );
    if (decision) return decision;
  }
  return undefined;
}

export function createCuratedPlace({
  id,
  input,
  scope,
  verdict,
  reason,
  comment,
  updatedAt,
}: {
  id: string;
  input: string;
  scope: CurationScope;
  verdict?: CurationVerdict;
  reason?: string;
  comment: string;
  updatedAt: string;
}): CuratedPlace {
  const normalized = getScopedPlace(input, scope);

  return {
    id,
    ...normalized,
    scope,
    verdict,
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
    comment: comment.trim(),
    updatedAt,
  };
}

export function upsertCuratedPlace(
  places: CuratedPlace[],
  place: CuratedPlace,
): CuratedPlace[] {
  const matchingIndex = places.findIndex(
    (candidate) =>
      getDecisionKey(candidate.scope, candidate.place) ===
      getDecisionKey(place.scope, place.place),
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

    return parsed.flatMap((value) => migrateCuratedPlace(value));
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
        (a.verdict === undefined
          ? CURATION_VERDICTS.length
          : (verdictOrder.get(a.verdict) ?? 0)) -
        (b.verdict === undefined
          ? CURATION_VERDICTS.length
          : (verdictOrder.get(b.verdict) ?? 0));
      return verdictDifference || a.place.localeCompare(b.place);
    })
    .map(({ place, scope, verdict, reason, comment }) => ({
      place,
      scope,
      ...(verdict ? { verdict } : {}),
      ...(reason ? { reason } : {}),
      ...(comment ? { comment } : {}),
    }));

  const artifact: CurationArtifact = {
    format: "internet-commute-curation/v3",
    generatedAt,
    decisions,
  };

  return JSON.stringify(artifact, null, 2);
}

function migrateCuratedPlace(value: unknown): CuratedPlace[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as Record<string, unknown>;
  const isStoredPlace =
    typeof candidate.id === "string" &&
    typeof candidate.place === "string" &&
    typeof candidate.domain === "string" &&
    (candidate.verdict === undefined ||
      CURATION_VERDICTS.includes(candidate.verdict as CurationVerdict)) &&
    typeof candidate.comment === "string" &&
    typeof candidate.updatedAt === "string";
  if (!isStoredPlace || (candidate.verdict === undefined && !candidate.comment)) {
    return [];
  }

  const scope: CurationScope =
    candidate.scope === "page" ||
    candidate.scope === "hostname" ||
    candidate.scope === "site"
      ? candidate.scope
      : "hostname";
  const normalized = getScopedPlace(candidate.place, scope);
  return [
    {
      id: candidate.id as string,
      ...normalized,
      scope,
      ...(candidate.verdict
        ? { verdict: candidate.verdict as CurationVerdict }
        : {}),
      ...(typeof candidate.reason === "string" && candidate.reason
        ? { reason: candidate.reason }
        : {}),
      comment: candidate.comment as string,
      updatedAt: candidate.updatedAt as string,
    },
  ];
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
