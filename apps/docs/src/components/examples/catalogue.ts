// ABOUTME: Maps the public Are.na sites channel into catalogue entries.
// ABOUTME: Provides URL deduplication and text filtering for the examples index.

import type { CatalogueExampleSummary } from "./examples";

export const ARENA_CONTENTS_URL =
  "https://api.are.na/v3/channels/playhtml-sites/contents?per=100";

export type SiteSummary = {
  id: `arena-${number}`;
  title: string;
  description: string;
  author?: string;
  href: string;
  hostname: string;
  imageUrl?: string;
  imageAlt?: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNestedRecord(
  record: UnknownRecord,
  key: string,
): UnknownRecord | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function parsePublicUrl(value: unknown): URL | undefined {
  const href = readString(value);
  if (!href) return undefined;

  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSiteUrl(href: string): string | undefined {
  const url = parsePublicUrl(href);
  if (!url) return undefined;

  url.hash = "";
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.origin}${pathname}${url.search}`;
}

export function deduplicateSitesByUrl(
  sites: readonly SiteSummary[],
): SiteSummary[] {
  const seen = new Set<string>();
  return sites.filter((site) => {
    const normalizedUrl = normalizeSiteUrl(site.href);
    if (!normalizedUrl || seen.has(normalizedUrl)) return false;
    seen.add(normalizedUrl);
    return true;
  });
}

export function isArenaContentsResponse(
  response: unknown,
): response is { data: unknown[] } {
  return isRecord(response) && Array.isArray(response.data);
}

export function isUsefulSiteDescription(description: string): boolean {
  return !/^(?:\?+|connecting(?:\.{3}|…)?|loading(?:\.{3}|…)?)$/i.test(
    description.trim(),
  );
}

function parseSiteDescription(description: string | undefined): {
  author?: string;
  description: string;
} {
  if (!description) return { description: "" };

  const [firstLine, ...remainingLines] = description.split(/\r?\n/);
  const authorMatch = firstLine.match(/^by:\s*(.+)$/i);
  if (!authorMatch) {
    return {
      description: isUsefulSiteDescription(description) ? description : "",
    };
  }

  const author = authorMatch[1].trim();
  const remainingDescription = remainingLines.join("\n").trim();
  return {
    ...(author ? { author } : {}),
    description:
      remainingDescription && isUsefulSiteDescription(remainingDescription)
        ? remainingDescription
        : "",
  };
}

function splitTitleCredit(title: string | undefined): {
  title?: string;
  by?: string;
} {
  if (!title) return {};
  const match = title.match(/^(.+)\s+by\s+(.+?)$/i);
  if (!match) return { title };
  return { title: match[1].trim(), by: match[2].trim() };
}

function usableBlockTitle(
  title: string | undefined,
  author: string | undefined,
  hostname: string,
): string | undefined {
  if (!title) return undefined;
  const normalized = title.toLowerCase();
  if (normalized === hostname.toLowerCase().replace(/^www\./, "")) {
    return undefined;
  }
  if (normalized === hostname.toLowerCase()) return undefined;
  // Older blocks used the person's name as the block title.
  if (author && author.toLowerCase().startsWith(normalized)) return undefined;
  return title;
}

function mapArenaBlock(value: unknown): SiteSummary | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type !== "Link" || value.visibility !== "public") return undefined;

  const id = value.id;
  if (typeof id !== "number" || !Number.isFinite(id)) return undefined;

  const source = readNestedRecord(value, "source");
  const destination = source ? parsePublicUrl(source.url) : undefined;
  if (!destination) return undefined;

  const description = readNestedRecord(value, "description");
  const metadata = readNestedRecord(value, "metadata");
  const image = readNestedRecord(value, "image");
  const smallImage = image ? readNestedRecord(image, "small") : undefined;
  const sourceTitle = source ? readString(source.title) : undefined;
  const descriptionText = description
    ? readString(description.plain)
    : undefined;
  const siteDescription = parseSiteDescription(descriptionText);
  // The block title is what the channel owner edits on Are.na, so it wins
  // over the scraped page title. "Name by Person" also credits the person.
  const blockTitle = splitTitleCredit(readString(value.title));
  const author =
    (metadata ? readString(metadata.author) : undefined) ??
    siteDescription.author ??
    blockTitle.by;
  const title =
    usableBlockTitle(blockTitle.title, author, destination.hostname) ??
    sourceTitle ??
    destination.hostname;

  return {
    id: `arena-${id}`,
    title,
    description: siteDescription.description,
    ...(author ? { author } : {}),
    href: destination.href,
    hostname: destination.hostname.replace(/^www\./, ""),
    imageUrl:
      (smallImage ? readString(smallImage.src) : undefined) ??
      (image ? readString(image.src) : undefined),
    imageAlt: image ? readString(image.alt_text) : undefined,
  };
}

export function mapArenaSites(response: unknown): SiteSummary[] {
  if (!isArenaContentsResponse(response)) return [];

  const mapped = response.data
    .map(mapArenaBlock)
    .filter((site): site is SiteSummary => site !== undefined);

  // Are.na returns channel contents newest first, so first occurrence wins.
  return deduplicateSitesByUrl(mapped);
}

function includesQuery(values: Array<string | undefined>, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return values.some((value) =>
    value?.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function filterExamples(
  examples: readonly CatalogueExampleSummary[],
  query: string,
): CatalogueExampleSummary[] {
  return examples.filter((example) =>
    includesQuery(
      [
        example.title,
        example.description,
        example.difficulty,
        example.kind === "recipe" ? "recipe" : "docs demo",
        ...example.tags,
        ...example.capabilities,
      ],
      query,
    ),
  );
}

export function filterSites(
  sites: readonly SiteSummary[],
  query: string,
): SiteSummary[] {
  return sites.filter((site) =>
    includesQuery(
      [site.title, site.description, site.author, site.hostname],
      query,
    ),
  );
}
