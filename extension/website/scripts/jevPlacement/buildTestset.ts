// ABOUTME: Assembles the labeled placement test set from Spencer's human rows, the
// ABOUTME: worker's code lists, its policy fixtures, and the reserve catalog.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type TestsetSource =
  | "human"
  | "code-list"
  | "policy-fixture"
  | "reserve-catalog";

export type TestsetItem = {
  url: string;
  expected: string;
  source: TestsetSource;
  scope?: string;
  placeKey?: string;
  reason?: string | null;
  note?: string;
  title?: string | null;
  sourceCollection?: string;
  /** True for fixture hosts such as `garden.example` that cannot be fetched. */
  synthetic: boolean;
};

const SYNTHETIC_HOST_PATTERN =
  /(^|\.)(example|invalid|test|localhost)$|^localhost(:|$)|^jellyfin-local(:|$)/i;

export function isSyntheticUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return true;
    return SYNTHETIC_HOST_PATTERN.test(url.hostname);
  } catch {
    return true;
  }
}

export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * A human row names a page, a hostname, or a whole site. For the latter two the
 * spec evaluates the homepage, which is the page a rider would actually land on.
 */
export function humanRowToUrl(scope: string, placeKey: string): string {
  if (scope === "page") return placeKey;
  return `https://${placeKey}/`;
}

type HumanRow = {
  scope: string;
  place_key: string;
  placement: string;
  reason: string | null;
  note: string;
};

function readHumanRows(repoRoot: string): TestsetItem[] {
  const rows = JSON.parse(
    readFileSync(
      join(repoRoot, "internal-docs/jev-check/human-placements.json"),
      "utf8",
    ),
  ) as HumanRow[];

  return rows.map((row) => {
    const url = humanRowToUrl(row.scope, row.place_key);
    return {
      url,
      expected: row.placement,
      source: "human" as const,
      scope: row.scope,
      placeKey: row.place_key,
      reason: row.reason,
      note: row.note,
      synthetic: isSyntheticUrl(url),
    };
  });
}

/**
 * Pulls the named string-literal arrays out of the worker's policy source. These
 * lists are the code's own statement that a domain is scenery only.
 */
export function extractDomainList(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name} = [`);
  if (start === -1) throw new Error(`domain list ${name} not found`);
  const open = source.indexOf("[", start);
  const end = source.indexOf("];", open);
  if (end === -1) throw new Error(`domain list ${name} is unterminated`);
  const body = source.slice(open + 1, end);
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const CODE_LIST_NAMES = [
  "AI_SCENERY_ONLY_DOMAINS",
  "MOVIE_TV_STREAMING_DOMAINS",
  "SCENERY_ONLY_DOMAINS",
  "GENERIC_BUSINESS_HOMEPAGE_DOMAINS",
] as const;

function readCodeLists(repoRoot: string, limit: number): TestsetItem[] {
  const source = readFileSync(
    join(repoRoot, "extension/worker/src/routes/commutePolicy.ts"),
    "utf8",
  );

  const perList = CODE_LIST_NAMES.map((name) => ({
    name,
    domains: extractDomainList(source, name),
  }));

  // Interleave the component lists so a truncated set still spans all of them.
  const picked: TestsetItem[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (picked.length < limit) {
    let advanced = false;
    for (const list of perList) {
      const domain = list.domains[index];
      if (!domain) continue;
      advanced = true;
      if (seen.has(domain)) continue;
      seen.add(domain);
      picked.push({
        url: `https://${domain}/`,
        expected: "scenery",
        source: "code-list",
        placeKey: domain,
        note: list.name,
        synthetic: isSyntheticUrl(`https://${domain}/`),
      });
      if (picked.length >= limit) break;
    }
    if (!advanced) break;
    index += 1;
  }
  return picked;
}

/**
 * Runs the real policy over every URL named in its own test file, so each fixture
 * is labeled by what the shipped code actually does with it rather than by a
 * reading of the surrounding assertion.
 */
