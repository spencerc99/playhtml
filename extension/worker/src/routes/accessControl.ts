// ABOUTME: Resolves feature entitlements and administers WWO cohorts in D1.
// ABOUTME: Supports dashboard policy changes, bulk membership, and beta access requests.

import {
  FEATURE_CATALOG,
  FEATURE_IDS,
  isFeatureId,
  isFeatureStage,
  type FeatureAccessSnapshot,
  type FeatureId,
  type FeatureStage,
} from '../../../shared/featureCatalog';
import { getAdminAuthError } from '../lib/adminAuth';
import { createIpRateLimiter } from '../lib/ipRateLimit';
import type { Env } from '../lib/supabase';

const PUBLIC_ID_PATTERN = /^pk_[0-9a-f]{130}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestRateLimiter = createIpRateLimiter(5, 60_000);

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

type FeatureRow = {
  feature_id: string;
  name: string;
  description: string;
  stage: string;
};

type CohortRow = {
  cohort_id: string;
  name: string;
  grants_all_unreleased: number;
};

type CohortFeatureRow = {
  cohort_id: string;
  feature_id: string;
};

type PersonRow = {
  public_id: string;
  email: string | null;
  created_at: string;
};

type MembershipRow = {
  public_id: string;
  cohort_id: string;
};

type AccessRequestRow = {
  request_id: number;
  public_id: string;
  email: string | null;
  requested_features: string;
  status: string;
  created_at: string;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizePublicId(publicId: string): string {
  return publicId.trim().toLowerCase();
}

function isValidPublicId(publicId: string): boolean {
  return PUBLIC_ID_PATTERN.test(publicId);
}

function parseBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return parseBody(await request.json());
  } catch {
    return null;
  }
}

async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results;
}

async function ensureFeatureCatalog(db: D1Database): Promise<void> {
  await db.batch(
    FEATURE_IDS.map((featureId) => {
      const feature = FEATURE_CATALOG[featureId];
      return db.prepare(
        `INSERT INTO features (feature_id, name, description, stage)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(feature_id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description`,
      ).bind(
        featureId,
        feature.name,
        feature.description,
        feature.defaultStage,
      );
    }),
  );
}

async function cohortExists(db: D1Database, cohortId: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT cohort_id FROM cohorts WHERE cohort_id = ?',
  ).bind(cohortId).first<{ cohort_id: string }>();
  return row !== null;
}

export async function handleFeatureAccessCheck(
  env: Env,
  requestedPublicId: string,
): Promise<Response> {
  const publicId = normalizePublicId(requestedPublicId);
  if (!isValidPublicId(publicId)) {
    return jsonResponse(400, { error: 'Invalid public ID' });
  }

  const rows = await allRows<FeatureRow & { available: number }>(
    env.WWO_ADMIN_DB.prepare(
      `SELECT
         f.feature_id,
         f.name,
         f.description,
         f.stage,
         CASE
           WHEN f.stage IN ('released', 'lab') THEN 1
           WHEN EXISTS (
             SELECT 1
             FROM cohort_memberships cm
             JOIN cohorts c ON c.cohort_id = cm.cohort_id
             LEFT JOIN cohort_features cf
               ON cf.cohort_id = c.cohort_id
              AND cf.feature_id = f.feature_id
             WHERE cm.public_id = ?
               AND (c.grants_all_unreleased = 1 OR cf.feature_id IS NOT NULL)
           ) THEN 1
           ELSE 0
         END AS available
       FROM features f`,
    ).bind(publicId),
  );

  const features = Object.fromEntries(
    FEATURE_IDS.map((featureId) => {
      const row = rows.find((candidate) => candidate.feature_id === featureId);
      const stage = row && isFeatureStage(row.stage)
        ? row.stage
        : FEATURE_CATALOG[featureId].defaultStage;
      return [
        featureId,
        {
          stage,
          available: stage === 'released' || stage === 'lab' || row?.available === 1,
        },
      ];
    }),
  ) as FeatureAccessSnapshot['features'];

  return jsonResponse(200, { features });
}

