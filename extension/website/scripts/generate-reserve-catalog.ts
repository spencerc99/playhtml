// ABOUTME: Builds the Internet Commute reserve catalog from public editorial indexes and repo routes.
// ABOUTME: Keeps source provenance and experience tags separate from human curation policy.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

type SourceMode = "trusted-editorial" | "discovery-only";
type InteractionLevel =
  | "ambient"
  | "responsive"
  | "participatory"
  | "collaborative"
  | "varied"
  | "unknown";

type HealthStatus =
  | "linked-from-live-index"
  | "repo-defined"
  | "source-page-reachable";

interface ReserveCatalogEntry {
  url: string;
  title: string;
  sourceCollection: string;
  sourceUrl: string;
  sourceMode: SourceMode;
  issue?: string;
  section?: string;
  tags: string[];
  interactionLevel: InteractionLevel;
  provenance: {
    kind: "collection-index" | "repo-route";
    discoveredFrom: string;
  };
  health: {
    status: HealthStatus;
    note: string;
  };
}

interface SourceProfile {
  name: string;
  url: string;
  mode: SourceMode;
  tags: string[];
  recommendation: string;
  notes: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const defaultOutputPath = path.join(
  repositoryRoot,
  "extension/website/public/internet-commute-reserve-catalog.json",
);
const crawlDelayMs = 900;
const userAgent =
  "WWO Internet Commute reserve catalog research; contact https://wewere.online/";

let lastRequestAt = 0;

function parseDocument(html: string, url?: string): Document {
  return new JSDOM(html, {
    ...(url ? { url } : {}),
    virtualConsole: new VirtualConsole(),
  }).window.document;
}

function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function canonicalizeCatalogUrl(
  rawUrl: string,
  baseUrl?: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  for (const key of [...parsed.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith("utm_") ||
      ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
    ) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "");
  }

  return parsed.toString();
}

function makeEntry(
  entry: Omit<ReserveCatalogEntry, "url" | "tags"> & {
    url: string;
    tags: string[];
  },
): ReserveCatalogEntry | null {
  const url = canonicalizeCatalogUrl(entry.url, entry.sourceUrl);
  if (!url) return null;

  return {
    ...entry,
    url,
    title: cleanText(entry.title),
    tags: [...new Set(entry.tags)].sort(),
  };
}

export function dedupeCatalogEntries(
  entries: ReserveCatalogEntry[],
): ReserveCatalogEntry[] {
  const byUrl = new Map<string, ReserveCatalogEntry>();

  for (const entry of entries) {
    const existing = byUrl.get(entry.url);
    if (!existing) {
      byUrl.set(entry.url, entry);
      continue;
    }

    const preferred =
      existing.sourceMode === "trusted-editorial" ? existing : entry;
    const alternate = preferred === existing ? entry : existing;
    byUrl.set(entry.url, {
      ...preferred,
      tags: [...new Set([...preferred.tags, ...alternate.tags])].sort(),
    });
  }

  return [...byUrl.values()].sort((left, right) =>
    left.url.localeCompare(right.url),
  );
}

async function fetchDocument(url: string): Promise<Document> {
  const waitMs = Math.max(0, lastRequestAt + crawlDelayMs - Date.now());
  if (waitMs > 0) await Bun.sleep(waitMs);

  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    redirect: "follow",
  });
  lastRequestAt = Date.now();

  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }

  return parseDocument(await response.text(), response.url);
}

export function parseHtmlReviewArchive(
  html: string,
  sourceUrl = "https://thehtml.review/archive",
): ReserveCatalogEntry[] {
  const document = parseDocument(html, sourceUrl);
  const entries: ReserveCatalogEntry[] = [];

  for (const section of document.querySelectorAll("section")) {
    const issueLink = section.querySelector<HTMLAnchorElement>("h2 a[href]");
    if (!issueLink) continue;

    const issue = cleanText(issueLink.textContent);
    const issueEntry = makeEntry({
      url: issueLink.href,
      title: issue,
      sourceCollection: "The HTML Review",
      sourceUrl,
      sourceMode: "trusted-editorial",
      issue,
      section: "issue landing page",
      tags: ["editorial", "poetic", "web-literature", "web-native"],
      interactionLevel: "varied",
      provenance: { kind: "collection-index", discoveredFrom: sourceUrl },
      health: {
        status: "linked-from-live-index",
        note: "Issue page linked from the live archive; target not fetched separately.",
      },
    });
    if (issueEntry) entries.push(issueEntry);

    for (const item of section.querySelectorAll("ul li")) {
      const workLink = item.querySelector<HTMLAnchorElement>("a[href]");
      if (!workLink) continue;
      const workEntry = makeEntry({
        url: workLink.href,
        title: cleanText(workLink.textContent),
        sourceCollection: "The HTML Review",
        sourceUrl,
        sourceMode: "trusted-editorial",
        issue,
        section: "individual work",
        tags: ["editorial", "interactive-web", "poetic", "web-literature"],
        interactionLevel: "varied",
        provenance: { kind: "collection-index", discoveredFrom: sourceUrl },
        health: {
          status: "linked-from-live-index",
          note: "Work linked from the live archive; target not fetched separately.",
        },
      });
      if (workEntry) entries.push(workEntry);
    }
  }

  return entries;
}

