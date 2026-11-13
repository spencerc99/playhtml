// ABOUTME: Exercises feature policy, cohort membership, and requests against an emulated D1 database.
// ABOUTME: Verifies public entitlements and admin mutations use the production SQL schema.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { Env } from '../lib/supabase';

const mockAddContact = vi.fn();
const mockSendUpdatesEmail = vi.fn();

vi.mock('../lib/resend', () => ({
  createResendClient: vi.fn(() => ({
    addContact: mockAddContact,
    sendUpdatesEmail: mockSendUpdatesEmail,
  })),
}));
import {
  __resetAccessRequestRateLimitForTests,
  handleAccessRequest,
  handleAdminAccessOverview,
  handleAdminAccessRequestReview,
  handleAdminCohortFeaturesUpdate,
  handleAdminFeatureStageUpdate,
  handleAdminPeopleAdd,
  handleFeatureAccessCheck,
} from '../routes/accessControl';

import { bytesToHex } from '../../../src/utils/restoreRequest';
import { signAccessRequest } from '../../../src/utils/accessRequest';

async function makeIdentity() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keypair.publicKey));
  return {
    publicId: `pk_${bytesToHex(raw)}`,
    privateKey: await crypto.subtle.exportKey('jwk', keypair.privateKey),
  };
}

let PUBLIC_ID: string;
let PRIVATE_KEY: JsonWebKey;
const SECOND_PUBLIC_ID = `pk_04${'b'.repeat(128)}`;

beforeAll(async () => {
  const identity = await makeIdentity();
  PUBLIC_ID = identity.publicId;
  PRIVATE_KEY = identity.privateKey;
});

async function signedAccessRequest(
  ip: string,
  fields: { email: string | null; requestedFeatures: string[] },
  options: { privateKey?: JsonWebKey; publicId?: string; tamper?: Record<string, unknown> } = {},
): Promise<Request> {
  const signed = await signAccessRequest(options.privateKey ?? PRIVATE_KEY, {
    publicId: options.publicId ?? PUBLIC_ID,
    email: fields.email,
    requestedFeatures: fields.requestedFeatures,
    signedAt: Date.now(),
  });
  return new Request('https://worker.example/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ ...signed, ...options.tamper }),
  });
}
const schema = [
  '../../migrations/0001_access_control.sql',
  '../../migrations/0002_quarantine_tape_feature.sql',
].map((path) => readFileSync(
  fileURLToPath(new URL(path, import.meta.url)),
  'utf8',
)).join('\n').replace(/^--.*$/gm, '').trim();

let miniflare: Miniflare;
let workerEnv: Env;

function adminRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://worker.example${path}`, {
    ...init,
    headers: {
      Authorization: 'Bearer admin-secret',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

async function addToCohort(publicIds: string[], cohortId: string): Promise<Response> {
  return handleAdminPeopleAdd(
    adminRequest('/admin/access-control/people', {
      method: 'POST',
      body: JSON.stringify({
        cohortId,
        people: publicIds.map((publicId) => ({ publicId })),
      }),
    }),
    workerEnv,
  );
}

beforeEach(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['WWO_ADMIN_DB'],
  });
  const db = await miniflare.getD1Database('WWO_ADMIN_DB');
  await db.batch(
    schema
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  );
  workerEnv = {
    ADMIN_KEY: 'admin-secret',
    RESEND_API_KEY: 'resend-secret',
    WWO_ADMIN_DB: db,
  } as Env;
  mockAddContact.mockReset();
  mockAddContact.mockResolvedValue({ created: true });
  mockSendUpdatesEmail.mockReset();
  mockSendUpdatesEmail.mockResolvedValue(undefined);
  __resetAccessRequestRateLimitForTests();
});

afterEach(async () => {
  await miniflare.dispose();
});

