// ABOUTME: Exercises Internet place evidence and policies against an emulated D1 catalog.
// ABOUTME: Verifies idempotent imports, human precedence, and runtime stop filtering.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { CommuteResponse } from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';
import {
  applyInternetPlacePolicies,
  handleInternetPlaceCatalog,
  handleInternetPlaceEvidenceImport,
  handleInternetPlacePolicyPut,
  loadInternetPlacePolicies,
} from '../routes/internetPlaceCatalog';

const schema = readFileSync(
  fileURLToPath(
    new URL('../../migrations/0003_internet_place_catalog.sql', import.meta.url),
  ),
  'utf8',
).replace(/^--.*$/gm, '').trim();

let miniflare: Miniflare;
let env: Env;

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

function evidenceLabel(value: string, confidence = 0.8) {
  return { value, confidence, source: 'url-rule', reasons: ['test evidence'] };
}

function evaluationArtifact(
  title = 'A human page',
  generatedAt = '2026-08-16T07:17:41.784Z',
) {
  return {
    version: 2,
    summary: {
      generatedAt,
      sourceArchive: 'redacted-production-snapshot/data.sql.zst',
    },
    candidates: [
      {
        id: 'page-derived-from-private-events',
        url: 'https://docs.example.com/essay/?utm_source=test',
        domain: 'example.com',
        title,
        participantIds: ['participant-secret'],
        sessionIds: ['session-secret'],
        lanes: ['Independent convergence'],
        observation: {
          visits: 5,
          participants: 2,
          sessions: 3,
          screenTimeMs: 50_000,
          firstSeen: '2026-08-01T00:00:00.000Z',
          lastSeen: '2026-08-02T00:00:00.000Z',
          domainParticipants: 4,
          domainVisits: 20,
          domainScreenTimeMs: 100_000,
        },
        category: evidenceLabel('Arts & culture'),
        pageType: evidenceLabel('Article or essay'),
        exposure: evidenceLabel('Public', 0.92),
        character: evidenceLabel('Human-made'),
        components: {
          pageRarity: 0.8,
          domainRarity: 0.7,
          externalRarity: null,
          attentionQuality: 0.9,
          convergence: 1,
          specificity: 1,
          humanConfidence: 0.8,
          evidenceConfidence: 0.7,
          freshness: 0.9,
          manipulationPenalty: 0,
        },
        scores: {
          balanced: 75,
          longTail: 78,
          hiddenPlatform: 60,
          humanWeb: 81,
        },
        initialJudgment: evidenceLabel('Promote'),
        reasons: ['2 people', '5 focus visits'],
      },
    ],
  };
}

function commuteResponse(): CommuteResponse {
  return {
    generatedAt: 1,
    activePeople: 1,
    scenery: [
      { id: 'example.com:1', domain: 'example.com', visitedAt: 1, hue: '#000' },
      { id: 'sub.example.com:1', domain: 'sub.example.com', visitedAt: 1, hue: '#000' },
      { id: 'other.example:1', domain: 'other.example', visitedAt: 1, hue: '#000' },
    ],
    destinations: [
      {
        id: 'other',
        url: 'https://other.example/article',
        domain: 'other.example',
        title: 'Other',
        visitedAt: 1,
        hue: '#000',
      },
      {
        id: 'essay',
        url: 'https://example.com/essay',
        domain: 'example.com',
        title: 'Essay',
        visitedAt: 1,
        hue: '#000',
      },
      {
        id: 'notes',
        url: 'https://example.com/notes',
        domain: 'example.com',
        title: 'Notes',
        visitedAt: 1,
        hue: '#000',
      },
      {
        id: 'subdomain',
        url: 'https://sub.example.com/page',
        domain: 'sub.example.com',
        title: 'Subdomain page',
        visitedAt: 1,
        hue: '#000',
      },
    ],
  };
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
  env = {
    ADMIN_KEY: 'admin-secret',
    WWO_ADMIN_DB: db,
  } as Env;
});

afterEach(async () => {
  await miniflare.dispose();
});