export function parseTaperIssue(
  html: string,
  issueUrl: string,
  issueTitle: string,
): ReserveCatalogEntry[] {
  const document = parseDocument(html, issueUrl);
  const entries: ReserveCatalogEntry[] = [];

  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "li > a[href]",
  )) {
    const rawUrl = new URL(link.href, issueUrl);
    if (rawUrl.hostname === "taper.badquar.to") rawUrl.protocol = "https:";
    const url = canonicalizeCatalogUrl(rawUrl.toString(), issueUrl);
    if (
      !url ||
      !url.startsWith(issueUrl) ||
      /\/about(?:\.html)?$/.test(new URL(url).pathname)
    ) {
      continue;
    }

    const entry = makeEntry({
      url,
      title: cleanText(link.textContent),
      sourceCollection: "Taper",
      sourceUrl: "https://taper.badquar.to/",
      sourceMode: "trusted-editorial",
      issue: issueTitle,
      section: "individual work",
      tags: ["computational-poetry", "editorial", "poetic", "web-native"],
      interactionLevel: "varied",
      provenance: { kind: "collection-index", discoveredFrom: issueUrl },
      health: {
        status: "linked-from-live-index",
        note: "Work linked from the live issue index; target not fetched separately.",
      },
    });
    if (entry) entries.push(entry);
  }

  return entries;
}

async function crawlHtmlReview(): Promise<ReserveCatalogEntry[]> {
  const sourceUrl = "https://thehtml.review/archive";
  const document = await fetchDocument(sourceUrl);
  return parseHtmlReviewArchive(document.documentElement.outerHTML, sourceUrl);
}

async function crawlTaper(): Promise<ReserveCatalogEntry[]> {
  const sourceUrl = "https://taper.badquar.to/";
  const document = await fetchDocument(sourceUrl);
  const entries: ReserveCatalogEntry[] = [];

  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!/^\d+\/$/.test(link.getAttribute("href") ?? "")) continue;
    const issueTitle = cleanText(link.textContent).replace(/,$/, "");
    const issueUrl = new URL(link.href, sourceUrl).toString();
    const issueEntry = makeEntry({
      url: issueUrl,
      title: issueTitle,
      sourceCollection: "Taper",
      sourceUrl,
      sourceMode: "trusted-editorial",
      issue: issueTitle,
      section: "issue landing page",
      tags: ["computational-poetry", "editorial", "poetic", "web-native"],
      interactionLevel: "varied",
      provenance: { kind: "collection-index", discoveredFrom: sourceUrl },
      health: {
        status: "linked-from-live-index",
        note: "Issue page linked from the live magazine index.",
      },
    });
    if (issueEntry) entries.push(issueEntry);

    const issueDocument = await fetchDocument(issueUrl);
    entries.push(
      ...parseTaperIssue(
        issueDocument.documentElement.outerHTML,
        issueUrl,
        issueTitle,
      ),
    );
  }

  return entries;
}

