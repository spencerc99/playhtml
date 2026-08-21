// ABOUTME: Exercises feature policy, cohort membership, and requests against an emulated D1 database.
// ABOUTME: Verifies public entitlements and admin mutations use the production SQL schema.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const PUBLIC_ID = `pk_${'a'.repeat(130)}`;
const SECOND_PUBLIC_ID = `pk_${'b'.repeat(130)}`;
const schema = readFileSync(
  fileURLToPath(new URL('../../migrations/0001_access_control.sql', import.meta.url)),
  'utf8',
).replace(/^--.*$/gm, '').trim();

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
    const body = await response.json() as { features: Record<string, { stage: string; available: boolean }> };

    expect(body.features.COPRESENCE).toEqual({ stage: 'internal', available: false });
    expect(body.features.INVENTORY).toEqual({ stage: 'internal', available: false });
    expect(body.features.COMMUTE).toEqual({ stage: 'beta', available: false });
    expect(body.features.BOTTLES).toEqual({ stage: 'internal', available: false });
  });

  it('gives internal members every unreleased feature', async () => {
    expect((await addToCohort([PUBLIC_ID], 'internal')).status).toBe(201);

    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    const body = await response.json() as { features: Record<string, { available: boolean }> };
    expect(body.features.COMMUTE.available).toBe(true);
    expect(body.features.BOTTLES.available).toBe(true);
    expect(body.features.EMOTES.available).toBe(true);
  });

  it('limits closed beta members to the cohort feature grants', async () => {
    expect((await addToCohort([PUBLIC_ID], 'closed-beta')).status).toBe(201);

    const response = await handleFeatureAccessCheck(workerEnv, PUBLIC_ID);
    const body = await response.json() as { features: Record<string, { available: boolean }> };
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
    expect(memberBody.features.COMMUTE.available).toBe(false);
    expect(publicBody.features.EMOTES.available).toBe(true);
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
      new Request('https://worker.example/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
        body: JSON.stringify({
          publicId: PUBLIC_ID,
          email: 'tester@example.com',
          requestedFeatures: ['COMMUTE'],
        }),
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
      new Request('https://worker.example/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.2' },
        body: JSON.stringify({
          publicId: PUBLIC_ID,
          email: 'existing@example.com',
          requestedFeatures: ['COMMUTE'],
        }),
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
      new Request('https://worker.example/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.3' },
        body: JSON.stringify({
          publicId: PUBLIC_ID,
          email: 'tester@example.com',
          requestedFeatures: ['COMMUTE'],
        }),
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

  it('requires the admin key for policy reads and mutations', async () => {
    const response = await handleAdminAccessOverview(
      new Request('https://worker.example/admin/access-control'),
      workerEnv,
    );
    expect(response.status).toBe(401);
  });
});