describe('feature access control', () => {
  it('keeps every seeded experiment unavailable to the public', async () => {
    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      features: Record<string, { stage: string; available: boolean }>;
      internal: boolean;
    };

    expect(body.internal).toBe(false);
    expect(body.features.COPRESENCE).toEqual({ stage: 'internal', available: false });
    expect(body.features.INVENTORY).toEqual({ stage: 'internal', available: false });
    expect(body.features.COMMUTE).toEqual({ stage: 'beta', available: false });
    expect(body.features.BOTTLES).toEqual({ stage: 'internal', available: false });
    expect(body.features.QUARANTINE_TAPE).toEqual({ stage: 'internal', available: false });
  });

  it('gives internal members every unreleased feature', async () => {
    expect((await addToCohort([PUBLIC_ID], 'internal')).status).toBe(201);

    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    const body = await response.json() as {
      features: Record<string, { available: boolean }>;
      internal: boolean;
    };
    expect(body.internal).toBe(true);
    expect(body.features.COMMUTE.available).toBe(true);
    expect(body.features.BOTTLES.available).toBe(true);
    expect(body.features.EMOTES.available).toBe(true);
    expect(body.features.QUARANTINE_TAPE.available).toBe(true);
  });

  it('gives internal members code-defined features without seeded policy rows', async () => {
    await workerEnv.WWO_ADMIN_DB.prepare(
      'DELETE FROM features WHERE feature_id = ?',
    ).bind('QUARANTINE_TAPE').run();
    expect((await addToCohort([PUBLIC_ID], 'internal')).status).toBe(201);

    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    const body = await response.json() as {
      features: Record<string, { stage: string; available: boolean }>;
    };

    expect(body.features.QUARANTINE_TAPE).toEqual({
      stage: 'internal',
      available: true,
    });
  });

  it('shows code-defined features in the admin overview without policy rows', async () => {
    await workerEnv.WWO_ADMIN_DB.prepare(
      'DELETE FROM features WHERE feature_id = ?',
    ).bind('QUARANTINE_TAPE').run();

    const response = await handleAdminAccessOverview(
      adminRequest('/admin/access-control'),
      workerEnv,
    );
    const body = await response.json() as {
      features: Array<{
        id: string;
        name: string;
        description: string;
        stage: string;
      }>;
    };

    expect(body.features).toContainEqual({
      id: 'QUARANTINE_TAPE',
      name: 'Quarantine tape',
      description: 'Mark pages with shared caution tape.',
      stage: 'internal',
    });
  });

  it('creates missing policy rows when a cohort receives a feature grant', async () => {
    await workerEnv.WWO_ADMIN_DB.prepare(
      'DELETE FROM features WHERE feature_id = ?',
    ).bind('QUARANTINE_TAPE').run();

    const cohortUpdate = await handleAdminCohortFeaturesUpdate(
      adminRequest('/admin/access-control/cohorts/closed-beta', {
        method: 'PUT',
        body: JSON.stringify({ featureIds: ['QUARANTINE_TAPE'] }),
      }),
      workerEnv,
      'closed-beta',
    );
    expect(cohortUpdate.status).toBe(200);
    expect((await addToCohort([PUBLIC_ID], 'closed-beta')).status).toBe(201);

    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    const body = await response.json() as {
      features: Record<string, { available: boolean }>;
    };
    expect(body.features.QUARANTINE_TAPE.available).toBe(true);
  });

  it('gives closed beta members beta-stage features but not internal ones', async () => {
    expect((await addToCohort([PUBLIC_ID], 'closed-beta')).status).toBe(201);

    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    const body = await response.json() as {
      features: Record<string, { available: boolean }>;
      internal: boolean;
    };
    expect(body.internal).toBe(false);
    expect(body.features.COMMUTE.available).toBe(true);
    expect(body.features.SCRAPS.available).toBe(true);
    expect(body.features.BOTTLES.available).toBe(false);
  });

  it('applies dashboard cohort and stage changes without a deploy', async () => {
    await addToCohort([PUBLIC_ID], 'closed-beta');
    const cohortUpdate = await handleAdminCohortFeaturesUpdate(
      adminRequest('/admin/access-control/cohorts/closed-beta', {
        method: 'PUT',
        body: JSON.stringify({ featureIds: ['BOTTLES'] }),
      }),
      workerEnv,
      'closed-beta',
    );
    expect(cohortUpdate.status).toBe(200);

    const stageUpdate = await handleAdminFeatureStageUpdate(
      adminRequest('/admin/access-control/features/EMOTES', {
        method: 'PUT',
        body: JSON.stringify({ stage: 'released' }),
      }),
      workerEnv,
      'EMOTES',
    );
    expect(stageUpdate.status).toBe(200);

    const memberBody = await (await handleFeatureAccessCheck(workerEnv, PUBLIC_ID)).json() as {
      features: Record<string, { available: boolean }>;
    };
    const publicBody = await (await handleFeatureAccessCheck(workerEnv, SECOND_PUBLIC_ID)).json() as {
      features: Record<string, { available: boolean }>;
    };
    expect(memberBody.features.BOTTLES.available).toBe(true);
    expect(memberBody.features.COMMUTE.available).toBe(true);
    expect(publicBody.features.COMMUTE.available).toBe(false);
    expect(publicBody.features.EMOTES.available).toBe(true);
  });

  it('clears every explicit cohort feature grant while beta-stage access remains', async () => {
    await addToCohort([PUBLIC_ID], 'closed-beta');
    const grant = (featureIds: string[]) => handleAdminCohortFeaturesUpdate(
      adminRequest('/admin/access-control/cohorts/closed-beta', {
        method: 'PUT',
        body: JSON.stringify({ featureIds }),
      }),
      workerEnv,
      'closed-beta',
    );
    expect((await grant(['BOTTLES'])).status).toBe(200);
    expect((await grant([])).status).toBe(200);

    const body = await (await handleFeatureAccessCheck(workerEnv, PUBLIC_ID)).json() as {
      features: Record<string, { available: boolean }>;
    };
    expect(body.features.BOTTLES.available).toBe(false);
    expect(body.features.COMMUTE.available).toBe(true);
    expect(body.features.SCRAPS.available).toBe(true);
  });

  it('moves beta access with the feature stage', async () => {
    await addToCohort([PUBLIC_ID], 'closed-beta');
    const setStage = (featureId: string, stage: string) => handleAdminFeatureStageUpdate(
      adminRequest(`/admin/access-control/features/${featureId}`, {
        method: 'PUT',
        body: JSON.stringify({ stage }),
      }),
      workerEnv,
      featureId,
    );
    expect((await setStage('EMOTES', 'beta')).status).toBe(200);
    expect((await handleAdminCohortFeaturesUpdate(
      adminRequest('/admin/access-control/cohorts/closed-beta', {
        method: 'PUT',
        body: JSON.stringify({ featureIds: [] }),
      }),
      workerEnv,
      'closed-beta',
    )).status).toBe(200);

    const betaBody = await (await handleFeatureAccessCheck(workerEnv, PUBLIC_ID)).json() as {
      features: Record<string, { available: boolean }>;
    };
    expect(betaBody.features.EMOTES.available).toBe(true);

    expect((await setStage('EMOTES', 'internal')).status).toBe(200);
    const internalBody = await (await handleFeatureAccessCheck(workerEnv, PUBLIC_ID)).json() as {
      features: Record<string, { available: boolean }>;
    };
    expect(internalBody.features.EMOTES.available).toBe(false);
  });

  it('rejects the removed Labs stage', async () => {
    const response = await handleAdminFeatureStageUpdate(
      adminRequest('/admin/access-control/features/EMOTES', {
        method: 'PUT',
        body: JSON.stringify({ stage: 'lab' }),
      }),
      workerEnv,
      'EMOTES',
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid feature stage' });
  });

  it('bulk-adds people and exposes optional contact emails only to admins', async () => {
    const response = await handleAdminPeopleAdd(
      adminRequest('/admin/access-control/people', {
        method: 'POST',
        body: JSON.stringify({
          cohortId: 'closed-beta',
          people: [
            { publicId: PUBLIC_ID.toUpperCase(), email: 'TESTER@EXAMPLE.COM' },
            { publicId: SECOND_PUBLIC_ID },
          ],
        }),
      }),
      workerEnv,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ added: 2, cohortId: 'closed-beta' });

    const overview = await handleAdminAccessOverview(
      adminRequest('/admin/access-control'),
      workerEnv,
    );
    const body = await overview.json() as { people: Array<{ publicId: string; email: string | null }> };
    expect(body.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ publicId: PUBLIC_ID, email: 'tester@example.com' }),
      expect.objectContaining({ publicId: SECOND_PUBLIC_ID, email: null }),
    ]));
  });

  it('keeps undeployed feature records out of the admin controls', async () => {
    await workerEnv.WWO_ADMIN_DB.prepare(
      `INSERT INTO features (feature_id, name, description, stage)
       VALUES ('FUTURE_FEATURE', 'Future feature', 'Not in this extension build.', 'internal')`,
    ).run();

    const overview = await handleAdminAccessOverview(
      adminRequest('/admin/access-control'),
      workerEnv,
    );
    const body = await overview.json() as { features: Array<{ id: string }> };
    expect(body.features).not.toContainEqual(expect.objectContaining({ id: 'FUTURE_FEATURE' }));
  });

  it('records and approves a public access request into a selected cohort', async () => {
    const request = await handleAccessRequest(
      await signedAccessRequest('192.0.2.1', {
        email: 'tester@example.com',
        requestedFeatures: ['COMMUTE'],
      }),
      workerEnv,
    );
    expect(request.status).toBe(201);
    const { id } = await request.json() as { id: number };
    expect(mockAddContact).toHaveBeenCalledWith(
      'tester@example.com',
      'extension-setup',
    );
    expect(mockSendUpdatesEmail).toHaveBeenCalledWith('tester@example.com');

    const approval = await handleAdminAccessRequestReview(
      adminRequest(`/admin/access-control/requests/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ decision: 'approved', cohortId: 'closed-beta' }),
      }),
      workerEnv,
      id,
    );
    expect(approval.status).toBe(200);

    const access = await (await handleFeatureAccessCheck(workerEnv, PUBLIC_ID)).json() as {
      features: Record<string, { available: boolean }>;
    };
    expect(access.features.COMMUTE.available).toBe(true);
    expect(access.features.BOTTLES.available).toBe(false);
  });

  it('does not resend the updates email to an existing contact', async () => {
    mockAddContact.mockResolvedValueOnce({ created: false });

    const response = await handleAccessRequest(
      await signedAccessRequest('192.0.2.2', {
        email: 'existing@example.com',
        requestedFeatures: ['COMMUTE'],
      }),
      workerEnv,
    );

    expect(response.status).toBe(201);
    expect(mockAddContact).toHaveBeenCalledWith(
      'existing@example.com',
      'extension-setup',
    );
    expect(mockSendUpdatesEmail).not.toHaveBeenCalled();
  });

  it('records the access request when the project-updates signup fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAddContact.mockRejectedValueOnce(new Error('resend down'));

    const response = await handleAccessRequest(
      await signedAccessRequest('192.0.2.3', {
        email: 'tester@example.com',
        requestedFeatures: ['COMMUTE'],
      }),
      workerEnv,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 1, status: 'pending' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[AccessControl] project updates signup failed:',
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it('with enforcement on, rejects an access request without a signature', async () => {
    workerEnv.REQUIRE_PARTICIPANT_SIGNATURES = 'true';
    const response = await handleAccessRequest(
      new Request('https://worker.example/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.4' },
        body: JSON.stringify({
          publicId: PUBLIC_ID,
          email: 'tester@example.com',
          requestedFeatures: ['COMMUTE'],
        }),
      }),
      workerEnv,
    );

    expect(response.status).toBe(401);
    expect(mockAddContact).not.toHaveBeenCalled();
    const pending = await workerEnv.WWO_ADMIN_DB.prepare(
      'SELECT COUNT(*) AS n FROM access_requests',
    ).first<{ n: number }>();
    expect(pending?.n).toBe(0);
  });

  it('with enforcement off, records an unsigned request as before and logs it as legacy', async () => {
    workerEnv.REQUIRE_PARTICIPANT_SIGNATURES = 'false';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await handleAccessRequest(
      new Request('https://worker.example/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' },
        body: JSON.stringify({
          publicId: PUBLIC_ID,
          email: 'tester@example.com',
          requestedFeatures: ['COMMUTE', 'SCRAPS'],
        }),
      }),
      workerEnv,
    );

    expect(response.status).toBe(201);
    expect(log).toHaveBeenCalledWith('[legacy-unsigned] POST /access-requests');
    const row = await workerEnv.WWO_ADMIN_DB.prepare(
      'SELECT email, requested_features FROM access_requests WHERE public_id = ?',
    ).bind(PUBLIC_ID).first<{ email: string; requested_features: string }>();
    expect(row).toEqual({
      email: 'tester@example.com',
      requested_features: '["COMMUTE","SCRAPS"]',
    });
    log.mockRestore();
  });

  it('with enforcement off, still rejects a stale signature', async () => {
    workerEnv.REQUIRE_PARTICIPANT_SIGNATURES = 'false';
    const signed = await signAccessRequest(PRIVATE_KEY, {
      publicId: PUBLIC_ID,
      email: null,
      requestedFeatures: ['COMMUTE'],
      signedAt: Date.now() - 10 * 60_000,
    });
    const response = await handleAccessRequest(
      new Request('https://worker.example/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.11' },
        body: JSON.stringify(signed),
      }),
      workerEnv,
    );

    expect(response.status).toBe(401);
  });

  it('with enforcement on, records a request signed by the participant', async () => {
    workerEnv.REQUIRE_PARTICIPANT_SIGNATURES = 'true';
    const response = await handleAccessRequest(
      await signedAccessRequest('192.0.2.12', {
        email: null,
        requestedFeatures: ['COMMUTE'],
      }),
      workerEnv,
    );

    expect(response.status).toBe(201);
  });

  it('with enforcement off, rejects an access request signed by a different key', async () => {
    workerEnv.REQUIRE_PARTICIPANT_SIGNATURES = 'false';
    const other = await makeIdentity();
    const response = await handleAccessRequest(
      await signedAccessRequest(
        '192.0.2.5',
        { email: 'attacker@example.com', requestedFeatures: ['COMMUTE'] },
        { privateKey: other.privateKey },
      ),
      workerEnv,
    );

    expect(response.status).toBe(401);
  });

  it('keeps a pending request email from being replaced by an altered signed request', async () => {
    const first = await handleAccessRequest(
      await signedAccessRequest('192.0.2.6', {
        email: 'tester@example.com',
        requestedFeatures: ['COMMUTE'],
      }),
      workerEnv,
    );
    expect(first.status).toBe(201);

    const altered = await handleAccessRequest(
      await signedAccessRequest(
        '192.0.2.7',
        { email: 'tester@example.com', requestedFeatures: ['COMMUTE'] },
        { tamper: { email: 'attacker@example.com' } },
      ),
      workerEnv,
    );
    expect(altered.status).toBe(401);

    const row = await workerEnv.WWO_ADMIN_DB.prepare(
      'SELECT email FROM access_requests WHERE public_id = ?',
    ).bind(PUBLIC_ID).first<{ email: string }>();
    expect(row?.email).toBe('tester@example.com');
  });

  it('accepts a signed request with no email and normalizes a mixed-case email', async () => {
    const withoutEmail = await handleAccessRequest(
      await signedAccessRequest('192.0.2.8', { email: null, requestedFeatures: ['COMMUTE'] }),
      workerEnv,
    );
    expect(withoutEmail.status).toBe(201);
    expect(mockAddContact).not.toHaveBeenCalled();

    const withEmail = await handleAccessRequest(
      await signedAccessRequest('192.0.2.9', {
        email: ' Tester@Example.com ',
        requestedFeatures: ['COMMUTE', 'COMMUTE'],
      }),
      workerEnv,
    );
    expect(withEmail.status).toBe(200);
    const row = await workerEnv.WWO_ADMIN_DB.prepare(
      'SELECT email, requested_features FROM access_requests WHERE public_id = ?',
    ).bind(PUBLIC_ID).first<{ email: string; requested_features: string }>();
    expect(row).toEqual({ email: 'tester@example.com', requested_features: '["COMMUTE"]' });
  });

  it('rejects public ids that are not uncompressed P-256 keys', async () => {
    const response = await handleFeatureAccessCheck(workerEnv, `pk_${'a'.repeat(130)}`);
    expect(response.status).toBe(400);
  });

  it('requires the admin key for policy reads and mutations', async () => {
    const response = await handleAdminAccessOverview(
      new Request('https://worker.example/admin/access-control'),
      workerEnv,
    );
    expect(response.status).toBe(401);
  });
});
