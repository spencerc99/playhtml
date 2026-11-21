// ABOUTME: Exports the production documents table as stable, paginated NDJSON.
// ABOUTME: Usage: `bun partykit/scripts/export-documents.ts <output-path> [--resume-from <name>]`; the output path must be outside the repository, and resume mode appends rows after the given name to an existing export.

import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 500;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type DocumentRow = {
  name: string | null;
  document: string | null;
};

type CliOptions = {
  outputPath: string;
  resumeFrom?: string;
};

function usage(): string {
  return "Usage: bun partykit/scripts/export-documents.ts <output-path> [--resume-from <name>]";
}

function parseArgs(args: string[]): CliOptions {
  let outputArgument: string | undefined;
  let resumeFrom: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    }

    if (argument === "--resume-from") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--resume-from requires a name.");
      }
      resumeFrom = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--resume-from=")) {
      resumeFrom = argument.slice("--resume-from=".length);
      continue;
    }

    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}\n${usage()}`);
    }

    if (outputArgument !== undefined) {
      throw new Error(`Unexpected argument: ${argument}\n${usage()}`);
    }
    outputArgument = argument;
  }

  if (outputArgument === undefined) {
    throw new Error(`An output path is required.\n${usage()}`);
  }

  return {
    outputPath: resolve(process.cwd(), outputArgument),
    ...(resumeFrom === undefined ? {} : { resumeFrom }),
  };
}

function isInsideRepository(path: string): boolean {
  const pathFromRepository = relative(REPO_ROOT, path);
  return (
    pathFromRepository === "" ||
    (!pathFromRepository.startsWith(`..${sep}`) &&
      pathFromRepository !== ".." &&
      !isAbsolute(pathFromRepository))
  );
}

async function countExistingRows(path: string): Promise<number> {
  let rows = 0;
  for await (const chunk of createReadStream(path)) {
    for (const byte of chunk) {
      if (byte === 10) {
        rows += 1;
      }
    }
  }
  return rows;
}

async function assertExistingExportEndsWithNewline(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    const information = await file.stat();
    if (information.size === 0) {
      throw new Error("Cannot resume into an empty output file.");
    }

    const buffer = Buffer.alloc(1);
    await file.read(buffer, 0, 1, information.size - 1);
    if (buffer[0] !== 10) {
      throw new Error("Cannot resume: the existing output does not end with a newline.");
    }
  } finally {
    await file.close();
  }
}

async function main(): Promise<void> {
  const { outputPath, resumeFrom } = parseArgs(process.argv.slice(2));

  if (isInsideRepository(outputPath)) {
    throw new Error(
      `Refusing to write inside the repository: ${outputPath}\nChoose a path outside ${REPO_ROOT}.`,
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  let totalRows = 0;
  let totalBytes = 0;
  if (resumeFrom !== undefined) {
    try {
      await stat(outputPath);
    } catch {
      throw new Error(
        `Cannot resume: output file does not exist: ${outputPath}`,
      );
    }
    await assertExistingExportEndsWithNewline(outputPath);
    totalRows = await countExistingRows(outputPath);
    totalBytes = (await stat(outputPath)).size;
  }

  const output = await open(outputPath, resumeFrom === undefined ? "wx" : "a");
  let batchStart = 0;

  try {
    while (true) {
      let query = supabase
        .from("documents")
        .select("name, document")
        .order("name", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true });

      if (resumeFrom !== undefined) {
        query = query.gt("name", resumeFrom);
      }

      const { data, error } = await query.range(
        batchStart,
        batchStart + BATCH_SIZE - 1,
      );
      if (error) {
        throw new Error(`Failed to fetch documents: ${error.message}`);
      }

      const rows = (data ?? []) as DocumentRow[];
      if (rows.length === 0) {
        break;
      }

      const outputBatch = rows
        .map((row) => `${JSON.stringify({ name: row.name, document: row.document })}\n`)
        .join("");
      await output.write(outputBatch);

      const batchBytes = Buffer.byteLength(outputBatch, "utf8");
      totalRows += rows.length;
      totalBytes += batchBytes;
      const lastName = rows[rows.length - 1]?.name ?? "<null>";
      console.log(
        `Exported batch: rows=${rows.length} totalRows=${totalRows} totalBytes=${totalBytes} lastName=${JSON.stringify(lastName)}`,
      );

      batchStart += rows.length;
      if (rows.length < BATCH_SIZE) {
        break;
      }
    }
  } finally {
    await output.close();
  }

  const { count, error: countError } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true });
  if (countError) {
    throw new Error(`Failed to count documents: ${countError.message}`);
  }
  if (count === null) {
    throw new Error("Supabase did not return a documents row count.");
  }

  console.log(`Export complete: rows=${totalRows} totalBytes=${totalBytes}`);
  if (totalRows !== count) {
    throw new Error(
      `Export row count mismatch: exported ${totalRows}, database has ${count}.`,
    );
  }
  console.log(`Verified row count: ${count}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
