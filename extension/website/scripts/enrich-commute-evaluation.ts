// ABOUTME: Selects a bounded, domain-capped commute candidate set for public metadata enrichment.
// ABOUTME: Persists resumable evidence privately so repeated audit runs avoid duplicate requests.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommuteEvaluationData, EvaluationCandidate, ExternalEvidence } from "../commute-audit/evaluationTypes";
import { enrichPublicPage } from "./publicEnrichment";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const dataPath = path.join(repositoryRoot, "private-data/commute-evaluation-data.json");
const cachePath = path.join(repositoryRoot, "private-data/commute-enrichment.json");
const limit = Number(process.argv.find((argument) => argument.startsWith("--limit="))?.slice(8) ?? 120);
const concurrency = 4;

function priority(candidate: EvaluationCandidate): number {
  let value = candidate.scores.balanced;
  if (candidate.initialJudgment.value === "Uncertain") value += 40;
  if (candidate.lanes.includes("Hidden item on major platform")) value += 35;
  if (candidate.lanes.includes("Low classification confidence")) value += 25;
  if (candidate.lanes.includes("Rare page on rare domain")) value += 20;
  return value;
}

async function loadCache(): Promise<Record<string, ExternalEvidence>> {
  try { return JSON.parse(await readFile(cachePath, "utf8")) as Record<string, ExternalEvidence>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}

async function run(): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("--limit must be an integer from 1 to 500");
  const data = JSON.parse(await readFile(dataPath, "utf8")) as CommuteEvaluationData;
  const cache = await loadCache();
  await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const domainCounts = new Map<string, number>();
  const selected = [...data.candidates].sort((first, second) => priority(second) - priority(first)).filter((candidate) => {
    if (cache[candidate.url]) return false;
    const count = domainCounts.get(candidate.domain) ?? 0;
    if (count >= 4) return false;
    domainCounts.set(candidate.domain, count + 1);
    return true;
  }).slice(0, limit);

  let cursor = 0;
  let saving = Promise.resolve();
  async function worker(): Promise<void> {
    while (cursor < selected.length) {
      const candidate = selected[cursor++];
      cache[candidate.url] = await enrichPublicPage(candidate.url);
      saving = saving.then(() => writeFile(cachePath, `${JSON.stringify(cache)}\n`, { encoding: "utf8", mode: 0o600 }));
      await saving;
      process.stdout.write(`\rEnriched ${cursor.toLocaleString()} / ${selected.length.toLocaleString()} candidates`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));
  await writeFile(cachePath, `${JSON.stringify(cache)}\n`, { encoding: "utf8", mode: 0o600 });
  if (selected.length > 0) process.stdout.write("\n");
  await chmod(cachePath, 0o600);
  const values = Object.values(cache);
  console.log(`Cache contains ${values.length} rows: ${values.filter((row) => row.status === "available").length} available, ${values.filter((row) => row.status === "unavailable").length} unavailable, ${values.filter((row) => row.status === "failed").length} failed.`);
}

await run();