async function readPolicyFixtures(
  repoRoot: string,
  limit: number,
): Promise<TestsetItem[]> {
  const testSource = readFileSync(
    join(repoRoot, "extension/worker/src/__tests__/commutePolicy.test.ts"),
    "utf8",
  );
  const urls = [
    ...new Set(
      [...testSource.matchAll(/'(https?:\/\/[^']+)'/g)].map(
        (match) => match[1],
      ),
    ),
  ].filter((url) => !url.includes("destination-"));

  const { buildCommuteResponse } = (await import(
    join(repoRoot, "extension/worker/src/routes/commutePolicy.ts")
  )) as {
    buildCommuteResponse: (
      events: unknown[],
      a: unknown[],
      b: number,
    ) => {
      destinations: Array<{ url?: string; domain: string }>;
      scenery: Array<{ domain: string }>;
    };
  };

  const items: TestsetItem[] = [];
  for (const url of urls) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }

    const response = buildCommuteResponse(
      [
        {
          id: "fixture",
          type: "navigation",
          ts: 500,
          data: { title: "Fixture page" },
          meta: {
            pid: "rider-one",
            sid: "session-rider-one",
            url,
            vw: 1200,
            vh: 800,
            tz: "UTC",
            cursor_color: "#5b8db8",
          },
        },
      ],
      [],
      1_000,
    );

    const isDestination = response.destinations.length > 0;
    const inScenery = response.scenery.length > 0;

    // "At least a stop" is recorded as `regular`; matching accepts a
    // featured-candidate for it too.
    const expected = isDestination
      ? "regular"
      : inScenery
        ? "scenery"
        : "hidden";

    items.push({
      url,
      expected,
      source: "policy-fixture",
      placeKey: hostname,
      synthetic: isSyntheticUrl(url),
    });
    if (items.length >= limit) break;
  }
  return items;
}

type ReserveEntry = {
  url: string;
  title?: string;
  sourceCollection?: string;
};

/**
 * Takes a deterministic spread across the catalog's collections, so a small
 * sample is not dominated by the largest one.
 */
function readReserveCatalog(repoRoot: string, limit: number): TestsetItem[] {
  const catalog = JSON.parse(
    readFileSync(
      join(
        repoRoot,
        "extension/website/public/internet-commute-reserve-catalog.json",
      ),
      "utf8",
    ),
  ) as { entries: ReserveEntry[] };

  const byCollection = new Map<string, ReserveEntry[]>();
  for (const entry of catalog.entries) {
    const key = entry.sourceCollection ?? "unknown";
    const bucket = byCollection.get(key);
    if (bucket) bucket.push(entry);
    else byCollection.set(key, [entry]);
  }

  const collections = [...byCollection.keys()].sort();
  const picked: TestsetItem[] = [];
  let index = 0;
  while (picked.length < limit) {
    let advanced = false;
    for (const name of collections) {
      const entries = byCollection.get(name) ?? [];
      // Stride through each collection rather than taking its head, so the
      // sample is spread across the whole of it.
      const stride = Math.max(1, Math.floor(entries.length / limit));
      const entry = entries[index * stride];
      if (!entry) continue;
      advanced = true;
      picked.push({
        url: entry.url,
        expected: "featured-candidate",
        source: "reserve-catalog",
        title: entry.title ?? null,
        sourceCollection: name,
        synthetic: isSyntheticUrl(entry.url),
      });
      if (picked.length >= limit) break;
    }
    if (!advanced) break;
    index += 1;
  }
  return picked;
}

export async function buildTestset(repoRoot: string): Promise<TestsetItem[]> {
  const items = [
    ...readHumanRows(repoRoot),
    ...readCodeLists(repoRoot, 60),
    ...(await readPolicyFixtures(repoRoot, 60)),
    ...readReserveCatalog(repoRoot, 80),
  ];

  // Human labels are the truth, so an earlier row wins any URL collision.
  const byUrl = new Map<string, TestsetItem>();
  for (const item of items) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}