export async function handleAdminAccessOverview(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  await ensureFeatureCatalog(env.WWO_ADMIN_DB);
  const [featureRows, cohortRows, cohortFeatureRows, personRows, membershipRows, requestRows] =
    await Promise.all([
      allRows<FeatureRow>(env.WWO_ADMIN_DB.prepare(
        'SELECT feature_id, name, description, stage FROM features ORDER BY name',
      )),
      allRows<CohortRow>(env.WWO_ADMIN_DB.prepare(
        'SELECT cohort_id, name, grants_all_unreleased FROM cohorts ORDER BY name',
      )),
      allRows<CohortFeatureRow>(env.WWO_ADMIN_DB.prepare(
        'SELECT cohort_id, feature_id FROM cohort_features ORDER BY cohort_id, feature_id',
      )),
      allRows<PersonRow>(env.WWO_ADMIN_DB.prepare(
        'SELECT public_id, email, created_at FROM people ORDER BY created_at DESC',
      )),
      allRows<MembershipRow>(env.WWO_ADMIN_DB.prepare(
        'SELECT public_id, cohort_id FROM cohort_memberships ORDER BY cohort_id',
      )),
      allRows<AccessRequestRow>(env.WWO_ADMIN_DB.prepare(
        `SELECT request_id, public_id, email, requested_features, status, created_at
         FROM access_requests
         WHERE status = 'pending'
         ORDER BY created_at DESC`,
      )),
    ]);

  return jsonResponse(200, {
    features: featureRows
      .filter((row) => isFeatureId(row.feature_id) && isFeatureStage(row.stage))
      .map((row) => ({
        id: row.feature_id,
        name: row.name,
        description: row.description,
        stage: row.stage,
      })),
    cohorts: cohortRows.map((row) => ({
      id: row.cohort_id,
      name: row.name,
      grantsAllUnreleased: row.grants_all_unreleased === 1,
      featureIds: cohortFeatureRows
        .filter(
          (grant) => grant.cohort_id === row.cohort_id && isFeatureId(grant.feature_id),
        )
        .map((grant) => grant.feature_id),
    })),
    people: personRows.map((row) => ({
      publicId: row.public_id,
      email: row.email,
      addedAt: row.created_at,
      cohortIds: membershipRows
        .filter((membership) => membership.public_id === row.public_id)
        .map((membership) => membership.cohort_id),
    })),
    requests: requestRows.map((row) => ({
      id: row.request_id,
      publicId: row.public_id,
      email: row.email,
      requestedFeatures: JSON.parse(row.requested_features) as string[],
      createdAt: row.created_at,
    })),
  });
}

export async function handleAdminFeatureStageUpdate(
  request: Request,
  env: Env,
  featureId: string,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  if (!isFeatureId(featureId)) return jsonResponse(404, { error: 'Unknown feature' });

  const body = await readJsonBody(request);
  const stage = body?.stage;
  if (typeof stage !== 'string' || !isFeatureStage(stage)) {
    return jsonResponse(400, { error: 'Invalid feature stage' });
  }

  await ensureFeatureCatalog(env.WWO_ADMIN_DB);
  await env.WWO_ADMIN_DB.prepare(
    'UPDATE features SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE feature_id = ?',
  ).bind(stage, featureId).run();
  return jsonResponse(200, { id: featureId, stage });
}