async function crawlSfpcAnthology(
  sourceUrl: string,
  sourceCollection: string,
): Promise<ReserveCatalogEntry[]> {
  const document = await fetchDocument(sourceUrl);
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const sfpcLinkIndex = links.findLastIndex((link) =>
    /sfpc\.(?:study|io)/.test(link.hostname),
  );
  const entries: ReserveCatalogEntry[] = [];

  for (const link of links.slice(sfpcLinkIndex + 1)) {
    const url = canonicalizeCatalogUrl(link.href, sourceUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (
      parsed.pathname.toLowerCase().endsWith(".pdf") ||
      ["bit.ly", "instagram.com", "www.instagram.com"].includes(parsed.hostname)
    ) {
      continue;
    }

    const title = cleanText(link.textContent);
    if (!title) continue;
    const entry = makeEntry({
      url,
      title,
      sourceCollection,
      sourceUrl,
      sourceMode: "trusted-editorial",
      section: "anthology work",
      tags: ["handmade-web", "interactive-web", "poetic", "sfpc", "web-native"],
      interactionLevel: "varied",
      provenance: { kind: "collection-index", discoveredFrom: sourceUrl },
      health: {
        status: "linked-from-live-index",
        note: "Work linked from the live SFPC class anthology; target not fetched separately.",
      },
    });
    if (entry) entries.push(entry);
  }

  return entries;
}

async function crawlSfpc(): Promise<ReserveCatalogEntry[]> {
  const anthologies = [
    {
      url: "https://httpoetics.neocities.org/anthology/2026/",
      name: "SFPC HTTPoetics 2026",
    },
    {
      url: "https://httpoetics-anthology.glitch.me/",
      name: "SFPC HTTPoetics 2024",
    },
  ];

  const entries: ReserveCatalogEntry[] = [];
  for (const anthology of anthologies) {
    const anthologyEntry = makeEntry({
      url: anthology.url,
      title: anthology.name,
      sourceCollection: anthology.name,
      sourceUrl: anthology.url,
      sourceMode: "trusted-editorial",
      section: "anthology landing page",
      tags: ["handmade-web", "poetic", "sfpc", "web-native"],
      interactionLevel: "varied",
      provenance: { kind: "collection-index", discoveredFrom: anthology.url },
      health: {
        status: "source-page-reachable",
        note: "Anthology landing page fetched successfully during catalog generation.",
      },
    });
    if (anthologyEntry) entries.push(anthologyEntry);
    entries.push(...(await crawlSfpcAnthology(anthology.url, anthology.name)));
  }
  return entries;
}

async function crawlPlayhtml(): Promise<ReserveCatalogEntry[]> {
  const sourceUrl = "https://playhtml.fun/experiments/";
  const experimentDirectory = path.join(repositoryRoot, "website/experiments");
  const experimentSlugs = (
    await readdir(experimentDirectory, {
      withFileTypes: true,
    })
  )
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== "test" &&
        !entry.name.startsWith("index-"),
    )
    .map((entry) => entry.name)
    .sort();
  const experimentRoutes = await Promise.all(
    experimentSlugs.map(async (slug) => {
      const html = await Bun.file(
        path.join(experimentDirectory, slug, "index.html"),
      ).text();
      const title = cleanText(
        parseDocument(html).querySelector("title")?.textContent,
      );
      return {
        path: `/experiments/${slug}/`,
        title: title || `playhtml experiment ${slug}`,
      };
    }),
  );

  const routes = [
    { path: "/", title: "playhtml" },
    { path: "/fridge", title: "playhtml fridge poetry" },
    ...experimentRoutes,
    {
      path: "/events/gathering/",
      title: "playhtml get-together",
    },
    {
      path: "/events/walking-together/",
      title: "walking together on the internet",
    },
  ];

  return routes.flatMap((route) => {
    const entry = makeEntry({
      url: new URL(route.path, "https://playhtml.fun/").toString(),
      title: route.title,
      sourceCollection: "PlayHTML examples",
      sourceUrl,
      sourceMode: "trusted-editorial",
      section: "public example",
      tags: ["collaborative", "human-community", "interactive-web", "playful"],
      interactionLevel: "collaborative",
      provenance: { kind: "repo-route", discoveredFrom: experimentDirectory },
      health: {
        status: "repo-defined",
        note: "Public route is defined by the checked-out PlayHTML website source.",
      },
    });
    return entry ? [entry] : [];
  });
}

