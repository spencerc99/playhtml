// ABOUTME: Posts a Discord webhook announcement for each newly published npm package.
// ABOUTME: Reads PUBLISHED_PACKAGES from changesets/action and pulls notes from each CHANGELOG.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const publishedRaw = process.env.PUBLISHED_PACKAGES;
const repoUrl = process.env.REPO_URL ?? "https://github.com/spencerc99/playhtml";

if (!webhookUrl) {
  console.error("DISCORD_WEBHOOK_URL is not set; skipping announcement.");
  process.exit(0);
}
if (!publishedRaw) {
  console.error("PUBLISHED_PACKAGES is empty; nothing to announce.");
  process.exit(0);
}

const published = JSON.parse(publishedRaw);
if (!Array.isArray(published) || published.length === 0) {
  console.log("No published packages.");
  process.exit(0);
}

// Map npm package name → path to its CHANGELOG.md.
const packageDirs = {
  playhtml: "packages/playhtml",
  "@playhtml/react": "packages/react",
  "@playhtml/common": "packages/common",
};

// Discord caps each description at 4096 and total embed payload at 6000 chars.
// Budget per embed so N packages still fit under the total cap.
const TOTAL_EMBED_BUDGET = 5500;

function extractChangelogSection(changelogPath, version) {
  let text;
  try {
    text = readFileSync(changelogPath, "utf8");
  } catch (err) {
    console.warn(`Could not read ${changelogPath}: ${err.message}`);
    return null;
  }
  // Sections are `## <version>` headers; capture until next `## ` or EOF.
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\n)## ${escaped}\\b[\\s\\S]*?(?=\\n## |$)`);
  const match = text.match(pattern);
  if (!match) return null;
  return match[0].replace(/^\n/, "").trim();
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 20) + "\n\n…(truncated)";
}

const perEmbedBudget = Math.floor(TOTAL_EMBED_BUDGET / Math.min(published.length, 10)) - 200;

const embeds = published.slice(0, 10).map(({ name, version }) => {
  const dir = packageDirs[name];
  let body = "";
  if (dir) {
    const section = extractChangelogSection(join(dir, "CHANGELOG.md"), version);
    if (section) {
      body = section.replace(/^## .*\n+/, "");
    }
  }
  if (!body) body = "_No changelog entry found._";

  const tag = `${name}@${version}`;
  const npmUrl = `https://www.npmjs.com/package/${name}/v/${version}`;
  const releaseUrl = `${repoUrl}/releases/tag/${encodeURIComponent(tag)}`;

  return {
    title: tag,
    url: releaseUrl,
    description: truncate(body, perEmbedBudget),
    color: 0x4a9a8a,
    fields: [
      { name: "npm", value: `[${tag}](${npmUrl})`, inline: true },
      { name: "release", value: `[GitHub](${releaseUrl})`, inline: true },
    ],
  };
});

const summary = published.map((p) => `\`${p.name}@${p.version}\``).join(", ");
const payload = {
  content: `**playhtml release** — ${summary}`,
  // Discord allows up to 10 embeds per message.
  embeds,
  allowed_mentions: { parse: [] },
};

const res = await fetch(webhookUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Discord webhook failed: ${res.status} ${res.statusText}\n${text}`);
  process.exit(1);
}
console.log(`Announced ${published.length} package(s) to Discord.`);
