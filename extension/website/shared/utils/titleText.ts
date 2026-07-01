// ABOUTME: Formats captured page titles for compact viewport title-bar rendering.
// ABOUTME: Decodes HTML title entities and falls back to readable URL labels.
import { extractDomain } from "./eventUtils";

const TITLE_ENTITY_DECODE_PASSES = 3;
const TITLE_NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  ldquo: "\u201c",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  quot: "\"",
  rdquo: "\u201d",
  rsquo: "\u2019",
};

// Best-effort title derivation purely from the URL. Currently handles
// Wikipedia articles since the article slug is the title; everything else
// returns null so callers can fall through to the domain.
function deriveTitleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("wikipedia.org")) {
      const m = parsed.pathname.match(/^\/wiki\/(.+)$/);
      if (m) {
        const slug = decodeURIComponent(m[1]).replace(/_/g, " ");
        // Skip namespace pages (Special:, Talk:, User:, Category:, etc.) and
        // the Main Page — neither is useful as a title-bar label.
        if (/^[A-Za-z_]+:/.test(slug) || slug === "Main Page") return null;
        return slug;
      }
    }
  } catch {
    // ignore malformed URLs
  }
  return null;
}

function decodeTitleEntities(title: string): string {
  let decoded = title;
  for (let pass = 0; pass < TITLE_ENTITY_DECODE_PASSES; pass++) {
    const next = decoded.replace(
      /&(?:#(\d+)|#x([\da-fA-F]+)|([a-zA-Z][\da-zA-Z]+));/g,
      (
        match,
        decimal: string | undefined,
        hex: string | undefined,
        named: string | undefined,
      ) => {
        if (decimal || hex) {
          const codePoint = Number.parseInt(
            decimal ?? hex ?? "",
            decimal ? 10 : 16,
          );
          if (
            Number.isFinite(codePoint) &&
            codePoint >= 0 &&
            codePoint <= 0x10ffff
          ) {
            try {
              return String.fromCodePoint(codePoint);
            } catch {
              return match;
            }
          }
          return match;
        }

        const value = named
          ? TITLE_NAMED_ENTITIES[named.toLowerCase()]
          : undefined;
        return value ?? match;
      },
    );
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function replaceControlCharacters(title: string): string {
  let cleaned = "";
  for (let index = 0; index < title.length; index++) {
    const code = title.charCodeAt(index);
    cleaned += code <= 0x1f || code === 0x7f ? " " : title[index];
  }
  return cleaned;
}

function cleanTitleText(title: string): string {
  return replaceControlCharacters(decodeTitleEntities(title))
    .replace(/\s+/g, " ")
    .trim();
}

export function getViewportTitleText(
  pageUrl: string,
  pageTitle?: string,
): string {
  const cleanedPageTitle = pageTitle ? cleanTitleText(pageTitle) : "";
  if (cleanedPageTitle) return cleanedPageTitle;

  const derivedTitle = deriveTitleFromUrl(pageUrl);
  const cleanedDerivedTitle = derivedTitle ? cleanTitleText(derivedTitle) : "";
  if (cleanedDerivedTitle) return cleanedDerivedTitle;

  return extractDomain(pageUrl) || pageUrl;
}
