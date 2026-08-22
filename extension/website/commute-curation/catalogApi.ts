// ABOUTME: Calls the authenticated Internet place catalog endpoints from the curation desk.
// ABOUTME: Maps D1 policy and evaluation evidence responses into the desk's review model.

import { WORKER_URL } from "@movement/config";
import type {
  CatalogEvidenceItem,
  CommuteReviewItem,
  CuratedPlace,
  CurationPlacement,
  CurationScope,
  PublicPageInspection,
} from "./curation";
import type { ReserveMetadata } from "./reserveCatalog";

export type CatalogSnapshot = {
  policies: CuratedPlace[];
  evidence: CatalogEvidenceItem[];
};

export type CatalogSuggestion = {
  placement: CurationPlacement;
  scope: CurationScope;
  reason?: string;
  confidence: number;
  rationale: string;
  uncertainties: string[];
};

export type CatalogSuggestionResponse = {
  source: "cache" | "model";
  createdAt: string;
  suggestion: CatalogSuggestion;
};

export class CatalogApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CatalogApiError";
  }
}

const LOCAL_CATALOG_WORKER_URL = "http://127.0.0.1:8787";

export function resolveCatalogWorkerUrl(
  pageHostname: string | undefined,
  configuredUrl: string | undefined,
  defaultUrl = WORKER_URL,
): string {
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  if (
    pageHostname === "127.0.0.1" ||
    pageHostname === "localhost" ||
    pageHostname === "[::1]"
  ) {
    return LOCAL_CATALOG_WORKER_URL;
  }
  return defaultUrl.replace(/\/$/, "");
}

function catalogWorkerUrl(): string {
  return resolveCatalogWorkerUrl(
    typeof window === "undefined" ? undefined : window.location.hostname,
    import.meta.env.VITE_CATALOG_WORKER_URL,
  );
}

export function isCatalogUnauthorized(error: unknown): boolean {
  return error instanceof CatalogApiError && error.status === 401;
}

export async function readCatalogResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {}
    throw new CatalogApiError(
      message || `Request failed with ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

function headers(token: string, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export async function getCatalog(token: string): Promise<CatalogSnapshot> {
  const payload = await readCatalogResponse<{
    policies: Array<{
      scope: CurationScope;
      placeKey: string;
      placement?: CurationPlacement;
      reason?: string;
      note: string;
      updatedAt: string;
    }>;
    evidence: CatalogEvidenceItem[];
  }>(await fetch(`${catalogWorkerUrl()}/admin/internet-places`, {
    headers: headers(token),
  }));
  return {
    policies: payload.policies.map((policy) => ({
      id: `${policy.scope}:${policy.placeKey}`,
      place: policy.placeKey,
      domain: policy.scope === "page"
        ? new URL(policy.placeKey).hostname.replace(/^www\./, "")
        : policy.placeKey,
      scope: policy.scope,
      ...(policy.placement ? { placement: policy.placement } : {}),
      ...(policy.reason ? { reason: policy.reason } : {}),
      comment: policy.note,
      updatedAt: policy.updatedAt,
    })),
    evidence: payload.evidence,
  };
}

export async function saveCatalogPolicy(
  token: string,
  policy: CuratedPlace,
): Promise<CuratedPlace> {
  const payload = await readCatalogResponse<{
    policy: {
      scope: CurationScope;
      placeKey: string;
      placement?: CurationPlacement;
      reason?: string;
      note: string;
      updatedAt: string;
    };
  }>(await fetch(`${catalogWorkerUrl()}/admin/internet-places/policy`, {
    method: "PUT",
    headers: headers(token, true),
    body: JSON.stringify({
      scope: policy.scope,
      placeKey: policy.place,
      placement: policy.placement,
      reason: policy.reason,
      note: policy.comment,
    }),
  }));
  const saved = payload.policy;
  return {
    id: `${saved.scope}:${saved.placeKey}`,
    place: saved.placeKey,
    domain: saved.scope === "page"
      ? new URL(saved.placeKey).hostname.replace(/^www\./, "")
      : saved.placeKey,
    scope: saved.scope,
    ...(saved.placement ? { placement: saved.placement } : {}),
    ...(saved.reason ? { reason: saved.reason } : {}),
    comment: saved.note,
    updatedAt: saved.updatedAt,
  };
}

export async function getCatalogSuggestion({
  token,
  item,
  reserve,
  inspection,
  refresh = false,
}: {
  token: string;
  item: CommuteReviewItem;
  reserve?: ReserveMetadata;
  inspection?: PublicPageInspection;
  refresh?: boolean;
}): Promise<CatalogSuggestionResponse> {
  if (!item.url) {
    throw new Error("Suggestions require a public page URL.");
  }
  return readCatalogResponse(await fetch(
    `${catalogWorkerUrl()}/admin/internet-places/suggestion`,
    {
      method: "POST",
      headers: headers(token, true),
      body: JSON.stringify({
        candidate: {
          url: item.url,
          ...(item.title ? { title: item.title } : {}),
          ...(item.evidence ? { audit: item.evidence } : {}),
          ...(reserve ? {
            reserve: {
              sourceCollection: reserve.sourceCollection,
              sourceMode: reserve.sourceMode,
              tags: reserve.tags,
              interactionLevel: reserve.interactionLevel,
              ...(reserve.issue ? { issue: reserve.issue } : {}),
              ...(reserve.section ? { section: reserve.section } : {}),
            },
          } : {}),
          ...(inspection ? { inspection } : {}),
        },
        refresh,
      }),
    },
  ));
}

export async function deleteCatalogPolicy(
  token: string,
  policy: CuratedPlace,
): Promise<void> {
  const query = new URLSearchParams({
    scope: policy.scope,
    placeKey: policy.place,
  });
  await readCatalogResponse(await fetch(
    `${catalogWorkerUrl()}/admin/internet-places/policy?${query}`,
    { method: "DELETE", headers: headers(token) },
  ));
}

export async function importEvaluationArtifact(
  token: string,
  artifact: unknown,
): Promise<{ imported: number; generatedAt: string }> {
  return readCatalogResponse(await fetch(`${catalogWorkerUrl()}/admin/internet-places/evidence`, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify(artifact),
  }));
}
