// ABOUTME: Dev-server endpoints for the quest lab: remembers the scraps export path and asks Clef questions.
// ABOUTME: Keeps the Cloudflare token on the server and caches every Clef answer on disk.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";

const LAB_DIR = path.dirname(new URL(import.meta.url).pathname);
const DATA_DIR = path.join(LAB_DIR, ".lab-data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ANSWERS_FILE = path.join(DATA_DIR, "answers.json");
const EXPORT_FORMAT = "wwo-scraps-export";
const CLEF_MODELS = ["clef-flash", "clef"] as const;
type ClefModel = (typeof CLEF_MODELS)[number];

interface LabConfig {
  exportPath?: string;
}

interface ScrapsExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: number;
  days: number;
  scraps: unknown[];
  images: Record<string, string>;
}

function readJson<T>(file: string, empty: T): T {
  if (!fs.existsSync(file)) return empty;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function expandHome(input: string): string {
  return input.startsWith("~") ? path.join(os.homedir(), input.slice(1)) : input;
}

/**
 * The export file a remembered path points at. A folder means "the newest
 * export in it", so re-exporting into Downloads never needs the path changed.
 */
function resolveExportFile(remembered: string): string {
  const target = path.resolve(expandHome(remembered.trim()));
  if (!fs.existsSync(target)) throw new Error(`Nothing exists at ${target}`);
  if (!fs.statSync(target).isDirectory()) return target;
  const exports = fs
    .readdirSync(target)
    .filter((name) => /^wwo-scraps-export.*\.json$/.test(name))
    .map((name) => path.join(target, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (exports.length === 0) {
    throw new Error(`No wwo-scraps-export*.json file in ${target}`);
  }
  return exports[0];
}

let loaded: { file: string; mtimeMs: number; data: ScrapsExport } | null = null;

const sourcesByExport = new WeakMap<ScrapsExport, Set<string>>();

/** Every image link in an export, so the image route serves only those. */
function imageSources(data: ScrapsExport): Set<string> {
  let sources = sourcesByExport.get(data);
  if (!sources) {
    sources = new Set(
      data.scraps.flatMap((scrap) => {
        const { kind, src } = scrap as { kind?: string; src?: string };
        return kind === "image" && src ? [src] : [];
      }),
    );
    sourcesByExport.set(data, sources);
  }
  return sources;
}

function loadExport(): { file: string; data: ScrapsExport } {
  const config = readJson<LabConfig>(CONFIG_FILE, {});
  if (!config.exportPath) throw new Error("No export path is set yet");
  const file = resolveExportFile(config.exportPath);
  const { mtimeMs } = fs.statSync(file);
  if (loaded && loaded.file === file && loaded.mtimeMs === mtimeMs) return loaded;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ScrapsExport>;
  let data: ScrapsExport;
  if (parsed.format === EXPORT_FORMAT) {
    if (parsed.version !== 1) throw new Error(`${file} is a version ${parsed.version} scraps export`);
    data = parsed as ScrapsExport;
  } else if (Array.isArray(parsed.scraps)) {
    // A bare { scraps } list, such as an earlier scraps download: links only,
    // so every image is fetched from where it was found.
    const times = parsed.scraps.map((scrap) => (scrap as { ts: number }).ts);
    data = {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: mtimeMs,
      days: Math.ceil((Math.max(...times) - Math.min(...times)) / 86_400_000),
      scraps: parsed.scraps,
      images: {},
    };
  } else {
    throw new Error(`${file} holds neither a scraps export nor a { scraps } list`);
  }
  loaded = { file, mtimeMs, data };
  return loaded;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

interface AskBody {
  model: ClefModel;
  state: unknown;
  questions: Record<string, unknown>;
  /** Base64 data URLs, already downscaled by the page. */
  images: string[];
}

function isAskBody(value: unknown): value is AskBody {
  const body = value as AskBody;
  return (
    !!body &&
    CLEF_MODELS.includes(body.model) &&
    typeof body.questions === "object" &&
    Array.isArray(body.images) &&
    body.images.length <= 4
  );
}

export function questLabServer(): Plugin {
  let env: Record<string, string> = {};
  let answers: Record<string, unknown> = {};
  const usage = { requests: 0, cached: 0, inputTokens: 0 };

  async function askClef(body: AskBody): Promise<unknown> {
    const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    if (answers[key]) {
      usage.cached += 1;
      return answers[key];
    }
    const account = env.CLOUDFLARE_ACCOUNT_ID;
    const token = env.CLOUDFLARE_API_TOKEN;
    if (!account || !token) {
      throw new Error(
        "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in extension/website/.env.local",
      );
    }
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${body.model}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: body.model,
          state: body.state,
          questions: body.questions,
          ...(body.images.length > 0 ? { images: body.images } : {}),
        }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Clef answered ${response.status}: ${text.slice(0, 500)}`);
    }
    const parsed = JSON.parse(text) as {
      result?: { answers?: unknown; usage?: { input_tokens: number } };
      answers?: unknown;
      usage?: { input_tokens: number };
    };
    // The REST API wraps model output in { result }; accept a bare body too.
    const result = parsed.result ?? parsed;
    if (!result.answers) {
      throw new Error(`Clef returned no answers: ${text.slice(0, 500)}`);
    }
    usage.requests += 1;
    usage.inputTokens += result.usage?.input_tokens ?? 0;
    answers[key] = result.answers;
    writeJson(ANSWERS_FILE, answers);
    return result.answers;
  }

  return {
    name: "quest-lab-server",
    apply: "serve",
    configureServer(server) {
      env = loadEnv(server.config.mode, server.config.envDir || server.config.root, "");
      answers = readJson<Record<string, unknown>>(ANSWERS_FILE, {});

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://lab");
        if (!url.pathname.startsWith("/api/quest-lab/")) return next();
        const route = url.pathname.slice("/api/quest-lab/".length);
        try {
          if (route === "config" && req.method === "GET") {
            const config = readJson<LabConfig>(CONFIG_FILE, {});
            return send(res, 200, {
              exportPath: config.exportPath ?? null,
              clefReady: !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
              usage,
            });
          }
          if (route === "config" && req.method === "POST") {
            const { exportPath } = (await readBody(req)) as { exportPath: string };
            const file = resolveExportFile(exportPath);
            writeJson(CONFIG_FILE, { exportPath } satisfies LabConfig);
            return send(res, 200, { exportPath, file });
          }
          if (route === "scraps" && req.method === "GET") {
            const { file, data } = loadExport();
            return send(res, 200, {
              file,
              exportedAt: data.exportedAt,
              days: data.days,
              scraps: data.scraps,
              copied: Object.keys(data.images),
            });
          }
          if (route === "image" && req.method === "GET") {
            const src = url.searchParams.get("src");
            if (!src) return send(res, 400, { error: "src is required" });
            const { data } = loadExport();
            // Only images the export actually holds are served, so this never proxies arbitrary URLs.
            const known = imageSources(data).has(src);
            if (!known) {
              return send(res, 404, { error: "Not an image in the loaded export" });
            }
            const copy = data.images[src] ?? (src.startsWith("data:image/") ? src : undefined);
            if (copy) {
              const match = /^data:([^;]+);base64,(.*)$/.exec(copy);
              if (!match) throw new Error(`Image copy for ${src} is not a data URL`);
              res.setHeader("content-type", match[1]);
              res.setHeader("cache-control", "max-age=31536000");
              return res.end(Buffer.from(match[2], "base64"));
            }
            if (!/^https?:\/\//.test(src)) return send(res, 404, { error: "No copy, and not a web URL" });
            // No local copy: fetch it here, where the page's CORS rules do not apply.
            const upstream = await fetch(src, {
              signal: AbortSignal.timeout(15_000),
              // Some image hosts refuse requests that do not look like a browser.
              headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" },
            });
            if (!upstream.ok) return send(res, 502, { error: `Fetching ${src} gave ${upstream.status}` });
            res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
            res.setHeader("cache-control", "max-age=31536000");
            return res.end(Buffer.from(await upstream.arrayBuffer()));
          }
          if (route === "ask" && req.method === "POST") {
            const body = await readBody(req);
            if (!isAskBody(body)) return send(res, 400, { error: "Malformed ask request" });
            return send(res, 200, { answers: await askClef(body), usage });
          }
          return send(res, 404, { error: `No route ${req.method} ${route}` });
        } catch (error) {
          return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
