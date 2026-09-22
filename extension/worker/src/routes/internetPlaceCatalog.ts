// ABOUTME: Persists Internet place policies and imported public-page evidence in D1.
// ABOUTME: Applies human decisions to safe Commute candidates without trusting machine suggestions.

import type { CommuteResponse } from '@playhtml/extension-types';
import {
  getInternetPlaceLookupKeys,
  getInternetPlacePolicyKey,
  INTERNET_PLACE_SCOPES,
  INTERNET_PLACE_PLACEMENTS,
  normalizeInternetPlace,
  resolveInternetPlacePolicy,
  type InternetPlacePolicy,
  type InternetPlaceScope,
  type InternetPlacePlacement,
} from '../../../shared/internetPlaceCatalog';
import { getAdminAuthError } from '../lib/adminAuth';
import type { Env } from '../lib/supabase';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};
const MAX_IMPORT_CANDIDATES = 1_000;
const MAX_IMPORT_BYTES = 8_000_000;
const IMPORT_ROWS_PER_BATCH = 50;

type PolicyRow = {
  scope: InternetPlaceScope;
  place_key: string;
  placement: InternetPlacePlacement | null;
  reason: string | null;
  note: string;
  updated_at: string;
};

type EvidenceRow = {
  canonical_url: string;
  hostname: string;
  title: string;
  provenance: string;
  generated_at: string;
  evidence_json: string;
};

type ImportedEvidence = {
  category: unknown;
  pageType: unknown;
  exposure: unknown;
  character: unknown;
  observation: unknown;
  lanes: unknown;
  components: unknown;
  scores: unknown;
  initialJudgment: unknown;
  reasons: unknown;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown, maxLength = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isEvidenceLabel(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.value, 100) &&
    isFiniteNumber(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isBoundedString(value.source, 100) &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => isBoundedString(reason, 500))
  );
}

function isObservation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    ['visits', 'participants', 'sessions', 'screenTimeMs', 'domainParticipants', 'domainVisits', 'domainScreenTimeMs']
      .every((key) => isFiniteNumber(value[key]) && value[key] >= 0) &&
    isBoundedString(value.firstSeen, 100) &&
    isBoundedString(value.lastSeen, 100)
  );
}

function isNumberRecord(
  value: unknown,
  keys: string[],
  nullableKeys: string[] = [],
): boolean {
  if (!isRecord(value)) return false;
  return keys.every(
    (key) =>
      isFiniteNumber(value[key]) ||
      (nullableKeys.includes(key) && value[key] === null),
  );
}

function parseEvidenceCandidate(
  value: unknown,
  generatedAt: string,
  provenance: string,
): {
  pageKey: string;
  canonicalUrl: string;
  hostname: string;
  title: string;
  generatedAt: string;
  provenance: string;
  evidenceJson: string;
} | null {
  if (!isRecord(value) || !isBoundedString(value.url, 2_000)) return null;
  if (!isBoundedString(value.title, 500) || !isBoundedString(value.domain, 255)) {
    return null;
  }
  const evidence: ImportedEvidence = {
    category: value.category,
    pageType: value.pageType,
    exposure: value.exposure,
    character: value.character,
    observation: value.observation,
    lanes: value.lanes,
    components: value.components,
    scores: value.scores,
    initialJudgment: value.initialJudgment,
    reasons: value.reasons,
  };
  if (
    !isEvidenceLabel(evidence.category) ||
    !isEvidenceLabel(evidence.pageType) ||
    !isEvidenceLabel(evidence.exposure) ||
    !isEvidenceLabel(evidence.character) ||
    !isEvidenceLabel(evidence.initialJudgment) ||
    !isObservation(evidence.observation) ||
    !Array.isArray(evidence.lanes) ||
    !evidence.lanes.every((lane) => isBoundedString(lane, 100)) ||
    !Array.isArray(evidence.reasons) ||
    !evidence.reasons.every((reason) => isBoundedString(reason, 500)) ||
    !isNumberRecord(
      evidence.components,
      [
        'pageRarity',
        'domainRarity',
        'externalRarity',
        'attentionQuality',
        'convergence',
        'specificity',
        'humanConfidence',
        'evidenceConfidence',
        'freshness',
        'manipulationPenalty',
      ],
      ['externalRarity'],
    ) ||
    !isNumberRecord(evidence.scores, [
      'balanced',
      'longTail',
      'hiddenPlatform',
      'humanWeb',
    ])
  ) {
    return null;
  }
  if ((evidence.exposure as { value: string }).value !== 'Public') return null;

  try {
    const canonicalUrl = normalizeInternetPlace(value.url, 'page');
    const hostname = normalizeInternetPlace(value.url, 'hostname');
    const artifactDomain = normalizeInternetPlace(value.domain, 'hostname');
    const site = normalizeInternetPlace(value.url, 'site');
    if (artifactDomain !== hostname && artifactDomain !== site) return null;
    return {
      pageKey: canonicalUrl,
      canonicalUrl,
      hostname,
      title: value.title,
      generatedAt,
      provenance,
      evidenceJson: JSON.stringify(evidence),
    };
  } catch {
    return null;
  }
}

