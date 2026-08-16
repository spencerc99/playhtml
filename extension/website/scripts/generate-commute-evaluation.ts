// ABOUTME: Builds the commute evaluation dataset by streaming the private production database export.
// ABOUTME: Writes only policy-public sampled candidates and aggregate metrics to the browser artifact.

import { closeSync, createReadStream, createWriteStream, openSync, writeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { CommuteEvaluationBuilder, isSensitiveDestination, type AttentionEventName } from "../commute-audit/evaluationAnalysis";
import type { ExternalEvidence } from "../commute-audit/evaluationTypes";
import { scanProductionExport } from "./postgresCopy";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const defaultExportRoot = path.join(repositoryRoot, "private-data/production-db-exports");
const defaultEnrichmentPath = path.join(repositoryRoot, "private-data/commute-enrichment.json");
const defaultOutputPath = path.resolve(scriptDirectory, "../public/commute-evaluation-data.json");

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function newestArchive(): Promise<string> {
  const directories = (await readdir(defaultExportRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("playhtml-production-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const newest = directories[0];
  if (!newest) throw new Error(`No production export found under ${defaultExportRoot}`);
  return path.join(defaultExportRoot, newest, "data.sql.zst");
}

async function loadEnrichment(filePath: string): Promise<Map<string, ExternalEvidence>> {
  try {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as Record<string, ExternalEvidence>;
    return new Map(Object.entries(payload));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

async function sortAttention(inputPath: string, outputPath: string, temporaryDirectory: string): Promise<void> {
  const child = spawn("sort", ["-T", temporaryDirectory, "-t", "\t", "-k1,1n", "-k2,2n", "-k3,3", inputPath], {
    env: { ...process.env, LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const exitPromise = new Promise<number | null>((resolve) => child.once("close", resolve));
  await pipeline(child.stdout, createWriteStream(outputPath, { mode: 0o600 }));
  const exitCode = await exitPromise;
  if (exitCode !== 0) throw new Error(`sort exited with ${exitCode}: ${stderr.trim()}`);
}

async function applySortedAttention(filePath: string, builder: CommuteEvaluationBuilder): Promise<void> {
  const lines = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of lines) {
    const [sessionValue, timestampValue, kind, pageValue] = line.split("\t");
    const sessionId = Number(sessionValue);
    const ts = Number(timestampValue);
    const pageId = Number(pageValue);
    if (!Number.isInteger(sessionId) || !Number.isFinite(ts) || !Number.isInteger(pageId) || (kind !== "b" && kind !== "f")) {
      throw new Error("sorted attention file contains an invalid row");
    }
    builder.addOrderedAttention(sessionId, ts, kind === "f" ? "focus" : "blur", pageId);
  }
}

async function run(): Promise<void> {
  const inputPath = path.resolve(option("input") ?? await newestArchive());
  const outputPath = path.resolve(option("output") ?? defaultOutputPath);
  const enrichmentPath = path.resolve(option("enrichment") ?? defaultEnrichmentPath);
  const enrichment = await loadEnrichment(enrichmentPath);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "commute-evaluation-"));
  const attentionPath = path.join(temporaryDirectory, "attention.tsv");
  const sortedAttentionPath = path.join(temporaryDirectory, "attention-sorted.tsv");
  const attentionFile = openSync(attentionPath, "w", 0o600);
  let attentionBuffer = "";
  const flushAttention = (): void => {
    if (!attentionBuffer) return;
    writeSync(attentionFile, attentionBuffer);
    attentionBuffer = "";
  };
  const builder = new CommuteEvaluationBuilder((sessionId: number, ts: number, eventName: AttentionEventName, pageId: number) => {
    attentionBuffer += `${sessionId}\t${ts}\t${eventName === "focus" ? "f" : "b"}\t${pageId}\n`;
    if (attentionBuffer.length >= 1024 * 1024) flushAttention();
  });

  try {
    const scan = await scanProductionExport(inputPath, {
      onNavigation: (event) => builder.addNavigation(event),
      onMetadata: (metadata) => builder.addMetadata(metadata),
      onProgress: (summary) => {
        process.stdout.write(`\rScanned ${summary.collectionRows.toLocaleString()} event rows · ${summary.navigationRows.toLocaleString()} navigation · ${summary.metadataRows.toLocaleString()} metadata`);
      },
    });
    process.stdout.write("\n");
    flushAttention();
    closeSync(attentionFile);
    if (scan.parseFailures > 0) {
      throw new Error(`Export scan rejected ${scan.parseFailures.toLocaleString()} malformed COPY rows: ${scan.failureExamples.join("; ")}`);
    }

    console.log("Sorting attention records by session and timestamp...");
    await sortAttention(attentionPath, sortedAttentionPath, temporaryDirectory);
    console.log("Pairing focus and blur records in chronological order...");
    await applySortedAttention(sortedAttentionPath, builder);

    const sourceArchive = `${path.basename(path.dirname(inputPath))}/${path.basename(inputPath)}`;
    const data = builder.finalize(sourceArchive, scan, enrichment);
    if (data.candidates.some((candidate) => isSensitiveDestination(candidate.url, candidate.title))) {
      throw new Error("evaluation artifact contains a candidate rejected by the layered exposure policy");
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });

    console.log(`Wrote ${outputPath}`);
    console.log(JSON.stringify(data.summary, null, 2));
  } finally {
    try { closeSync(attentionFile); } catch { /* file was already closed */ }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await run();
