// ABOUTME: Calls the TypeSafe System One endpoint for one page's questions, with
// ABOUTME: rate-limit backoff and on-disk caching of raw answers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { urlHash } from "./buildTestset";
import {
  JEV_MODEL,
  PLACEMENT_QUESTIONS,
  PROMPT_VERSION,
  type Answer,
  type PageState,
  type PlacementAnswers,
} from "./questions";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export type Usage = { input_tokens: number; output_tokens: number };

export type JevResult = {
  model: string;
  answers: PlacementAnswers;
  usage: Usage;
  promptVersion: string;
};

/**
 * Reads the token from the repo's .env at call time. The value is never logged,
 * printed, or written to any output file.
 */
export function readJevToken(envPath: string): string {
  if (!existsSync(envPath)) {
    throw new Error(`env file not found at ${envPath}`);
  }
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?JEV_TOKEN\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  throw new Error("JEV_TOKEN is missing from the env file");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.max(0, date - Date.now());
    }
  }
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

async function requestAnswers(
  state: PageState,
  token: string,
): Promise<JevResult> {
  const body = JSON.stringify({
    state,
    model: JEV_MODEL,
    questions: PLACEMENT_QUESTIONS,
  });

  let lastError = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        model: string;
        answers: Record<string, Answer>;
        usage: Usage;
      };
      return {
        model: payload.model,
        answers: payload.answers as unknown as PlacementAnswers,
        usage: payload.usage,
        promptVersion: PROMPT_VERSION,
      };
    }

    if (response.status === 429 || response.status === 529) {
      await sleep(retryDelayMs(response, attempt));
      lastError = `status ${response.status}`;
      continue;
    }

    const detail = await response.text();
    throw new Error(
      `TypeSafe request failed with status ${response.status}: ${detail.slice(0, 400)}`,
    );
  }

  throw new Error(`TypeSafe request gave up after retries (${lastError})`);
}

/**
 * Answers are cached by URL and prompt version, so re-running the report or
 * re-tuning thresholds needs no further API calls.
 */
export async function loadAnswers(
  url: string,
  state: PageState,
  token: string,
  cacheDir: string,
): Promise<JevResult & { cached: boolean }> {
  const path = join(
    cacheDir,
    "answers",
    `${PROMPT_VERSION}-${urlHash(url)}.json`,
  );
  if (existsSync(path)) {
    return {
      ...(JSON.parse(readFileSync(path, "utf8")) as JevResult),
      cached: true,
    };
  }

  const result = await requestAnswers(state, token);
  mkdirSync(join(cacheDir, "answers"), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2));
  return { ...result, cached: false };
}

export function readCachedAnswers(
  url: string,
  cacheDir: string,
): JevResult | null {
  const path = join(
    cacheDir,
    "answers",
    `${PROMPT_VERSION}-${urlHash(url)}.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as JevResult;
}
