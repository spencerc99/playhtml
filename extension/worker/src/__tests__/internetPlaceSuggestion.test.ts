// ABOUTME: Exercises advisory Internet place suggestions against an emulated D1 cache.
// ABOUTME: Verifies parsing, authentication, cache reuse, and policy separation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { Env } from '../lib/supabase';
import {
  handleInternetPlaceSuggestion,
  INTERNET_PLACE_SUGGESTION_MODEL,
  INTERNET_PLACE_SUGGESTION_PROMPT_VERSION,
  parseInternetPlaceSuggestionModelOutput,
} from '../routes/internetPlaceSuggestion';

const schema = [
  '../../migrations/0003_internet_place_catalog.sql',
  '../../migrations/0005_internet_place_suggestions.sql',
].map((path) => readFileSync(
  fileURLToPath(new URL(path, import.meta.url)),
  'utf8',
)).join('\n').replace(/^--.*$/gm, '').trim();

const suggestion = {
  placement: 'featured',
  scope: 'hostname',
  reason: 'human-community',
  confidence: 0.82,
  rationale: 'A public, independent community with distinctive cultural value.',
  uncertainties: ['Ownership could change.'],
} as const;

let miniflare: Miniflare;
let env: Env;

function suggestionRequest(
  body: unknown,
  token = 'admin-secret',
): Request {
  return new Request('https://worker.example/admin/internet-places/suggestion', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function countRows(table: string): Promise<number> {
  const row = await env.WWO_ADMIN_DB.prepare(
    `SELECT COUNT(*) AS count FROM ${table}`,
  ).first<{ count: number }>();
  return row?.count ?? -1;
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

describe('Internet place suggestions', () => {
  it('parses structured and chat-completion model output', () => {
    expect(parseInternetPlaceSuggestionModelOutput(suggestion)).toEqual(suggestion);
    expect(parseInternetPlaceSuggestionModelOutput({
      choices: [{ message: { content: JSON.stringify(suggestion) } }],
    })).toEqual(suggestion);
    expect(parseInternetPlaceSuggestionModelOutput({
      ...suggestion,
      placement: 'promoted',
    })).toBeNull();
    expect(parseInternetPlaceSuggestionModelOutput({
      ...suggestion,
      confidence: 2,
    })).toBeNull();
  });

  it('requires admin authentication before reading the cache', async () => {
    const response = await handleInternetPlaceSuggestion(
      suggestionRequest({ candidate: { url: 'https://example.com/essay' } }, 'wrong'),
      env,
    );
    expect(response.status).toBe(401);
    expect(await countRows('place_suggestions')).toBe(0);
  });

  it('returns a canonical-page cache hit without an AI binding', async () => {
    await env.WWO_ADMIN_DB.prepare(
      `INSERT INTO place_suggestions (
         page_key, model, prompt_version, suggestion_json, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      'https://example.com/essay',
      INTERNET_PLACE_SUGGESTION_MODEL,
      INTERNET_PLACE_SUGGESTION_PROMPT_VERSION,
      JSON.stringify(suggestion),
      '2026-08-22 10:00:00',
    ).run();

    const response = await handleInternetPlaceSuggestion(
      suggestionRequest({
        candidate: {
          url: 'https://www.example.com/essay/?utm_source=private-tracker',
          title: 'An essay',
          audit: { scores: { humanWeb: 82 }, observation: { visits: 3 } },
        },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      source: 'cache',
      model: INTERNET_PLACE_SUGGESTION_MODEL,
      promptVersion: INTERNET_PLACE_SUGGESTION_PROMPT_VERSION,
      createdAt: '2026-08-22 10:00:00',
      suggestion,
    });
    expect(await countRows('place_suggestions')).toBe(1);
    expect(await countRows('place_policies')).toBe(0);
  });

  it('bypasses cache on refresh and fails clearly when AI is unavailable', async () => {
    await env.WWO_ADMIN_DB.prepare(
      `INSERT INTO place_suggestions (
         page_key, model, prompt_version, suggestion_json
       ) VALUES (?, ?, ?, ?)`,
    ).bind(
      'https://example.com/essay',
      INTERNET_PLACE_SUGGESTION_MODEL,
      INTERNET_PLACE_SUGGESTION_PROMPT_VERSION,
      JSON.stringify(suggestion),
    ).run();
    const response = await handleInternetPlaceSuggestion(
      suggestionRequest({
        candidate: { url: 'https://example.com/essay' },
        refresh: true,
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      available: false,
      error: 'Workers AI is not configured for this environment',
    });
    expect(await countRows('place_policies')).toBe(0);
  });

  it('rejects private targets and oversized metadata without writing', async () => {
    for (const candidate of [
      { url: 'http://127.0.0.1/private' },
      { url: 'https://example.com', audit: { note: 'x'.repeat(501) } },
      {
        url: 'https://example.com',
        audit: { participantIds: ['participant-secret'] },
      },
      {
        url: 'https://example.com',
        inspection: { finalUrl: 'http://127.0.0.1/private' },
      },
    ]) {
      const response = await handleInternetPlaceSuggestion(
        suggestionRequest({ candidate }),
        env,
      );
      expect(response.status).toBe(400);
    }
    expect(await countRows('place_suggestions')).toBe(0);
    expect(await countRows('place_policies')).toBe(0);
  });
});