function policyFromRow(row: PolicyRow): InternetPlacePolicy {
  return {
    scope: row.scope,
    placeKey: row.place_key,
    ...(row.placement ? { placement: row.placement } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    note: row.note,
    updatedAt: row.updated_at,
  };
}

async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

export async function handleInternetPlaceCatalog(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  const [policyRows, evidenceRows] = await Promise.all([
    allRows<PolicyRow>(env.WWO_ADMIN_DB.prepare(
      `SELECT scope, place_key, placement, reason, note, updated_at
       FROM place_policies
       ORDER BY updated_at DESC`,
    )),
    allRows<EvidenceRow>(env.WWO_ADMIN_DB.prepare(
      `SELECT canonical_url, hostname, title, provenance, generated_at, evidence_json
       FROM place_evidence
       ORDER BY generated_at DESC, hostname, canonical_url`,
    )),
  ]);

  return jsonResponse(200, {
    policies: policyRows.map(policyFromRow),
    evidence: evidenceRows.map((row) => ({
      url: row.canonical_url,
      domain: row.hostname,
      title: row.title,
      provenance: row.provenance,
      generatedAt: row.generated_at,
      evidence: JSON.parse(row.evidence_json) as unknown,
    })),
  });
}

export async function handleInternetPlaceEvidenceImport(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
      return jsonResponse(413, { error: 'Evaluation artifact is too large' });
    }
    body = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  if (!isRecord(body) || body.version !== 2 || !isRecord(body.summary)) {
    return jsonResponse(400, { error: 'Invalid evaluation artifact' });
  }
  const generatedAt = body.summary.generatedAt;
  const sourceArchive = body.summary.sourceArchive;
  if (
    !isBoundedString(generatedAt, 100) ||
    !isBoundedString(sourceArchive, 500) ||
    !Array.isArray(body.candidates) ||
    body.candidates.length > MAX_IMPORT_CANDIDATES
  ) {
    return jsonResponse(400, { error: 'Invalid evaluation artifact' });
  }
  const provenance = `commute-history-audit/v2:${sourceArchive}`;
  const rows = body.candidates.map((candidate) =>
    parseEvidenceCandidate(candidate, generatedAt, provenance),
  );
  if (rows.some((row) => row === null)) {
    return jsonResponse(400, { error: 'Evaluation artifact contains an invalid candidate' });
  }
  const validRows = rows.filter((row): row is NonNullable<typeof row> => row !== null);

  for (let index = 0; index < validRows.length; index += IMPORT_ROWS_PER_BATCH) {
    await env.WWO_ADMIN_DB.batch(
      validRows.slice(index, index + IMPORT_ROWS_PER_BATCH).map((row) =>
        env.WWO_ADMIN_DB.prepare(
          `INSERT INTO place_evidence (
             page_key, canonical_url, hostname, title, provenance,
             generated_at, evidence_json, imported_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(page_key) DO UPDATE SET
             canonical_url = excluded.canonical_url,
             hostname = excluded.hostname,
             title = excluded.title,
             provenance = excluded.provenance,
             generated_at = excluded.generated_at,
             evidence_json = excluded.evidence_json,
             imported_at = CURRENT_TIMESTAMP`,
        ).bind(
          row.pageKey,
          row.canonicalUrl,
          row.hostname,
          row.title,
          row.provenance,
          row.generatedAt,
          row.evidenceJson,
        ),
      ),
    );
  }

  return jsonResponse(200, { imported: validRows.length, generatedAt });
}

