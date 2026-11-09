// ABOUTME: Builds the README contributors grid from git history, skipping bots and AI agents.
// ABOUTME: Run with --write to update README.md, or --check to fail when it is out of date.

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "spencerc99/playhtml";
const README_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "README.md",
);
const START_MARKER = "<!-- contributors:start -->";
const END_MARKER = "<!-- contributors:end -->";
const PER_ROW = 7;

// Emails GitHub can't map to an account on its own (a private email used only
// in a Co-authored-by trailer, for example). Add a line here when the script
// warns about an unresolved contributor.
export const EMAIL_TO_LOGIN = {
  "spencerc99@gmail.com": "spencerc99",
  "git@jessa0.com": "jessa0",
};

// Bots and coding agents. Matched against login, email, and name.
const BOT_EMAILS = [
  /@anthropic\.com$/i,
  /@cursor\.com$/i,
  /@openai\.com$/i,
  /\[bot\]@users\.noreply\.github\.com$/i,
  /^\d+\+copilot@users\.noreply\.github\.com$/i,
];
const BOT_LOGINS = [
  /\[bot\]$/i,
  /^(copilot|claude|cursoragent|codex|devin-ai-integration|dependabot|renovate|github-actions)$/i,
];
const BOT_NAMES = [
  /\[bot\]$/i,
  /^claude(\s+(opus|sonnet|haiku|fable|code)\b.*)?$/i,
  /^cursor(\s+agent)?$/i,
  /^(copilot|codex|devin|dependabot|renovate|github-actions)$/i,
];

export function isBot({ login, email, name }) {
  if (login && BOT_LOGINS.some((re) => re.test(login))) return true;
  if (email && BOT_EMAILS.some((re) => re.test(email))) return true;
  if (name && BOT_NAMES.some((re) => re.test(name.trim()))) return true;
  return false;
}

export function loginFromNoreply(email) {
  const match = /^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i.exec(
    email,
  );
  return match ? match[1] : null;
}

const FIELD = "\x1f";
const RECORD = "\x1e";

// One record per commit: sha, author name, author email, co-author trailers.
export function parseGitLog(raw) {
  const people = [];
  for (const record of raw.split(RECORD)) {
    const trimmed = record.replace(/^\n+/, "");
    if (!trimmed) continue;
    const [sha, name, email, trailers = ""] = trimmed.split(FIELD);
    people.push({ sha, name, email });
    for (const line of trailers.split("\n")) {
      const match = /^\s*(.+?)\s*<([^>]+)>\s*$/.exec(line);
      if (match)
        people.push({ sha, name: match[1], email: match[2], coAuthor: true });
    }
  }
  return people;
}

function readGitLog() {
  return execFileSync(
    "git",
    [
      "log",
      "--reverse",
      `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%(trailers:key=Co-authored-by,valueonly)${RECORD}`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

async function github(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  // 404/422 mean "no such commit or user"; anything else (rate limit, outage)
  // would silently drop real people from the grid, so stop instead.
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${path}. Set GITHUB_TOKEN and retry.`);
  }
  return res.json();
}

async function resolveLogin({ email, sha, coAuthor }) {
  const known = EMAIL_TO_LOGIN[email.toLowerCase()] ?? loginFromNoreply(email);
  if (known) return known;
  if (!coAuthor) {
    const commit = await github(`repos/${REPO}/commits/${sha}`);
    if (commit?.author?.type === "Bot") return { bot: true };
    if (commit?.author?.login) return commit.author.login;
  }
  const search = await github(
    `search/users?q=${encodeURIComponent(`${email} in:email`)}`,
  );
  if (search?.items?.length === 1) return search.items[0].login;
  return null;
}

// Groups commit entries by GitHub login. Commit count decides order, and the
// earliest contribution breaks ties so newer folks land after older ones.
export async function collectContributors(entries, resolve = resolveLogin) {
  const byEmail = new Map();
  entries.forEach((entry, index) => {
    if (isBot(entry)) return;
    const key = entry.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.commits.add(entry.sha);
      existing.names.set(entry.name, (existing.names.get(entry.name) ?? 0) + 1);
    } else {
      byEmail.set(key, {
        ...entry,
        first: index,
        commits: new Set([entry.sha]),
        names: new Map([[entry.name, 1]]),
      });
    }
  });

  const byLogin = new Map();
  const unresolved = [];
  for (const person of byEmail.values()) {
    const login = await resolve(person);
    if (login && typeof login === "object") continue;
    if (!login) {
      unresolved.push(`${person.name} <${person.email}>`);
      continue;
    }
    if (isBot({ login })) continue;
    const key = login.toLowerCase();
    const existing = byLogin.get(key);
    if (existing) {
      for (const sha of person.commits) existing.commits.add(sha);
      for (const [n, c] of person.names)
        existing.names.set(n, (existing.names.get(n) ?? 0) + c);
      existing.first = Math.min(existing.first, person.first);
    } else {
      byLogin.set(key, {
        login,
        first: person.first,
        commits: new Set(person.commits),
        names: new Map(person.names),
      });
    }
  }

  const contributors = [...byLogin.values()]
    .map((p) => ({
      login: p.login,
      name: [...p.names].sort((a, b) => b[1] - a[1])[0][0],
      commits: p.commits.size,
      first: p.first,
    }))
    .sort((a, b) => b.commits - a.commits || a.first - b.first);
  return { contributors, unresolved };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderGrid(contributors) {
  const rows = [];
  for (let i = 0; i < contributors.length; i += PER_ROW) {
    const cells = contributors.slice(i, i + PER_ROW).map(({ login, name }) => {
      const href = `https://github.com/${login}`;
      return [
        `    <td align="center" valign="top" width="${Math.floor(100 / PER_ROW)}%">`,
        `      <a href="${href}"><img src="${href}.png?size=128" width="64" height="64" alt="${escapeHtml(login)}" /><br /><sub><b>${escapeHtml(name)}</b></sub></a>`,
        `    </td>`,
      ].join("\n");
    });
    rows.push(`  <tr>\n${cells.join("\n")}\n  </tr>`);
  }
  return [
    START_MARKER,
    "<!-- Generated by scripts/update-contributors.mjs. Edit that script, not this block. -->",
    "<table>",
    ...rows,
    "</table>",
    END_MARKER,
  ].join("\n");
}

export function replaceBlock(readme, block) {
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `README.md needs ${START_MARKER} and ${END_MARKER} markers`,
    );
  }
  return readme.slice(0, start) + block + readme.slice(end + END_MARKER.length);
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error(
      "Usage: node scripts/update-contributors.mjs --write | --check",
    );
    process.exit(2);
  }
  const { contributors, unresolved } = await collectContributors(
    parseGitLog(readGitLog()),
  );
  for (const who of unresolved) {
    console.warn(
      `Could not find a GitHub account for ${who}. Add it to EMAIL_TO_LOGIN if it's a person.`,
    );
  }
  const readme = await readFile(README_PATH, "utf8");
  const next = replaceBlock(readme, renderGrid(contributors));
  console.log(
    `${contributors.length} contributors: ${contributors.map((c) => c.login).join(", ")}`,
  );
  if (next === readme) return;
  if (mode === "--check") {
    console.error(
      "README contributors are out of date. Run: bun run contributors",
    );
    process.exit(1);
  }
  await writeFile(README_PATH, next);
  console.log("Updated README.md");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
