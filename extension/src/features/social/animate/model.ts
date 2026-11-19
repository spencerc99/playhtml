// ABOUTME: Background-side call to whatever model the person points animate at (local llama.cpp by default).
// ABOUTME: Any OpenAI-compatible chat endpoint works: llama-server, LM Studio, Ollama's /v1, or a hosted API.

import browser from "webextension-polyfill";
import { RESPONSE_SCHEMA } from "./prompt";

export interface AnimateModelSettings {
  endpoint: string;
  model: string;
  /** Ask the server to constrain output to the suggestion schema. */
  constrain: boolean;
  apiKey?: string;
}

export const DEFAULT_MODEL_SETTINGS: AnimateModelSettings = {
  endpoint: "http://localhost:8080/v1/chat/completions",
  model: "local",
  constrain: true,
};

export const MODEL_SETTINGS_KEY = "animateModel";

export async function loadModelSettings(): Promise<AnimateModelSettings> {
  const stored = (await browser.storage.local.get(MODEL_SETTINGS_KEY))[
    MODEL_SETTINGS_KEY
  ];
  return { ...DEFAULT_MODEL_SETTINGS, ...(stored || {}) };
}

export interface SuggestResponse {
  raw?: string;
  model?: string;
  local?: boolean;
  ms?: number;
  error?: string;
}

export async function requestSuggestions(
  messages: unknown[],
): Promise<SuggestResponse> {
  const s = await loadModelSettings();
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: s.model,
    messages,
    temperature: 0.2,
    max_tokens: 400,
  };
  if (s.constrain) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "suggestions", schema: RESPONSE_SCHEMA },
    };
  }
  let local = false;
  try {
    const host = new URL(s.endpoint).hostname;
    local =
      host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return { error: `Bad model address: ${s.endpoint}` };
  }
  try {
    const res = await fetch(s.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        error: `Model answered ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? "";
    const model = String(json?.model || s.model)
      .split("/")
      .pop()!
      .replace(/\.gguf$/, "");
    return { raw, model, local, ms: Date.now() - started };
  } catch (err) {
    return {
      error: `Couldn't reach the model at ${s.endpoint} (${(err as Error).message})`,
    };
  }
}
