// ABOUTME: Renders a thin page in headless Chromium and reads its title, text, and
// ABOUTME: element tallies, so visual and interactive pages are not judged as empty.

import { chromium, type Browser } from "playwright";

import type { PageState, PageStructure } from "./questions";

const RENDER_TIMEOUT_MS = 15_000;
const EXCERPT_LENGTH = 1_500;

/** Below this much visible text, a static fetch has told us almost nothing. */
export const THIN_TEXT_THRESHOLD = 300;

export type RenderOutcome = {
  rendered: boolean;
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  contentType: string | null;
  text: string | null;
  structure: PageStructure | null;
  hasPasswordField: boolean;
  /** The rendered DOM's HTML, for code-side signal detection. */
  html: string | null;
  durationMs: number;
  error?: string;
};

let shared: Browser | null = null;

/** One headless browser for the whole run; each page still gets a fresh context. */
export async function getBrowser(): Promise<Browser> {
  if (!shared) {
    shared = await chromium.launch({ headless: true });
  }
  return shared;
}

export async function closeBrowser(): Promise<void> {
  if (shared) {
    await shared.close();
    shared = null;
  }
}

type ExtractedPage = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  contentType: string | null;
  text: string;
  html: string;
  structure: PageStructure;
};

const EXTRACTOR_SOURCE = `(() => {
  const meta = (name) => {
    const node = document.querySelector(
      'meta[name="' + name + '"], meta[property="' + name + '"]'
    );
    const content = node && node.getAttribute('content');
    return content && content.trim() ? content.trim() : null;
  };

  const canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
  let hasWebgl = false;
  for (const canvas of canvases) {
    try {
      if (canvas.getContext('webgl') || canvas.getContext('webgl2')) {
        hasWebgl = true;
        break;
      }
    } catch (error) {
      // A canvas whose context cannot be read simply does not count as webgl.
    }
  }

  const cursorStyle = document.body
    ? getComputedStyle(document.body).cursor
    : 'auto';
  const body = document.body ? document.body.innerText || '' : '';

  return {
    title: document.title && document.title.trim() ? document.title.trim() : null,
    description: meta('description') || meta('og:description'),
    siteName: meta('og:site_name'),
    author: meta('author') || meta('article:author'),
    contentType: meta('og:type'),
    text: body.replace(/\\s+/g, ' ').trim(),
    html: document.documentElement ? document.documentElement.outerHTML : '',
    structure: {
      canvas: canvases.length,
      svg: document.querySelectorAll('svg').length,
      img: document.querySelectorAll('img').length,
      video: document.querySelectorAll('video').length,
      audio: document.querySelectorAll('audio').length,
      iframe: document.querySelectorAll('iframe').length,
      form: document.querySelectorAll('form').length,
      password_input: document.querySelectorAll('input[type="password"]').length,
      link: document.querySelectorAll('a[href]').length,
      has_webgl_canvas: hasWebgl,
      has_custom_cursor: cursorStyle !== 'auto' && cursorStyle !== 'default'
    }
  };
})()`;

export async function renderPage(url: string): Promise<RenderOutcome> {
  const started = Date.now();
  const empty = {
    rendered: false,
    title: null,
    description: null,
    siteName: null,
    author: null,
    contentType: null,
    text: null,
    structure: null,
    hasPasswordField: false,
    html: null,
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ...empty, durationMs: 0, error: "unparseable url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ...empty,
      durationMs: 0,
      error: `unsupported protocol ${parsed.protocol}`,
    };
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    acceptDownloads: false,
    javaScriptEnabled: true,
  });

  try {
    const page = await context.newPage();
    page.on("download", (download) => {
      void download.cancel();
    });

    await page.goto(url, {
      timeout: RENDER_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    // Give client-rendered pages a moment to paint their actual content.
    await page
      .waitForLoadState("networkidle", { timeout: 4_000 })
      .catch(() => undefined);

    // The extractor is passed as source text: the bundler that runs this script
    // rewrites inline functions with helpers that do not exist in the page.
    const extracted = (await page.evaluate(EXTRACTOR_SOURCE)) as ExtractedPage;

    return {
      rendered: true,
      title: extracted.title,
      description: extracted.description,
      siteName: extracted.siteName,
      author: extracted.author,
      contentType: extracted.contentType,
      text: extracted.text.slice(0, EXCERPT_LENGTH) || null,
      structure: extracted.structure,
      hasPasswordField: extracted.structure.password_input > 0,
      html: extracted.html || null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ...empty,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Overlays a successful render onto the statically fetched state. */
export function applyRender(
  state: PageState,
  outcome: RenderOutcome,
): PageState {
  return {
    page: {
      ...state.page,
      title: outcome.title ?? state.page.title,
      description: outcome.description ?? state.page.description,
      site_name: outcome.siteName ?? state.page.site_name,
      author: outcome.author ?? state.page.author,
      content_type: outcome.contentType ?? state.page.content_type,
      text_excerpt: outcome.text ?? state.page.text_excerpt,
      structure: outcome.structure,
    },
    inspection: {
      ...state.inspection,
      has_password_field:
        outcome.hasPasswordField || state.inspection.has_password_field,
    },
  };
}
