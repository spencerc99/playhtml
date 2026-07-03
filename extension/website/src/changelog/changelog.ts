// ABOUTME: Parses extension changelog Markdown into renderable release entries.
// ABOUTME: Supports release headings, bullets, paragraphs, photos, and video links.

export type ChangelogBlock =
  | { type: "bullet"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "image"; alt: string; src: string }
  | { type: "video"; title: string; src: string };

export interface ChangelogRelease {
  version: string;
  date?: string;
  blocks: ChangelogBlock[];
}

const releaseHeadingPattern = /^##\s+([^\s(]+)(?:\s+\(([^)]+)\))?\s*$/;
const nestedHeadingPattern = /^###\s+(.+)$/;
const bulletPattern = /^-\s+(.+)$/;
const imagePattern = /^!\[([^\]]*)\]\(([^)]+)\)$/;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let currentRelease: ChangelogRelease | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("# ")) continue;

    const releaseHeading = line.match(releaseHeadingPattern);
    if (releaseHeading) {
      currentRelease = {
        version: releaseHeading[1],
        date: releaseHeading[2],
        blocks: [],
      };
      releases.push(currentRelease);
      continue;
    }

    if (!currentRelease) continue;

    const block = parseChangelogBlock(line);
    if (block) currentRelease.blocks.push(block);
  }

  return releases;
}

function parseChangelogBlock(line: string): ChangelogBlock | null {
  const image = line.match(imagePattern);
  if (image) {
    const alt = image[1].trim();
    const src = image[2].trim();
    const videoTitle = alt.match(/^video:\s*(.+)$/i);

    if (videoTitle) {
      return { type: "video", title: videoTitle[1].trim(), src };
    }

    return { type: "image", alt, src };
  }

  const heading = line.match(nestedHeadingPattern);
  if (heading) return { type: "heading", text: heading[1].trim() };

  const bullet = line.match(bulletPattern);
  if (bullet) return { type: "bullet", text: bullet[1].trim() };

  return { type: "paragraph", text: line };
}