describe('Internet place catalog', () => {
  it('imports only machine evidence without creating a human policy', async () => {
    const response = await handleInternetPlaceEvidenceImport(
      adminRequest('/admin/internet-places/evidence', {
        method: 'POST',
        body: JSON.stringify(evaluationArtifact()),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: 1,
      generatedAt: '2026-08-16T07:17:41.784Z',
    });

    const catalog = await handleInternetPlaceCatalog(
      adminRequest('/admin/internet-places'),
      env,
    );
    const body = await catalog.json() as {
      policies: unknown[];
      evidence: Array<{
        url: string;
        provenance: string;
        evidence: { initialJudgment: { value: string }; observation: { participants: number } };
      }>;
    };
    expect(body.policies).toEqual([]);
    expect(body.evidence).toEqual([
      expect.objectContaining({
        url: 'https://docs.example.com/essay',
        provenance:
          'commute-history-audit/v2:redacted-production-snapshot/data.sql.zst',
        evidence: expect.objectContaining({
          initialJudgment: expect.objectContaining({ value: 'Promote' }),
          observation: expect.objectContaining({ participants: 2 }),
        }),
      }),
    ]);
    expect(JSON.stringify(body.evidence)).not.toContain('participant-secret');
    expect(JSON.stringify(body.evidence)).not.toContain('session-secret');
    expect(JSON.stringify(body.evidence)).not.toContain(
      'page-derived-from-private-events',
    );
  });

  it('rejects private addresses even when an artifact labels them public', async () => {
    const artifact = evaluationArtifact();
    artifact.candidates[0].url = 'http://127.0.0.1/private';
    artifact.candidates[0].domain = '127.0.0.1';

    const response = await handleInternetPlaceEvidenceImport(
      adminRequest('/admin/internet-places/evidence', {
        method: 'POST',
        body: JSON.stringify(artifact),
      }),
      env,
    );

    expect(response.status).toBe(400);
    const rows = await env.WWO_ADMIN_DB.prepare(
      'SELECT COUNT(*) AS count FROM place_evidence',
    ).first<{ count: number }>();
    expect(rows?.count).toBe(0);
  });

  it('updates the same evidence row when an artifact is imported again', async () => {
    for (const artifact of [
      evaluationArtifact(),
      evaluationArtifact('Revised title', '2026-08-17T00:00:00.000Z'),
    ]) {
      expect((await handleInternetPlaceEvidenceImport(
        adminRequest('/admin/internet-places/evidence', {
          method: 'POST',
          body: JSON.stringify(artifact),
        }),
        env,
      )).status).toBe(200);
    }

    const rows = await env.WWO_ADMIN_DB.prepare(
      'SELECT title, generated_at FROM place_evidence',
    ).all<{ title: string; generated_at: string }>();
    expect(rows.results).toEqual([
      {
        title: 'Revised title',
        generated_at: '2026-08-17T00:00:00.000Z',
      },
    ]);
  });

  it('applies page before hostname before site and ignores note-only policies', async () => {
    const policies = [
      { scope: 'site', placeKey: 'example.com', verdict: 'blocked' },
      { scope: 'hostname', placeKey: 'example.com', verdict: 'scenery-only' },
      { scope: 'page', placeKey: 'https://example.com/essay', verdict: 'promoted' },
      { scope: 'page', placeKey: 'https://example.com/notes', note: 'Review later' },
    ] as const;
    for (const policy of policies) {
      expect((await handleInternetPlacePolicyPut(
        adminRequest('/admin/internet-places/policy', {
          method: 'PUT',
          body: JSON.stringify(policy),
        }),
        env,
      )).status).toBe(200);
    }

    const loaded = await loadInternetPlacePolicies(
      env.WWO_ADMIN_DB,
      commuteResponse(),
    );
    const result = applyInternetPlacePolicies(commuteResponse(), loaded, 50);
    expect(result.destinations.map((item) => item.url)).toEqual([
      'https://example.com/essay',
      'https://other.example/article',
    ]);
    expect(result.scenery.map((item) => item.domain)).toEqual([
      'example.com',
      'other.example',
    ]);
  });
});
