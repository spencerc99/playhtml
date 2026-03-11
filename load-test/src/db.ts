// ABOUTME: SQLite persistence for load test run history using bun:sqlite.
// ABOUTME: Stores run summaries and per-snapshot metrics for historical comparison.

import { Database } from "bun:sqlite";
import type { RunSummary, LatencySnapshot } from "./metrics.js";

const DB_PATH = new URL("../../data/runs.db", import.meta.url).pathname;

function openDb(): Database {
  // Ensure data dir exists
  const dataDir = new URL("../../data", import.meta.url).pathname;
  Bun.spawnSync(["mkdir", "-p", dataDir]);

  const db = new Database(DB_PATH, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      scenario TEXT NOT NULL,
      target TEXT NOT NULL,
      git_commit TEXT,
      timestamp INTEGER NOT NULL,
      params TEXT NOT NULL,
      summary TEXT NOT NULL,
      degradation_user_count INTEGER,
      hard_limit_user_count INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      run_id TEXT NOT NULL,
      user_count INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      metrics TEXT NOT NULL
    )
  `);
  return db;
}

export interface RunRecord {
  id: string;
  scenario: string;
  target: string;
  gitCommit: string | null;
  timestamp: number;
  params: Record<string, unknown>;
  summary: RunSummary;
}

function getGitCommit(): string | null {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
    return new TextDecoder().decode(result.stdout).trim() || null;
  } catch {
    return null;
  }
}

export function saveRun(
  id: string,
  scenario: string,
  target: string,
  params: Record<string, unknown>,
  summary: RunSummary
): void {
  const db = openDb();
  const gitCommit = getGitCommit();

  db.run(
    `INSERT INTO runs (id, scenario, target, git_commit, timestamp, params, summary, degradation_user_count, hard_limit_user_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      scenario,
      target,
      gitCommit,
      Date.now(),
      JSON.stringify(params),
      JSON.stringify(summary),
      summary.degradationUserCount ?? null,
      summary.hardLimitUserCount ?? null,
    ]
  );

  const insertSnap = db.prepare(
    `INSERT INTO snapshots (run_id, user_count, timestamp, metrics) VALUES (?, ?, ?, ?)`
  );
  for (const snap of summary.snapshots) {
    insertSnap.run(id, snap.userCount, snap.timestamp, JSON.stringify(snap));
  }

  db.close();
}

export function listRuns(filter?: { scenario?: string; target?: string; limit?: number }): RunRecord[] {
  const db = openDb();
  let query = `SELECT * FROM runs`;
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (filter?.scenario) {
    conditions.push(`scenario = ?`);
    args.push(filter.scenario);
  }
  if (filter?.target) {
    conditions.push(`target = ?`);
    args.push(filter.target);
  }
  if (conditions.length) query += ` WHERE ` + conditions.join(" AND ");
  query += ` ORDER BY timestamp DESC`;
  if (filter?.limit) {
    query += ` LIMIT ?`;
    args.push(filter.limit);
  }

  const rows = db.query(query).all(...args) as Array<Record<string, unknown>>;
  db.close();

  return rows.map((r) => ({
    id: r.id as string,
    scenario: r.scenario as string,
    target: r.target as string,
    gitCommit: r.git_commit as string | null,
    timestamp: r.timestamp as number,
    params: JSON.parse(r.params as string),
    summary: JSON.parse(r.summary as string) as RunSummary,
  }));
}

export function getRun(id: string): RunRecord | null {
  const db = openDb();
  const row = db.query(`SELECT * FROM runs WHERE id = ?`).get(id) as Record<string, unknown> | null;
  db.close();
  if (!row) return null;
  return {
    id: row.id as string,
    scenario: row.scenario as string,
    target: row.target as string,
    gitCommit: row.git_commit as string | null,
    timestamp: row.timestamp as number,
    params: JSON.parse(row.params as string),
    summary: JSON.parse(row.summary as string) as RunSummary,
  };
}
