// ABOUTME: Fetches one public page anonymously and extracts the small set of
// ABOUTME: signals Jev is asked about, with results cached on disk between runs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { urlHash } from "./buildTestset";
import type { PageState } from "./questions";
import { detectHandmadeSignals, signalNames } from "./handmadeSignals";
import { applyRender, renderPage, THIN_TEXT_THRESHOLD } from "./render";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 500_000;
const EXCERPT_LENGTH = 1_500;

export type Evidence = {
  kind: "fetched" | "rendered" | "url-only";
  state: PageState;
  error?: string;
  /** Milliseconds spent in headless Chromium, when this page was rendered. */
  renderMs?: number;
  /** Visible text length before rendering, for reporting what rendering gained. */
  staticTextLength?: number;
  signals?: import("./handmadeSignals").HandmadeSignals;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    );
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).trim() || null;
  }
  return null;
}

function metaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return firstMatch(html, [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`,
      "i",
    ),
  ]);
}

/** Strips the markup that carries no reading content, then collapses whitespace. */
export function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOGIN_PATH_PATTERN =
  /\/(login|signin|sign-in|sign_in|auth|authorize|session[s]?\/new|account[s]?\/login|sso|saml)(\/|$|\?)/i;

export function looksLikeLoginRedirect(
  requestedUrl: string,
  finalUrl: string,
): boolean {
  if (requestedUrl === finalUrl) return false;
  try {
    return LOGIN_PATH_PATTERN.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}

function urlOnlyState(url: string, title: string | null): PageState {
  let hostname = url;
  let path = "/";
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    path = parsed.pathname + parsed.search;
  } catch {
    // A fixture URL that does not parse still gets asked about by its raw text.
  }
  return {
    page: {
      url,
      hostname,
      path,
      title,
      description: null,
      site_name: null,
      author: null,
      content_type: null,
      text_excerpt: null,
    },
    inspection: {
      http_status: null,
      redirected_to_login: false,
      robots_noindex: false,
      has_password_field: false,
      fetched: false,
    },
  };
}

/** Reads at most MAX_BYTES so one enormous page cannot stall the run. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      if (total >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return chunks.join("");
}

async function fetchEvidence(
  url: string,
  fallbackTitle: string | null,
): Promise<Evidence & { html?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      kind: "url-only",
      state: urlOnlyState(url, fallbackTitle),
      error: "unparseable url",
    };
  }

  // Only public http(s) URLs are ever fetched.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      kind: "url-only",
      state: urlOnlyState(url, fallbackTitle),
      error: `unsupported protocol ${parsed.protocol}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    const html = await readCapped(response);
    const text = visibleText(html);

    return {
      kind: "fetched",
      html,
      state: {
        page: {
          url,
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          title:
            firstMatch(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]) ??
            metaContent(html, "og:title") ??
            fallbackTitle,
          description:
            metaContent(html, "description") ??
            metaContent(html, "og:description"),
          site_name: metaContent(html, "og:site_name"),
          author:
            metaContent(html, "author") ?? metaContent(html, "article:author"),
          content_type: metaContent(html, "og:type"),
          text_excerpt: text.slice(0, EXCERPT_LENGTH) || null,
        },
        inspection: {
          http_status: response.status,
          redirected_to_login: looksLikeLoginRedirect(url, response.url),
          robots_noindex: /noindex/i.test(
            metaContent(html, "robots") ??
              response.headers.get("x-robots-tag") ??
              "",
          ),
          has_password_field: /<input[^>]+type=["']password["']/i.test(html),
          fetched: true,
        },
      },
    };
  } catch (error) {
    return {
      kind: "url-only",
      state: urlOnlyState(url, fallbackTitle),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evidence is cached by URL so a re-run, or a re-map of cached answers, costs
 * no network traffic.
 */
export async function loadEvidence(
  url: string,
  fallbackTitle: string | null,
  cacheDir: string,
  synthetic: boolean,
): Promise<Evidence> {
  const path = join(cacheDir, "evidence", `${urlHash(url)}.json`);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as Evidence;
  }

  let evidence: Evidence = synthetic
    ? {
        kind: "url-only" as const,
        state: urlOnlyState(url, fallbackTitle),
        error: "synthetic fixture host",
      }
    : await fetchEvidence(url, fallbackTitle);

  // A static fetch of a canvas or client-rendered page yields almost no text, so
  // render those in a browser before deciding they hold nothing.
  const staticTextLength = evidence.state.page.text_excerpt?.length ?? 0;
  let html = (evidence as { html?: string }).html ?? "";
  if (!synthetic && staticTextLength < THIN_TEXT_THRESHOLD) {
    const outcome = await renderPage(url);
    if (outcome.rendered) {
      if (outcome.html) html = outcome.html;
      evidence = {
        kind: "rendered",
        state: applyRender(evidence.state, outcome),
        renderMs: outcome.durationMs,
        staticTextLength,
      };
    } else {
      evidence = { ...evidence, renderMs: outcome.durationMs, staticTextLength };
    }
  }

  // Handmade markers are read from the markup in code, never inferred by a model.
  if (html) {
    const signals = detectHandmadeSignals(html);
    evidence = {
      ...evidence,
      signals,
      state: {
        ...evidence.state,
        page: { ...evidence.state.page, handmade_signals: signalNames(signals) },
      },
    };
  }

  // The raw HTML is large and already distilled into signals, so it is not cached.
  delete (evidence as { html?: string }).html;

  mkdirSync(join(cacheDir, "evidence"), { recursive: true });
  writeFileSync(path, JSON.stringify(evidence, null, 2));
  return evidence;
}
