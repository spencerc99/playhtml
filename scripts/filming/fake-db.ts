// ABOUTME: In-memory stand-in for the Supabase REST API that the local PartyKit server talks to.
// ABOUTME: Serves the exported snapshot for local rooms with the same path; writes stay in memory.

import { readFileSync } from "node:fs";

type Snapshot = { room: string; document: string };

const port = Number(process.env.FILMING_DB_PORT ?? 54398);
const snapshotPath = process.env.FILMING_SNAPSHOT!;
const snapshot: Snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
// "playhtml.fun-%2F" -> "-%2F": any local host with the same path gets the copy.
const roomSuffix = snapshot.room.slice(snapshot.room.indexOf("-"));
const isLocalHost = (name: string) => /^(localhost|127\.0\.0\.1)/.test(name);

const tables = new Map<string, Map<string, Record<string, unknown>>>();
function table(name: string) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name)!;
}

function seedIfSnapshotRoom(name: string) {
  const documents = table("documents");
  if (documents.has(name)) return;
  if (!isLocalHost(name) || !name.endsWith(roomSuffix)) return;
  documents.set(name, {
    id: crypto.randomUUID(),
    name,
    document: snapshot.document,
    created_at: new Date().toISOString(),
  });
  console.log(`[filming db] loaded snapshot into ${name}`);
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const match = url.pathname.match(/^\/rest\/v1\/([^/]+)/);
    if (!match) return new Response("not found", { status: 404 });
    const rows = table(match[1]);
    const filters = [...url.searchParams].filter(
      ([key]) => !["select", "on_conflict", "limit", "order"].includes(key),
    );
    // searchParams already decoded the value once; room names stay %-encoded.
    const eq = (key: string) =>
      filters.find(([k, v]) => k === key && v.startsWith("eq."))?.[1].slice(3);
    const matches = (row: Record<string, unknown>) =>
      filters.every(([k, v]) =>
        v.startsWith("eq.") ? String(row[k]) === v.slice(3) : true,
      );
    const select = url.searchParams.get("select");
    const project = (row: Record<string, unknown>) => {
      if (!select || select === "*") return row;
      const picked: Record<string, unknown> = {};
      for (const column of select.split(",")) {
        picked[column.trim()] = row[column.trim()] ?? null;
      }
      return picked;
    };
    const single = (req.headers.get("accept") ?? "").includes("pgrst.object");
    const reply = (found: Record<string, unknown>[]) => {
      if (!single) return Response.json(found);
      return found.length === 1
        ? Response.json(found[0])
        : Response.json(
            { code: "PGRST116", message: "no rows" },
            { status: 406 },
          );
    };

    if (req.method === "GET" || req.method === "HEAD") {
      const name = eq("name");
      if (match[1] === "documents" && name) seedIfSnapshotRoom(name);
      return reply([...rows.values()].filter(matches).map(project));
    }
    if (req.method === "POST" || req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const incoming = Array.isArray(body) ? body : [body];
      const saved = incoming.map((row: Record<string, unknown>) => {
        const key = String(row.name ?? row.id ?? crypto.randomUUID());
        const next = { ...(rows.get(key) ?? {}), ...row };
        rows.set(key, next);
        return project(next);
      });
      const wantsRows =
        (req.headers.get("prefer") ?? "").includes("return=representation") ||
        select;
      return wantsRows ? reply(saved) : new Response(null, { status: 201 });
    }
    if (req.method === "DELETE") {
      for (const [key, row] of rows) if (matches(row)) rows.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response("unsupported", { status: 400 });
  },
});

console.log(`[filming db] listening on ${port}, snapshot ${snapshot.room}`);
