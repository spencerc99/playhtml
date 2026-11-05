// ABOUTME: Eval harness for animate: runs the same prompt over saved element fixtures against several models.
// ABOUTME: bun run extension/src/features/social/animate/eval/run.ts <fixturesDir> <outFile> <target...>

// A fixture is a folder with desc.json (ElementDescription plus "good": OfferId[]) and crop.jpg.
// A target is "name=http://host/v1/chat/completions[#model]" for OpenAI-compatible servers,
// or "claude" / "claude:<model>" to use the local Claude Code CLI as the frontier baseline.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildMessages,
  describeForPrompt,
  parseSuggestions,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
} from "../prompt";

const [fixturesDir, outFile, ...targets] = process.argv.slice(2);
if (!fixturesDir || !outFile || targets.length === 0) {
  console.error("usage: run.ts <fixturesDir> <outFile> <target...>");
  process.exit(1);
}
const constrain = process.env.CONSTRAIN !== "0";

const fixtures = readdirSync(fixturesDir)
  .filter((d) => existsSync(join(fixturesDir, d, "desc.json")))
  .map((id) => {
    const dir = join(fixturesDir, id);
    const desc = JSON.parse(readFileSync(join(dir, "desc.json"), "utf8"));
    const cropPath = join(dir, "crop.jpg");
    const image = existsSync(cropPath)
      ? `data:image/jpeg;base64,${readFileSync(cropPath).toString("base64")}`
      : undefined;
    return {
      id,
      desc,
      image,
      cropPath: existsSync(cropPath) ? cropPath : undefined,
    };
  });

async function callOpenAI(
  url: string,
  model: string,
  f: (typeof fixtures)[number],
) {
  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(f.desc, f.image),
    temperature: 0.2,
    max_tokens: 400,
  };
  if (constrain)
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "suggestions", schema: RESPONSE_SCHEMA },
    };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  return {
    raw: String(
      json?.choices?.[0]?.message?.content ??
        JSON.stringify(json).slice(0, 300),
    ),
    tokens: json?.usage,
  };
}

function callClaude(model: string | undefined, f: (typeof fixtures)[number]) {
  const prompt = `${SYSTEM_PROMPT}\n\n${describeForPrompt(f.desc)}\n\n${f.cropPath ? `The picture of the element is at ${f.cropPath}. Read it first.` : ""}\nReply with the JSON only.`;
  const args = [
    "-p",
    prompt,
    "--allowedTools",
    "Read",
    "--setting-sources",
    "project",
  ];
  if (model) args.push("--model", model);
  const r = spawnSync("claude", args, { encoding: "utf8", timeout: 180_000 });
  return { raw: r.stdout || r.stderr, tokens: undefined };
}

const results: any[] = [];
for (const t of targets) {
  const [name, rest] = t.includes("=") ? t.split(/=(.*)/s) : [t, ""];
  for (const f of fixtures) {
    const started = Date.now();
    let out: { raw: string; tokens?: unknown };
    try {
      if (name.startsWith("claude")) out = callClaude(name.split(":")[1], f);
      else {
        const [url, model = "local"] = rest.split("#");
        out = await callOpenAI(url, model, f);
      }
    } catch (err) {
      out = { raw: `ERROR ${(err as Error).message}` };
    }
    const ms = Date.now() - started;
    const { result, problems } = parseSuggestions(out.raw);
    const good: string[] = f.desc.good ?? [];
    const offers = result?.suggestions.map((s) => s.offer) ?? [];
    const row = {
      target: name,
      fixture: f.id,
      ms,
      ok: !!result,
      problems,
      thing: result?.thing,
      offers,
      lines: result?.suggestions.map((s) => s.line),
      topFits: offers.length > 0 && good.includes(offers[0]),
      fitCount: offers.filter((o) => good.includes(o)).length,
      raw: out.raw.slice(0, 600),
    };
    results.push(row);
    console.log(
      `${name.padEnd(14)} ${f.id.padEnd(18)} ${String(ms).padStart(6)}ms ${row.ok ? "ok " : "BAD"} top-fit=${row.topFits ? "y" : "n"} ${offers.join(",")} ${row.thing ?? problems.join("; ")}`,
    );
  }
}
writeFileSync(outFile, JSON.stringify(results, null, 2));

const byTarget = new Map<string, any[]>();
for (const r of results)
  byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r]);
console.log("\ntarget          valid  top-fit  avg-fit  median-ms");
for (const [t, rows] of byTarget) {
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    `${t.padEnd(15)} ${String(rows.filter((r) => r.ok).length).padStart(2)}/${rows.length}  ${String(rows.filter((r) => r.topFits).length).padStart(3)}/${rows.length}  ${(rows.reduce((a, r) => a + r.fitCount, 0) / rows.length).toFixed(2).padStart(6)}  ${String(ms[Math.floor(ms.length / 2)]).padStart(8)}`,
  );
}