export async function handleAdminCohortFeaturesUpdate(
  request: Request,
  env: Env,
  cohortId: string,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  if (!(await cohortExists(env.WWO_ADMIN_DB, cohortId))) {
    return jsonResponse(404, { error: 'Unknown cohort' });
  }

  const body = await readJsonBody(request);
  const requestedFeatureIds = body?.featureIds;
  if (
    !Array.isArray(requestedFeatureIds) ||
    requestedFeatureIds.some((value) => typeof value !== 'string' || !isFeatureId(value))
  ) {
    return jsonResponse(400, { error: 'Invalid cohort features' });
  }

  const featureIds = [...new Set(requestedFeatureIds as FeatureId[])];
  await env.WWO_ADMIN_DB.batch([
    env.WWO_ADMIN_DB.prepare('DELETE FROM cohort_features WHERE cohort_id = ?').bind(cohortId),
    ...featureIds.map((featureId) => env.WWO_ADMIN_DB.prepare(
      'INSERT INTO cohort_features (cohort_id, feature_id) VALUES (?, ?)',
    ).bind(cohortId, featureId)),
  ]);
  return jsonResponse(200, { id: cohortId, featureIds });
}

type PersonInput = { publicId: string; email: string | null };

function parsePeople(value: unknown): PersonInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;
  const people: PersonInput[] = [];
  for (const entry of value) {
    const body = parseBody(entry);
    if (!body || typeof body.publicId !== 'string') return null;
    const publicId = normalizePublicId(body.publicId);
    if (!isValidPublicId(publicId)) return null;
    const email = typeof body.email === 'string' && body.email.trim()
      ? body.email.trim().toLowerCase()
      : null;
    if (email && !EMAIL_PATTERN.test(email)) return null;
    people.push({ publicId, email });
  }
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

export async function handleAdminPeopleAdd(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  const body = await readJsonBody(request);
  const cohortId = body?.cohortId;
  const people = parsePeople(body?.people);
  if (typeof cohortId !== 'string' || !people) {
    return jsonResponse(400, { error: 'Invalid people or cohort' });
  }
  if (!(await cohortExists(env.WWO_ADMIN_DB, cohortId))) {
    return jsonResponse(404, { error: 'Unknown cohort' });
  }

  await env.WWO_ADMIN_DB.batch(
    people.flatMap((person) => [
      env.WWO_ADMIN_DB.prepare(
        `INSERT INTO people (public_id, email) VALUES (?, ?)
         ON CONFLICT(public_id) DO UPDATE SET email = COALESCE(excluded.email, people.email)`,
      ).bind(person.publicId, person.email),
      env.WWO_ADMIN_DB.prepare(
        'INSERT OR IGNORE INTO cohort_memberships (public_id, cohort_id) VALUES (?, ?)',
      ).bind(person.publicId, cohortId),
    ]),
  );

  return jsonResponse(201, { added: people.length, cohortId });
}

export async function handleAdminPersonCohortsUpdate(
  request: Request,
  env: Env,
  requestedPublicId: string,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  const publicId = normalizePublicId(requestedPublicId);
  if (!isValidPublicId(publicId)) return jsonResponse(400, { error: 'Invalid public ID' });
  const body = await readJsonBody(request);
  const cohortIds = body?.cohortIds;
  if (!Array.isArray(cohortIds) || cohortIds.some((id) => typeof id !== 'string')) {
    return jsonResponse(400, { error: 'Invalid cohorts' });
  }
  const uniqueCohortIds = [...new Set(cohortIds as string[])];
  const existing = await allRows<{ cohort_id: string }>(env.WWO_ADMIN_DB.prepare(
    `SELECT cohort_id FROM cohorts WHERE cohort_id IN (${uniqueCohortIds.map(() => '?').join(',') || "''"})`,
  ).bind(...uniqueCohortIds));
  if (existing.length !== uniqueCohortIds.length) {
    return jsonResponse(400, { error: 'Unknown cohort' });
  }

  const statements = [
    env.WWO_ADMIN_DB.prepare('DELETE FROM cohort_memberships WHERE public_id = ?').bind(publicId),
    ...uniqueCohortIds.map((cohortId) => env.WWO_ADMIN_DB.prepare(
      'INSERT INTO cohort_memberships (public_id, cohort_id) VALUES (?, ?)',
    ).bind(publicId, cohortId)),
  ];
  if (uniqueCohortIds.length === 0) {
    statements.push(
      env.WWO_ADMIN_DB.prepare('DELETE FROM people WHERE public_id = ?').bind(publicId),
    );
  }
  await env.WWO_ADMIN_DB.batch(statements);
  return jsonResponse(200, { publicId, cohortIds: uniqueCohortIds });
}

