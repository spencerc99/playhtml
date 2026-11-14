// ABOUTME: /docs/llms.txt — one plain-text entry point any coding agent can read.
// The body is the building-playhtml-elements skill, so the agent guide, the
// Claude plugin, and `npx skills add` installs all stay on one source of truth.
import type { APIRoute } from "astro";
import skill from "../../../../claude-plugin/skills/building-playhtml-elements/SKILL.md?raw";

const header = `# playhtml

> playhtml makes HTML elements collaborative and real-time. Add an attribute like \`can-move\` or \`can-toggle\` to an element with an \`id\`, or register a custom \`can-play\` element, and its state syncs live between everyone on the page. Works with vanilla HTML (\`playhtml\` on npm or unpkg) and React (\`@playhtml/react\`).

Read this whole file before writing playhtml code. The guide below covers the APIs, which data type to use, and the mistakes that silently break sync.

`;

// Drop the skill's YAML frontmatter (install metadata) and its own H1, so the
// file keeps the single H1 the llms.txt format expects.
const body = skill
  .replace(/^---\n[\s\S]*?\n---\n+/, "")
  .replace(/^# .*\n+/, "");

export const GET: APIRoute = () =>
  new Response(header + body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