async function crawlDiscoveryIndexes(): Promise<ReserveCatalogEntry[]> {
  const entries: ReserveCatalogEntry[] = [];
  const indexes = [
    {
      url: "https://the-next.org/exhibitions",
      collection: "The NEXT exhibitions",
      selector: 'a[href*="/exhibition/"]',
      tags: ["archive", "electronic-literature", "web-art"],
    },
    {
      url: "https://the-next.org/categories/showcases",
      collection: "The NEXT showcases",
      selector: 'a[href*="/collections/"]',
      tags: ["archive", "electronic-literature", "web-art"],
    },
    {
      url: "https://artport.whitney.org/v1/artdatabase.html",
      collection: "Whitney Artport",
      selector: 'a[href*="/commissions/"]',
      tags: ["museum", "net-art", "web-art"],
    },
    {
      url: "https://archive.rhizome.org/",
      collection: "Rhizome Archive",
      selector: 'a[href*="/exhibition/"]',
      tags: ["archive", "net-art", "web-art"],
    },
    {
      url: "https://net-art.org/",
      collection: "net-art.org",
      selector: "a.node__title-link[href]",
      tags: ["archive", "net-art", "web-art"],
    },
  ];

  for (const index of indexes) {
    const document = await fetchDocument(index.url);
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      index.selector,
    )) {
      const entry = makeEntry({
        url: link.href,
        title: cleanText(link.textContent),
        sourceCollection: index.collection,
        sourceUrl: index.url,
        sourceMode: "discovery-only",
        section: "archive index entry",
        tags: index.tags,
        interactionLevel: "unknown",
        provenance: { kind: "collection-index", discoveredFrom: index.url },
        health: {
          status: "linked-from-live-index",
          note: "Archive entry linked from a live index; item requires review before reserve use.",
        },
      });
      if (entry?.title) entries.push(entry);
    }
  }

  return entries;
}

const sourceProfiles: SourceProfile[] = [
  {
    name: "The HTML Review",
    url: "https://thehtml.review/archive",
    mode: "trusted-editorial",
    tags: ["interactive-web", "poetic", "web-literature"],
    recommendation:
      "Bulk-enable individual works after public-page and health checks.",
    notes: "Annual edited journal whose works are made to exist on the web.",
  },
  {
    name: "Taper",
    url: "https://taper.badquar.to/",
    mode: "trusted-editorial",
    tags: ["computational-poetry", "poetic", "web-native"],
    recommendation:
      "Bulk-enable individual works after public-page and health checks.",
    notes: "Edited literary magazine for small computational pieces.",
  },
  {
    name: "PlayHTML examples",
    url: "https://playhtml.fun/experiments/",
    mode: "trusted-editorial",
    tags: ["collaborative", "human-community", "interactive-web"],
    recommendation:
      "Eligible reserve entries; cap at one PlayHTML route per ride.",
    notes: "Repo-owned public examples and social experiments.",
  },
  {
    name: "SFPC HTTPoetics anthologies",
    url: "https://sfpc.study/projects/httpoetics-2026-anthology",
    mode: "trusted-editorial",
    tags: ["handmade-web", "poetic", "sfpc", "web-native"],
    recommendation:
      "Bulk-enable anthology works after public-page and health checks.",
    notes:
      "Class anthologies of small websites built around the poetics of the web.",
  },
  {
    name: "The NEXT",
    url: "https://the-next.org/",
    mode: "discovery-only",
    tags: ["archive", "electronic-literature", "web-art"],
    recommendation:
      "Review individual live works; do not bulk-enable archive records.",
    notes:
      "Deep museum-scale collection with emulated, archival, and live-web material.",
  },
  {
    name: "Whitney Artport",
    url: "https://artport.whitney.org/v1/info.html",
    mode: "discovery-only",
    tags: ["museum", "net-art", "web-art"],
    recommendation:
      "Review commissions individually for browser compatibility.",
    notes:
      "Museum portal containing commissions, exhibitions, and historical resources.",
  },
  {
    name: "Rhizome Archive",
    url: "https://archive.rhizome.org/",
    mode: "discovery-only",
    tags: ["archive", "net-art", "web-art"],
    recommendation:
      "Review live browser-native works; exclude wrappers requiring emulation.",
    notes:
      "Historical archive with mixed live, preserved, and emulated experiences.",
  },
  {
    name: "net-art.org",
    url: "https://net-art.org/",
    mode: "discovery-only",
    tags: ["archive", "net-art", "web-art"],
    recommendation:
      "Use as a research index; review every destination individually.",
    notes:
      "Broad historical index with varied availability and content suitability.",
  },
];

