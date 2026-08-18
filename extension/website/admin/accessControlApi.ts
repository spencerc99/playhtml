// ABOUTME: Client contract for WWO feature policy, cohort, and tester administration.
// ABOUTME: Validates individual and bulk public IDs before calling the Worker.

import { WORKER_URL } from "@movement/config";
import type { FeatureId, FeatureStage } from "../../shared/featureCatalog";

export type AccessFeature = {
  id: FeatureId;
  name: string;
  description: string;
  stage: FeatureStage;
};

export type AccessCohort = {
  id: string;
  name: string;
  grantsAllUnreleased: boolean;
  featureIds: FeatureId[];
};

export type AccessPerson = {
  publicId: string;
  email: string | null;
  addedAt: string;
  cohortIds: string[];
};

export type AccessRequest = {
  id: number;
  publicId: string;
  email: string | null;
  requestedFeatures: FeatureId[];
  createdAt: string;
};

export type AccessOverview = {
  features: AccessFeature[];
  cohorts: AccessCohort[];
  people: AccessPerson[];
  requests: AccessRequest[];
};

export type PersonInput = { publicId: string; email: string | null };

const PUBLIC_ID_PATTERN = /^pk_[0-9a-f]{130}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPublicId(publicId: string): boolean {
  return PUBLIC_ID_PATTERN.test(publicId.trim());
}

export function parsePersonInput(publicIdValue: string, emailValue: string): PersonInput {
  const publicId = publicIdValue.trim().toLowerCase();
  if (!isValidPublicId(publicId)) throw new Error("Enter a valid public ID");
  const email = emailValue.trim().toLowerCase() || null;
  if (email && !EMAIL_PATTERN.test(email)) throw new Error("Enter a valid email");
  return { publicId, email };
}

export function parsePeopleInput(value: string): PersonInput[] {
  const people = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawPublicId, rawEmail, ...extra] = line.split(/[\t,]/).map((part) => part.trim());
      if (extra.length > 0 || !isValidPublicId(rawPublicId)) {
        throw new Error(`Line ${index + 1} needs a valid public ID`);
      }
      const email = rawEmail || null;
      if (email && !EMAIL_PATTERN.test(email)) {
        throw new Error(`Line ${index + 1} has an invalid email`);
      }
      return { publicId: rawPublicId.toLowerCase(), email: email?.toLowerCase() ?? null };
    });
  const uniquePeople = new Map<string, PersonInput>();
  for (const person of people) {
    const existing = uniquePeople.get(person.publicId);
    uniquePeople.set(person.publicId, {
      publicId: person.publicId,
      email: person.email ?? existing?.email ?? null,
    });
  }
  return [...uniquePeople.values()];
}

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

function adminHeaders(token: string, json = false): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export async function getAccessOverview(token: string): Promise<AccessOverview> {
  return readResponse(await fetch(`${WORKER_URL}/admin/access-control`, {
    headers: adminHeaders(token),
  }));
}

export async function updateFeatureStage(
  token: string,
  featureId: FeatureId,
  stage: FeatureStage,
): Promise<void> {
  await readResponse(await fetch(
    `${WORKER_URL}/admin/access-control/features/${encodeURIComponent(featureId)}`,
    {
      method: "PUT",
      headers: adminHeaders(token, true),
      body: JSON.stringify({ stage }),
    },
  ));
}

export async function updateCohortFeatures(
  token: string,
  cohortId: string,
  featureIds: FeatureId[],
): Promise<void> {
  await readResponse(await fetch(
    `${WORKER_URL}/admin/access-control/cohorts/${encodeURIComponent(cohortId)}`,
    {
      method: "PUT",
      headers: adminHeaders(token, true),
      body: JSON.stringify({ featureIds }),
    },
  ));
}

export async function addPeople(
  token: string,
  cohortId: string,
  people: PersonInput[],
): Promise<void> {
  await readResponse(await fetch(`${WORKER_URL}/admin/access-control/people`, {
    method: "POST",
    headers: adminHeaders(token, true),
    body: JSON.stringify({ cohortId, people }),
  }));
}

export async function updatePersonCohorts(
  token: string,
  publicId: string,
  cohortIds: string[],
): Promise<void> {
  await readResponse(await fetch(
    `${WORKER_URL}/admin/access-control/people/${encodeURIComponent(publicId)}`,
    {
      method: "PUT",
      headers: adminHeaders(token, true),
      body: JSON.stringify({ cohortIds }),
    },
  ));
}

export async function reviewAccessRequest(
  token: string,
  requestId: number,
  decision: "approved" | "denied",
  cohortId?: string,
): Promise<void> {
  await readResponse(await fetch(
    `${WORKER_URL}/admin/access-control/requests/${requestId}`,
    {
      method: "PUT",
      headers: adminHeaders(token, true),
      body: JSON.stringify({ decision, cohortId }),
    },
  ));
}