export async function handleInternetPlacePolicyPut(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  if (!isRecord(body) || !INTERNET_PLACE_SCOPES.includes(body.scope as InternetPlaceScope)) {
    return jsonResponse(400, { error: 'Invalid policy scope' });
  }
  const scope = body.scope as InternetPlaceScope;
  const placement = body.placement;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (
    (placement !== undefined &&
      !INTERNET_PLACE_PLACEMENTS.includes(
        placement as InternetPlacePlacement,
      )) ||
    (!placement && !note) ||
    note.length > 2_000 ||
    reason.length > 100 ||
    typeof body.placeKey !== 'string'
  ) {
    return jsonResponse(400, { error: 'Invalid place policy' });
  }

  let placeKey: string;
  try {
    placeKey = normalizeInternetPlace(body.placeKey, scope);
  } catch {
    return jsonResponse(400, { error: 'Invalid place policy target' });
  }
  let previous: { scope: InternetPlaceScope; placeKey: string } | undefined;
  if (body.previous !== undefined) {
    if (!isRecord(body.previous) ||
      !INTERNET_PLACE_SCOPES.includes(body.previous.scope as InternetPlaceScope) ||
      typeof body.previous.placeKey !== 'string') {
      return jsonResponse(400, { error: 'Invalid previous policy target' });
    }
    try {
      const previousScope = body.previous.scope as InternetPlaceScope;
      previous = { scope: previousScope, placeKey: normalizeInternetPlace(body.previous.placeKey, previousScope) };
    } catch {
      return jsonResponse(400, { error: 'Invalid previous policy target' });
    }
  }
  const writes = [env.WWO_ADMIN_DB.prepare(
    `INSERT INTO place_policies (scope, place_key, placement, reason, note, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(scope, place_key) DO UPDATE SET
       placement = excluded.placement,
       reason = excluded.reason,
       note = excluded.note,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(scope, placeKey, placement ?? null, reason || null, note)];
  if (previous && (previous.scope !== scope || previous.placeKey !== placeKey)) {
    writes.push(env.WWO_ADMIN_DB.prepare(
      'DELETE FROM place_policies WHERE scope = ? AND place_key = ?',
    ).bind(previous.scope, previous.placeKey));
  }
  await env.WWO_ADMIN_DB.batch(writes);

  const row = await env.WWO_ADMIN_DB.prepare(
    `SELECT scope, place_key, placement, reason, note, updated_at
     FROM place_policies WHERE scope = ? AND place_key = ?`,
  ).bind(scope, placeKey).first<PolicyRow>();
  if (!row) return jsonResponse(500, { error: 'Policy was not saved' });
  return jsonResponse(200, { policy: policyFromRow(row) });
}

export async function handleInternetPlacePolicyDelete(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = getAdminAuthError(request, env.ADMIN_KEY);
  if (authError) return authError;
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  const rawPlaceKey = url.searchParams.get('placeKey');
  if (
    !rawPlaceKey ||
    !scope ||
    !INTERNET_PLACE_SCOPES.includes(scope as InternetPlaceScope)
  ) {
    return jsonResponse(400, { error: 'Invalid place policy target' });
  }
  let placeKey: string;
  try {
    placeKey = normalizeInternetPlace(rawPlaceKey, scope as InternetPlaceScope);
  } catch {
    return jsonResponse(400, { error: 'Invalid place policy target' });
  }
  await env.WWO_ADMIN_DB.prepare(
    'DELETE FROM place_policies WHERE scope = ? AND place_key = ?',
  ).bind(scope, placeKey).run();
  return jsonResponse(200, { deleted: true });
}

function uniqueLookupPairs(response: CommuteResponse): Array<{
  scope: InternetPlaceScope;
  placeKey: string;
}> {
  const lookups = new Map<string, { scope: InternetPlaceScope; placeKey: string }>();
  for (const destination of response.destinations) {
    for (const lookup of getInternetPlaceLookupKeys(destination.url)) {
      lookups.set(getInternetPlacePolicyKey(lookup.scope, lookup.placeKey), lookup);
    }
  }
  for (const item of response.scenery) {
    for (const scope of ['hostname', 'site'] as const) {
      const placeKey = normalizeInternetPlace(item.domain, scope);
      lookups.set(getInternetPlacePolicyKey(scope, placeKey), { scope, placeKey });
    }
  }
  return [...lookups.values()];
}

export async function loadInternetPlacePolicies(
  db: D1Database,
  response: CommuteResponse,
): Promise<InternetPlacePolicy[]> {
  const lookups = uniqueLookupPairs(response);
  if (lookups.length === 0) return [];
  const rows = await allRows<PolicyRow>(db.prepare(
    `WITH requested AS (
       SELECT
         json_extract(value, '$.scope') AS scope,
         json_extract(value, '$.placeKey') AS place_key
       FROM json_each(?)
     )
     SELECT p.scope, p.place_key, p.placement, p.reason, p.note, p.updated_at
     FROM place_policies p
     INNER JOIN requested r
       ON r.scope = p.scope AND r.place_key = p.place_key`,
  ).bind(JSON.stringify(lookups)));
  return rows.map(policyFromRow);
}

export function applyInternetPlacePolicies(
  response: CommuteResponse,
  policies: InternetPlacePolicy[],
  destinationLimit: number,
): CommuteResponse {
  const runtimePolicies = policies.filter((policy) => policy.placement);
  const domainPolicies = runtimePolicies.filter(
    (policy) => policy.scope !== 'page',
  );
  const reserve: CommuteResponse['destinations'] = [];
  const featured: CommuteResponse['destinations'] = [];
  const ordinary: CommuteResponse['destinations'] = [];

  for (const destination of response.destinations) {
    const policy = resolveInternetPlacePolicy(runtimePolicies, destination.url);
    if (policy?.placement === 'hidden' || policy?.placement === 'scenery') {
      continue;
    }
    if (policy?.placement === 'reserve') {
      reserve.push(destination);
    } else if (policy?.placement === 'featured') {
      featured.push(destination);
    } else {
      ordinary.push(destination);
    }
  }

  const scenery = response.scenery.filter((item) => {
    const policy = resolveInternetPlacePolicy(domainPolicies, item.domain);
    return policy?.placement !== 'hidden';
  });

  return {
    ...response,
    scenery,
    destinations: [...reserve, ...featured, ...ordinary].slice(
      0,
      destinationLimit,
    ),
  };
}