const humanCommunitySources: SourceProfile[] = [
  {
    name: "HTML Day / HTML Energy",
    url: "https://html.energy/events.html",
    mode: "trusted-editorial",
    tags: ["handmade-web", "human-community", "local-community"],
    recommendation:
      "Trust official event and showcase pages; review participant submissions.",
    notes:
      "Stewarded, recurring gatherings where people make and share HTML together.",
  },
  {
    name: "32-Bit Cafe",
    url: "https://32bit.cafe/",
    mode: "discovery-only",
    tags: ["human-community", "personal-web", "small-social-space"],
    recommendation:
      "Use official projects and staff-curated resources, not a presumed member directory.",
    notes:
      "The community intentionally does not equate forum participation with endorsement of personal sites.",
  },
  {
    name: "webring.fun",
    url: "https://webring.fun/",
    mode: "discovery-only",
    tags: ["human-community", "personal-web", "webring"],
    recommendation:
      "Strong discovery source; health-check and review external member sites.",
    notes:
      "Has explicit personal, non-commercial, mostly-SFW, and anti-harassment membership rules.",
  },
  {
    name: "netdir",
    url: "https://netdir.org/",
    mode: "discovery-only",
    tags: ["human-community", "personal-web", "webring"],
    recommendation:
      "Review the small curated ring, then enable exact homepages selectively.",
    notes: "Small handpicked ring with clear editorial stewardship.",
  },
  {
    name: "Socratica Webring",
    url: "https://socratica.info/webring",
    mode: "discovery-only",
    tags: ["human-community", "learning-community", "personal-web", "webring"],
    recommendation:
      "Review exact member homepages; preserve Socratica provenance.",
    notes:
      "Stable community-specific list rather than a general open directory.",
  },
  {
    name: "Tildeverse members",
    url: "https://tildeverse.org/members/",
    mode: "discovery-only",
    tags: ["human-community", "public-computing", "small-social-space"],
    recommendation:
      "Enable reviewed community roots; treat scraped user homepages as a separate noisy source.",
    notes:
      "Member communities have stability, reputation, collaboration, and conduct requirements.",
  },
  {
    name: "IndieWeb community",
    url: "https://indieweb.org/",
    mode: "discovery-only",
    tags: ["human-community", "open-protocol", "personal-web"],
    recommendation:
      "Use stewarded event/showcase pages; do not bulk-ingest the open people directory.",
    notes:
      "Useful community provenance, but wiki participation is not a destination-quality verdict.",
  },
  {
    name: "Neocities featured sites",
    url: "https://neocities.org/browse?sort_by=featured",
    mode: "discovery-only",
    tags: ["human-community", "personal-web"],
    recommendation:
      "Sample featured sites into review; never bulk-enable browse or recent-update feeds.",
    notes:
      "Large open host with useful featured signals but inconsistent content and safety.",
  },
  {
    name: "HTML Energy e2e",
    url: "https://e2e.html.energy/",
    mode: "discovery-only",
    tags: ["handmade-web", "human-community", "small-social-space"],
    recommendation:
      "Use as a fresh discovery feed with per-item review, not as an allowlist.",
    notes:
      "Community-submitted links have strong event context but light editorial filtering.",
  },
  {
    name: "Discourse Discover",
    url: "https://discover.discourse.com/",
    mode: "discovery-only",
    tags: ["forum-directory", "human-community"],
    recommendation:
      "Use as a broad lead source; review public access, topic quality, and commercial ownership per forum.",
    notes:
      "Optional platform directory spans community-owned spaces, product support, large companies, and gated forums.",
  },
];

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const generatedAt = readArgument("--generated-at");
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Pass a deterministic ISO timestamp with --generated-at.");
  }

  const outputPath = readArgument("--output") ?? defaultOutputPath;
  const groups = await Promise.all([
    crawlHtmlReview(),
    crawlTaper(),
    crawlSfpc(),
    crawlPlayhtml(),
    crawlDiscoveryIndexes(),
  ]);
  const entries = dedupeCatalogEntries(groups.flat());
  const countsBySource = Object.fromEntries(
    [...new Set(entries.map((entry) => entry.sourceCollection))]
      .sort()
      .map((source) => [
        source,
        entries.filter((entry) => entry.sourceCollection === source).length,
      ]),
  );

  const artifact = {
    format: "internet-commute-reserve-catalog/v1",
    generatedAt,
    policySeparation:
      "Source membership and inferred tags are evidence only. Human promoted, scenery-only, and blocked policies remain separate.",
    summary: {
      entries: entries.length,
      trustedEditorialEntries: entries.filter(
        (entry) => entry.sourceMode === "trusted-editorial",
      ).length,
      discoveryOnlyEntries: entries.filter(
        (entry) => entry.sourceMode === "discovery-only",
      ).length,
      countsBySource,
    },
    sources: [...sourceProfiles].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    humanCommunitySources: [...humanCommunitySources].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    entries,
  };

  await Bun.write(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${entries.length} entries to ${outputPath}`);
  console.log(JSON.stringify(artifact.summary, null, 2));
}

if (import.meta.main) {
  await main();
}
