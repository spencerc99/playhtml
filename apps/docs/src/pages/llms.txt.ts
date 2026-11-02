// ABOUTME: /docs/llms.txt — one plain-text entry point any coding agent can read.
// The body is the building-playhtml-elements skill, so the agent guide, the
// Claude plugin, and `npx skills add` installs all stay on one source of truth.
import type { APIRoute } from "astro";
import skill from "../../../../claude-plugin/skills/building-playhtml-elements/SKILL.md?raw";

const DOCS = "https://playhtml.fun/docs";

const header = `# playhtml

> playhtml makes HTML elements collaborative and real-time. Add an attribute like \`can-move\` or \`can-toggle\` to an element with an \`id\`, or register a custom \`can-play\` element, and its state syncs live between everyone on the page. Works with vanilla HTML (\`playhtml\` on npm or unpkg) and React (\`@playhtml/react\`).

Read this whole file before writing playhtml code. The guide below covers the APIs, which data type to use, and the mistakes that silently break sync.

## Docs

- [Getting started](${DOCS}/getting-started/): install and first element, vanilla HTML and React
- [Built-in elements](${DOCS}/capabilities/): can-move, can-toggle, can-spin, can-grow, can-duplicate, can-hover, can-mirror
- [Custom elements](${DOCS}/custom-elements/): can-play with playhtml.register
- [Data essentials](${DOCS}/data/data-essentials/): shaping and writing shared data safely
- [Presence and cursors](${DOCS}/data/presence/): per-user state and multiplayer cursors
- [Events](${DOCS}/data/events/): one-shot broadcasts like confetti
- [React API](${DOCS}/reference/react-api/)
- [Examples](${DOCS}/examples/)

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
