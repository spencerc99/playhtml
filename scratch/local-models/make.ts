// ABOUTME: "Make" benchmark: asks each model for a single-file playhtml page per task, with and without the agent guide.
// ABOUTME: bun scratch/local-models/make.ts <outDir> <target...>   (targets as in animate/eval/run.ts)

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const TASKS: { id: string; prompt: string }[] = [
  { id: "lamp", prompt: "Make a lamp anyone can switch on and off. Everyone visiting sees the same state." },
  { id: "sticker", prompt: "Make a sticker anyone can drag around the page. Everyone sees where it was left." },
  { id: "counter", prompt: "Make a visitor counter that counts every visit to the page." },
  { id: "guestbook", prompt: "Make a guestbook where visitors leave a name and a short message." },
  { id: "reactions", prompt: "Make a row of reaction buttons with live counts that everyone shares." },
  { id: "stickers", prompt: "Make shared stickers: pick from a few simple shapes, place them on the page, and anyone can drag them around." },
  { id: "whos-here", prompt: "Show who is on the page right now, with each person's name and color." },
];

const RULES = [
  "You write small web pages with playhtml (https://playhtml.fun), a library that makes HTML elements shared and live for everyone visiting.",
  "Load it from https://unpkg.com/playhtml@latest as shown in the guide if you have one.",
  "Reply with one complete HTML file in a single ```html code block and nothing else.",
  "Don't ask questions; make simple, reasonable choices and keep styling light.",
].join("\n");

const root = resolve(import.meta.dir, "../..");
const GUIDE = readFileSync(join(root, "claude-plugin/skills/building-playhtml-elements/SKILL.md"), "utf8");

function systemFor(withGuide: boolean) {
  return withGuide ? `${RULES}\n\nHere is the playhtml guide:\n\n${GUIDE}` : RULES;
}

async function callOpenAI(url: string, model: string, system: string, prompt: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 6000,
    }),
  });
  const json: any = await res.json();
  return {
    raw: String(json?.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 500)),
    usage: json?.usage,
    timings: json?.timings,
  };
}

function callClaude(model: string | undefined, system: string, prompt: string) {
  const args = ["-p", `${system}\n\n---\n\n${prompt}`, "--setting-sources", "project", "--tools", ""];
  if (model) args.push("--model", model);
  const r = spawnSync("claude", args, { encoding: "utf8", timeout: 300_000, maxBuffer: 1 << 24 });
  return { raw: r.stdout || r.stderr, usage: undefined, timings: undefined };
}

export function extractHtml(raw: string): string | null {
  const fence = raw.match(/```html\s*([\s\S]*?)```/i) || raw.match(/```\s*(<!doctype[\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const i = raw.search(/<!doctype html|<html/i);
  return i >= 0 ? raw.slice(i).trim() : null;
}

const CAP_ATTRS = ["can-move", "can-spin", "can-toggle", "can-grow", "can-duplicate", "can-mirror", "can-play", "can-hover", "can-post"];
const FAKE_APIS = ["setupCustomElement", "playhtml.create(", "playhtml.connect(", "new PlayHTML", "playhtml.on("];

export function staticChecks(html: string | null) {
  if (!html) return { hasHtml: false } as Record<string, unknown>;
  const loadsPlayhtml = /unpkg\.com\/playhtml|from\s+["']playhtml["']|cdn\.jsdelivr\.net\/npm\/playhtml/.test(html);
  const callsInit = /playhtml\.init\s*\(/.test(html);
  const tags = [...html.matchAll(/<([a-z0-9-]+)\b([^>]*)>/gi)];
  const capEls = tags.filter((t) => CAP_ATTRS.some((a) => new RegExp(`\\s${a}(\\s|=|>|$)`).test(t[2] + ">")));
  const capElsWithoutId = capEls.filter((t) => !/\sid\s*=/.test(t[2])).length;
  const registers = (html.match(/playhtml\.register\s*\(/g) || []).length;
  const usesPeople = /playhtml\.people|playhtml\.presence|setMyPresence|usePeople/.test(html);
  const fakeApis = FAKE_APIS.filter((f) => html.includes(f));
  return {
    hasHtml: true,
    bytes: html.length,
    loadsPlayhtml,
    callsInit,
    capabilityElements: capEls.length,
    capElsWithoutId,
    registers,
    usesPeople,
    fakeApis,
  };
}

if (import.meta.main) {
  const [outDir, ...targets] = process.argv.slice(2);
  const runs = Number(process.env.RUNS || 1);
  const conditions = (process.env.CONDITIONS || "guide,none").split(",");
  if (!outDir || targets.length === 0) {
    console.error("usage: make.ts <outDir> <target...>");
    process.exit(1);
  }
  const summaryPath = join(outDir, "results.json");
  const all: any[] = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : [];
  for (const t of targets) {
    const [name, rest] = t.includes("=") ? t.split(/=(.*)/s) : [t, ""];
    for (const cond of conditions) {
      for (const task of TASKS) {
        for (let run = 1; run <= runs; run++) {
          const dir = join(outDir, name, cond);
          mkdirSync(dir, { recursive: true });
          const base = join(dir, `${task.id}-${run}`);
          if (existsSync(`${base}.json`)) continue; // resumable
          const started = Date.now();
          let out;
          try {
            out = name.startsWith("claude")
              ? callClaude(name.split(":")[1], systemFor(cond === "guide"), task.prompt)
              : await callOpenAI(rest.split("#")[0], rest.split("#")[1] || "local", systemFor(cond === "guide"), task.prompt);
          } catch (err) {
            out = { raw: `ERROR ${(err as Error).message}`, usage: undefined, timings: undefined };
          }
          const ms = Date.now() - started;
          const html = extractHtml(out.raw);
          writeFileSync(`${base}.raw.txt`, out.raw);
          if (html) writeFileSync(`${base}.html`, html);
          const row = { target: name, condition: cond, task: task.id, run, ms, usage: out.usage, timings: out.timings, ...staticChecks(html) };
          writeFileSync(`${base}.json`, JSON.stringify(row, null, 2));
          all.push(row);
          writeFileSync(summaryPath, JSON.stringify(all, null, 2));
          console.log(`${name.padEnd(16)} ${cond.padEnd(5)} ${task.id.padEnd(10)} ${String(Math.round(ms / 1000)).padStart(4)}s html=${row.hasHtml ? "y" : "n"} playhtml=${row.loadsPlayhtml ? "y" : "n"} init=${row.callsInit ? "y" : "n"} caps=${row.capabilityElements ?? 0} reg=${row.registers ?? 0} noId=${row.capElsWithoutId ?? 0} fake=${(row.fakeApis as string[] | undefined)?.join("|") || "-"}`);
        }
      }
    }
  }
}