export async function handleAccessRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (requestRateLimiter.isLimited(ip, Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  const body = await readJsonBody(request);
  const publicId = typeof body?.publicId === 'string'
    ? normalizePublicId(body.publicId)
    : '';
  const email = typeof body?.email === 'string' && body.email.trim()
    ? body.email.trim().toLowerCase()
    : null;
  const requestedFeatures = Array.isArray(body?.requestedFeatures)
    ? [...new Set(body.requestedFeatures)]
    : [];
  if (
    !isValidPublicId(publicId) ||
    (email !== null && !EMAIL_PATTERN.test(email)) ||
    requestedFeatures.some((feature) => typeof feature !== 'string' || !isFeatureId(feature))
  ) {
    return jsonResponse(400, { error: 'Invalid access request' });
  }

  const existing = await env.WWO_ADMIN_DB.prepare(
    `SELECT request_id FROM access_requests
     WHERE public_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(publicId).first<{ request_id: number }>();
  if (existing) {
    await env.WWO_ADMIN_DB.prepare(
      `UPDATE access_requests
       SET email = COALESCE(?, email), requested_features = ?
       WHERE request_id = ?`,
    ).bind(email, JSON.stringify(requestedFeatures), existing.request_id).run();
    return jsonResponse(200, { id: existing.request_id, status: 'pending' });
  }

  const result = await env.WWO_ADMIN_DB.prepare(
    `INSERT INTO access_requests (public_id, email, requested_features)
     VALUES (?, ?, ?)
     RETURNING request_id`,
  ).bind(publicId, email, JSON.stringify(requestedFeatures)).first<{ request_id: number }>();
  return jsonResponse(201, { id: result?.request_id, status: 'pending' });
}

export async function handleAdminAccessRequestReview(
  request: Request,
  env: Env,
  requestId: number,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return jsonResponse(400, { error: 'Invalid request ID' });
  }
  const body = await readJsonBody(request);
  const decision = body?.decision;
  if (decision !== 'approved' && decision !== 'denied') {
    return jsonResponse(400, { error: 'Invalid decision' });
  }
  const cohortId = body?.cohortId;
  if (decision === 'approved' && (
    typeof cohortId !== 'string' || !(await cohortExists(env.WWO_ADMIN_DB, cohortId))
  )) {
    return jsonResponse(400, { error: 'Invalid cohort' });
  }

  const accessRequest = await env.WWO_ADMIN_DB.prepare(
    `SELECT public_id, email FROM access_requests
     WHERE request_id = ? AND status = 'pending'`,
  ).bind(requestId).first<{ public_id: string; email: string | null }>();
  if (!accessRequest) return jsonResponse(404, { error: 'Pending request not found' });

  const statements = [env.WWO_ADMIN_DB.prepare(
    `UPDATE access_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE request_id = ?`,
  ).bind(decision, requestId)];
  if (decision === 'approved') {
    statements.unshift(
      env.WWO_ADMIN_DB.prepare(
        `INSERT INTO people (public_id, email) VALUES (?, ?)
         ON CONFLICT(public_id) DO UPDATE SET email = COALESCE(excluded.email, people.email)`,
      ).bind(accessRequest.public_id, accessRequest.email),
      env.WWO_ADMIN_DB.prepare(
        'INSERT OR IGNORE INTO cohort_memberships (public_id, cohort_id) VALUES (?, ?)',
      ).bind(accessRequest.public_id, cohortId),
    );
  }
  await env.WWO_ADMIN_DB.batch(statements);
  return jsonResponse(200, { id: requestId, status: decision });
}

export function __resetAccessRequestRateLimitForTests(): void {
  requestRateLimiter.reset();
}
