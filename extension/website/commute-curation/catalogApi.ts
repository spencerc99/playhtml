// ABOUTME: Calls the authenticated Internet place catalog endpoints from the curation desk.
// ABOUTME: Maps D1 policy and evaluation evidence responses into the desk's review model.

import { WORKER_URL } from "@movement/config";
import type {
  CatalogEvidenceItem,
  CuratedPlace,
  CurationScope,
  CurationVerdict,
} from "./curation";

export type CatalogSnapshot = {
  policies: CuratedPlace[];
  evidence: CatalogEvidenceItem[];
};

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {}
    throw new Error(message || `Request failed with ${response.status}`);
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
  const payload = await readResponse<{
    policies: Array<{
      scope: CurationScope;
      placeKey: string;
      verdict?: CurationVerdict;
      reason?: string;
      note: string;
      updatedAt: string;
    }>;
    evidence: CatalogEvidenceItem[];
  }>(await fetch(`${WORKER_URL}/admin/internet-places`, {
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
      ...(policy.verdict ? { verdict: policy.verdict } : {}),
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
  const payload = await readResponse<{
    policy: {
      scope: CurationScope;
      placeKey: string;
      verdict?: CurationVerdict;
      reason?: string;
      note: string;
      updatedAt: string;
    };
  }>(await fetch(`${WORKER_URL}/admin/internet-places/policy`, {
    method: "PUT",
    headers: headers(token, true),
    body: JSON.stringify({
      scope: policy.scope,
      placeKey: policy.place,
      verdict: policy.verdict,
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
    ...(saved.verdict ? { verdict: saved.verdict } : {}),
    ...(saved.reason ? { reason: saved.reason } : {}),
    comment: saved.note,
    updatedAt: saved.updatedAt,
  };
}

export async function deleteCatalogPolicy(
  token: string,
  policy: CuratedPlace,
): Promise<void> {
  const query = new URLSearchParams({
    scope: policy.scope,
    placeKey: policy.place,
  });
  await readResponse(await fetch(
    `${WORKER_URL}/admin/internet-places/policy?${query}`,
    { method: "DELETE", headers: headers(token) },
  ));
}

export async function importEvaluationArtifact(
  token: string,
  artifact: unknown,
): Promise<{ imported: number; generatedAt: string }> {
  return readResponse(await fetch(`${WORKER_URL}/admin/internet-places/evidence`, {
    method: "POST",
    headers: headers(token, true),
    body: JSON.stringify(artifact),
  }));
}
