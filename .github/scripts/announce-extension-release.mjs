// ABOUTME: Posts a Discord webhook announcement for a newly published extension release.
// ABOUTME: Reads extension/CHANGELOG.md and links people to the public changelog page.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_CHANGELOG_URL = "https://wewere.online/changelog/";
const repoUrl = process.env.REPO_URL ?? "https://github.com/spencerc99/playhtml";

export function extractExtensionChangelogSection(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\n)## ${escaped}\\b[^\\n]*\\n+([\\s\\S]*?)(?=\\n## |$)`);
  const match = changelog.match(pattern);
  return match ? match[2].trim() : null;
}

export function buildExtensionReleasePayload({
  version,
  body,
  changelogUrl = DEFAULT_CHANGELOG_URL,
  releaseUrl,
}) {
  const tag = `@playhtml/extension@${version}`;
  const description = normalizeRelativeLinks(
    body || "_No changelog entry found._",
    changelogUrl,
  );

  return {
    content: `**we were online extension release** — \`${version}\``,
    embeds: [
      {
        title: tag,
        url: releaseUrl,
        description: truncate(description, 3800),
        color: 0x4a9a8a,
        fields: [
          {
            name: "changelog",
            value: `[wewere.online/changelog](${changelogUrl})`,
            inline: true,
          },
          {
            name: "release",
            value: `[GitHub](${releaseUrl})`,
            inline: true,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 20) + "\n\n...(truncated)";
}

function normalizeRelativeLinks(text, changelogUrl) {
  const origin = new URL(changelogUrl).origin;
  return text.replace(/\]\((\/[^)]+)\)/g, `](${origin}$1)`);
}

async function main() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const version = process.env.VERSION;
  const changelogUrl = process.env.CHANGELOG_URL ?? DEFAULT_CHANGELOG_URL;

  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL is not set; skipping announcement.");
    process.exit(0);
  }
  if (!version) {
    console.error("VERSION is not set; cannot announce extension release.");
    process.exit(1);
  }

  const changelog = readFileSync("extension/CHANGELOG.md", "utf8");
  const body = extractExtensionChangelogSection(changelog, version);
  const releaseUrl = `${repoUrl}/releases/tag/${encodeURIComponent(
    `@playhtml/extension@${version}`,
  )}`;
  const payload = buildExtensionReleasePayload({
    version,
    body,
    changelogUrl,
    releaseUrl,
  });

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
  console.log(`Announced @playhtml/extension@${version} to Discord.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
