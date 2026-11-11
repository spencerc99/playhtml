// ABOUTME: In-memory stand-in for the Supabase REST API that the local PartyKit server talks to.
// ABOUTME: Serves the exported snapshot for local rooms with the same path; writes stay in memory.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export function startFakeDb({ port, snapshotPath, log = console.log }) {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  // "playhtml.fun-%2F" -> "-%2F": any local host with the same path gets the copy.
  const roomSuffix = snapshot.room.slice(snapshot.room.indexOf("-"));
  const isLocalHost = (name) => /^(localhost|127\.0\.0\.1)/.test(name);

  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  function seedIfSnapshotRoom(name) {
    const documents = table("documents");
    if (documents.has(name)) return;
    if (!isLocalHost(name) || !name.endsWith(roomSuffix)) return;
    documents.set(name, {
      id: randomUUID(),
      name,
      document: snapshot.document,
      created_at: new Date().toISOString(),
    });
    log(`loaded snapshot into ${name}`);
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
    });

  const server = createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    const url = new URL(req.url, "http://localhost");
    const match = url.pathname.match(/^\/rest\/v1\/([^/]+)/);
    if (!match) return json(404, { message: "not found" });
    const rows = table(match[1]);
    const filters = [...url.searchParams].filter(
      ([key]) => !["select", "on_conflict", "limit", "order"].includes(key),
    );
    // searchParams already decoded the value once; room names stay %-encoded.
    const eq = (key) =>
      filters.find(([k, v]) => k === key && v.startsWith("eq."))?.[1].slice(3);
    const matches = (row) =>
      filters.every(([k, v]) =>
        v.startsWith("eq.") ? String(row[k]) === v.slice(3) : true,
      );
    const select = url.searchParams.get("select");
    const project = (row) => {
      if (!select || select === "*") return row;
      const picked = {};
      for (const column of select.split(",")) {
        picked[column.trim()] = row[column.trim()] ?? null;
      }
      return picked;
    };
    const single = (req.headers.accept ?? "").includes("pgrst.object");
    const reply = (found) => {
      if (!single) return json(200, found);
      return found.length === 1
        ? json(200, found[0])
        : json(406, { code: "PGRST116", message: "no rows" });
    };

    if (req.method === "GET" || req.method === "HEAD") {
      const name = eq("name");
      if (match[1] === "documents" && name) seedIfSnapshotRoom(name);
      return reply([...rows.values()].filter(matches).map(project));
    }
    if (req.method === "POST" || req.method === "PATCH") {
      const body = await readBody(req);
      const incoming = Array.isArray(body) ? body : [body];
      const saved = incoming.map((row) => {
        const key = String(row.name ?? row.id ?? randomUUID());
        const next = { ...(rows.get(key) ?? {}), ...row };
        rows.set(key, next);
        return project(next);
      });
      const wantsRows =
        (req.headers.prefer ?? "").includes("return=representation") || select;
      return wantsRows ? reply(saved) : json(201);
    }
    if (req.method === "DELETE") {
      for (const [key, row] of rows) if (matches(row)) rows.delete(key);
      return json(204);
    }
    return json(400, { message: "unsupported" });
  });

  return new Promise((resolve) =>
    server.listen(Number(port), "127.0.0.1", () => resolve(server)),
  );
}
